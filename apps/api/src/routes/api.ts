import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  MASA_RECORD_MEDIA_TYPE,
  MasaSnapshotInputError,
  MasaSnapshotValidationError,
  buildSnapshotMatterRecord,
  createMasaSnapshotSummary,
  serializeSnapshotMatterRecord
} from "@cosmoaudition/masa";
import type { SnapshotLike } from "@cosmoaudition/masa";
import {
  buildModulationFrame,
  buildSignalCatalog,
  isValidLatitude,
  isValidLongitude,
  MODULATION_CONTRACT,
  mappingCatalog,
  sourceDefinitions,
  type ModulationFrame
} from "@cosmoaudition/core";
import { activeSourceIds, collectSnapshot, type SnapshotOptions } from "../adapters";
import type { FetchMode } from "../adapters/types";

export const apiRoutes = new Hono();
const decimalNumberPattern = /^[-+]?(?:\d+\.?\d*|\.\d+)$/;
const MAX_POSTED_SNAPSHOT_BYTES = 1024 * 1024;

function parseMode(value: string | undefined): { value: FetchMode } | { error: string } {
  if (value === undefined || value === "" || value === "live") {
    return { value: "live" };
  }

  if (value === "fixture") {
    return { value: "fixture" };
  }

  return { error: "mode must be either fixture or live." };
}

function parseCoordinate(
  value: string | undefined,
  label: "lat" | "lon",
  isValid: (value: number) => boolean
): { value?: number; error?: string } {
  if (value === undefined) {
    return {};
  }

  const trimmed = value.trim();
  if (!decimalNumberPattern.test(trimmed)) {
    return { error: `${label} must be a decimal number.` };
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || !isValid(parsed)) {
    return { error: `${label} is outside the supported coordinate range.` };
  }

  return { value: parsed };
}

function snapshotOptionsFromQuery(context: {
  req: { query(name: string): string | undefined };
}): { options: SnapshotOptions } | { error: string } {
  const mode = parseMode(context.req.query("mode"));
  if ("error" in mode) {
    return { error: mode.error };
  }

  const latitude = parseCoordinate(context.req.query("lat"), "lat", isValidLatitude);
  if (latitude.error !== undefined) {
    return { error: latitude.error };
  }

  const longitude = parseCoordinate(
    context.req.query("lon"),
    "lon",
    isValidLongitude
  );
  if (longitude.error !== undefined) {
    return { error: longitude.error };
  }
  const sources = parseSources(context.req.query("sources"));
  if ("error" in sources) return { error: sources.error };

  return {
    options: {
      mode: mode.value,
      ...(latitude.value === undefined ? {} : { latitude: latitude.value }),
      ...(longitude.value === undefined ? {} : { longitude: longitude.value }),
      ...(sources.value === undefined ? {} : { sourceIds: sources.value })
    }
  };
}

function parseSources(
  value: string | undefined
): { value?: string[] } | { error: string } {
  if (value === undefined || value.trim() === "") return {};
  if (value.length > 2048) return { error: "sources selection is too long." };
  const ids = value.split(",").map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0 || ids.length > activeSourceIds.length) {
    return { error: "sources must select one or more active source ids." };
  }
  const unique = [...new Set(ids)];
  const active = new Set(activeSourceIds);
  const unknown = unique.find((id) => !active.has(id));
  return unknown
    ? { error: `unknown active source id: ${unknown}` }
    : { value: unique };
}

function masaRecordHref(options: SnapshotOptions): string {
  const query = new URLSearchParams({ mode: options.mode });
  if (options.latitude !== undefined) query.set("lat", String(options.latitude));
  if (options.longitude !== undefined) query.set("lon", String(options.longitude));
  if (options.sourceIds !== undefined) query.set("sources", options.sourceIds.join(","));
  return `/api/snapshot/masa?${query.toString()}`;
}

function masaErrorResponse(context: {
  json(value: unknown, status: 422 | 500): Response;
}, error: unknown): Response {
  if (error instanceof MasaSnapshotInputError) {
    return context.json({ error: error.message }, 422);
  }
  if (error instanceof MasaSnapshotValidationError) {
    return context.json({
      error: "The snapshot could not be represented as a valid MASA record.",
      diagnostics: error.diagnostics
    }, 500);
  }
  throw error;
}

apiRoutes.get("/sources", async (context) => {
  const parsed = snapshotOptionsFromQuery(context);
  if ("error" in parsed) {
    return context.json({ error: parsed.error }, 400);
  }

  const snapshot = await collectSnapshot(parsed.options);

  return context.json({
    generatedAt: snapshot.generatedAt,
    mode: parsed.options.mode,
    definitions: sourceDefinitions,
    sources: snapshot.sources,
    cache: snapshot.cache
  });
});

apiRoutes.get("/signals", (context) => {
  const sources = parseSources(context.req.query("sources"));
  if ("error" in sources) {
    return context.json({ error: sources.error }, 400);
  }
  return context.json(buildSignalCatalog(sources.value));
});

apiRoutes.get("/snapshot", async (context) => {
  const parsed = snapshotOptionsFromQuery(context);
  if ("error" in parsed) {
    return context.json({ error: parsed.error }, 400);
  }

  const snapshot = await collectSnapshot(parsed.options);

  if (context.req.query("masa") !== "summary") {
    return context.json(snapshot);
  }

  try {
    const record = await buildSnapshotMatterRecord(snapshot);
    return context.json({
      ...snapshot,
      masa: createMasaSnapshotSummary(
        record,
        masaRecordHref(parsed.options)
      )
    });
  } catch (error) {
    return masaErrorResponse(context, error);
  }
});

/**
 * The modulation-framework surface. `/frame` is one accepted observation
 * resolved into controls; `/stream` republishes it on a declared cadence.
 * Both are read-only projections of the same account the MASA route serves.
 */
apiRoutes.get("/modulation", (context) =>
  context.json({
    contract: MODULATION_CONTRACT,
    frame: "/api/frame",
    stream: "/api/stream",
    masaRecord: "/api/snapshot/masa",
    signalCatalog: "/api/signals",
    mappings: mappingCatalog.map((mapping) => ({
      id: mapping.id,
      signalId: mapping.signalId,
      target: mapping.target,
      layer: mapping.layer,
      outputRange: mapping.outputRange,
      curve: mapping.scale,
      smoothingMs: mapping.smoothingMs,
      missingData: mapping.missingData,
      epistemicNote: mapping.epistemicNote
    })),
    note: "A control value without its status discards the frame's evidence. Read controls[] and absences[], not values{} alone."
  })
);

apiRoutes.get("/frame", async (context) => {
  const parsed = snapshotOptionsFromQuery(context);
  if ("error" in parsed) {
    return context.json({ error: parsed.error }, 400);
  }
  return context.json(await collectFrame(parsed.options));
});

apiRoutes.get("/stream", async (context) => {
  const parsed = snapshotOptionsFromQuery(context);
  if ("error" in parsed) {
    return context.json({ error: parsed.error }, 400);
  }
  const interval = parseIntervalMs(context.req.query("intervalMs"));
  if (typeof interval !== "number") {
    return context.json({ error: interval.error }, 400);
  }

  return streamSSE(context, async (stream) => {
    let closed = false;
    stream.onAbort(() => {
      closed = true;
    });

    while (!closed) {
      try {
        const frame = await collectFrame(parsed.options);
        await stream.writeSSE({
          event: "frame",
          id: frame.frameId,
          data: JSON.stringify(frame)
        });
      } catch (error) {
        // A failed acquisition is reported as an event rather than closing the
        // stream: the consumer learns that this cadence produced no
        // observation instead of silently receiving the previous one again.
        await stream.writeSSE({
          event: "acquisition-error",
          data: JSON.stringify({
            generatedAt: new Date().toISOString(),
            message: error instanceof Error ? error.message : "Acquisition failed."
          })
        });
      }
      if (closed) break;
      await stream.sleep(interval);
    }
  });
});

apiRoutes.get("/snapshot/masa", async (context) => {
  const parsed = snapshotOptionsFromQuery(context);
  if ("error" in parsed) {
    return context.json({ error: parsed.error }, 400);
  }

  const snapshot = await collectSnapshot(parsed.options);
  try {
    const record = await buildSnapshotMatterRecord(snapshot);
    context.header(
      "Content-Type",
      `${MASA_RECORD_MEDIA_TYPE}; charset=UTF-8`
    );
    context.header("Cache-Control", "no-store");
    context.header(
      "Content-Disposition",
      `inline; filename="cosmoaudition-${snapshot.mode}-snapshot.masa.json"`
    );
    return context.body(serializeSnapshotMatterRecord(record));
  } catch (error) {
    return masaErrorResponse(context, error);
  }
});

apiRoutes.post("/snapshot/masa", async (context) => {
  const contentLength = Number(context.req.header("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_POSTED_SNAPSHOT_BYTES) {
    return context.json({ error: "Snapshot payload exceeds the 1 MiB boundary." }, 413);
  }
  const contentType = context.req.header("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("json")) {
    return context.json({ error: "Snapshot payload must use a JSON content type." }, 415);
  }
  let text: string;
  try {
    text = await readBoundedText(context.req.raw.body, MAX_POSTED_SNAPSHOT_BYTES);
  } catch (error) {
    return error instanceof PayloadTooLargeError
      ? context.json({ error: "Snapshot payload exceeds the 1 MiB boundary." }, 413)
      : context.json({ error: "Snapshot payload could not be read as UTF-8 JSON." }, 400);
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return context.json({ error: "Snapshot payload is not valid JSON." }, 400);
  }
  if (!isSnapshotEnvelope(value)) {
    return context.json({ error: "Snapshot payload is missing its bounded envelope." }, 422);
  }

  try {
    const record = await buildSnapshotMatterRecord(value);
    context.header("Content-Type", `${MASA_RECORD_MEDIA_TYPE}; charset=UTF-8`);
    context.header("Cache-Control", "no-store");
    context.header(
      "Content-Disposition",
      `attachment; filename="cosmoaudition-${safeFilenamePart(value.mode)}-snapshot.masa.json"`
    );
    return context.body(serializeSnapshotMatterRecord(record));
  } catch (error) {
    return masaErrorResponse(context, error);
  }
});

class PayloadTooLargeError extends Error {}

/**
 * Read a request body with the byte cap enforced while streaming. A
 * Content-Length header is advisory: a chunked request without one would
 * otherwise be buffered whole before any size check could reject it.
 */
async function readBoundedText(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number
): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new PayloadTooLargeError("Payload exceeds the configured boundary.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

const MIN_STREAM_INTERVAL_MS = 1_000;
const MAX_STREAM_INTERVAL_MS = 600_000;
const DEFAULT_STREAM_INTERVAL_MS = 60_000;

function parseIntervalMs(value: string | undefined): number | { error: string } {
  if (value === undefined || value.trim() === "") return DEFAULT_STREAM_INTERVAL_MS;
  if (!/^\d{1,7}$/.test(value.trim())) {
    return { error: "intervalMs must be an integer number of milliseconds." };
  }
  const parsed = Number.parseInt(value, 10);
  if (parsed < MIN_STREAM_INTERVAL_MS || parsed > MAX_STREAM_INTERVAL_MS) {
    return {
      error: `intervalMs must be between ${MIN_STREAM_INTERVAL_MS} and ${MAX_STREAM_INTERVAL_MS}. Provider cadence is measured in minutes; a faster stream repeats one observation rather than acquiring a new one.`
    };
  }
  return parsed;
}

async function collectFrame(options: SnapshotOptions): Promise<ModulationFrame> {
  const snapshot = await collectSnapshot(options);
  return buildModulationFrame({
    generatedAt: snapshot.generatedAt,
    mode: options.mode,
    signals: snapshot.signals,
    sources: snapshot.sources,
    ...(snapshot.cache === undefined ? {} : { cache: snapshot.cache }),
    masaRecordHref: masaRecordHref(options)
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSnapshotEnvelope(value: unknown): value is SnapshotLike {
  if (!isPlainObject(value)) return false;
  const record = value;
  return (
    typeof record.generatedAt === "string" &&
    typeof record.mode === "string" &&
    // Every member must be an object: the record builder reads signal and
    // source fields directly, so a null or primitive member would surface as
    // an unhandled TypeError instead of a bounded 422.
    Array.isArray(record.signals) &&
    record.signals.every(isPlainObject) &&
    Array.isArray(record.sources) &&
    record.sources.every(isPlainObject) &&
    (record.cache === undefined ||
      (Array.isArray(record.cache) && record.cache.every(isPlainObject))) &&
    (record.mappingRoutes === undefined || isPlainObject(record.mappingRoutes)) &&
    (record.coordinates === undefined || isPlainObject(record.coordinates))
  );
}

function safeFilenamePart(value: string): string {
  const safe = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 32);
  return safe || "local";
}
