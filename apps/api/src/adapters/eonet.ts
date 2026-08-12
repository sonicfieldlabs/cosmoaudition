import type {
  CacheMetadata,
  Confidence,
  SourceDefinition
} from "@cosmoaudition/core";
import { readCache, readFixture, writeCache } from "../cache/fsCache";
import {
  createHealthFromLoad,
  createSignal,
  requireSource
} from "./helpers";
import { fetchJson } from "./http";
import type {
  AdapterContext,
  AdapterResult,
  LoadedPayload,
  SourceAdapter
} from "./types";

interface EonetAggregate {
  kind: "cosmoaudition.eonet.aggregate.v1";
  apertureDays: 30;
  rowLimit: 200;
  eventCount: number | null;
  wildfireCount: number | null;
  severeStormCount: number | null;
  latestGeometryAt: string | null;
}

const CACHE_VARIANT = "status=open&days=30&limit=200&projection=aggregate-v1";
const FIXTURE_PATH = "nasa-eonet-open-events-aggregate.json";
const USER_AGENT =
  "CosmoauditionSystem/0.2 (local sonic-matter research instrument; https://sonicfield.org)";

export const eonetOpenEventsAdapter: SourceAdapter = {
  sourceId: "nasa_eonet_open_events",
  async read(context: AdapterContext): Promise<AdapterResult> {
    const source = requireSource("nasa_eonet_open_events");
    const loaded = await loadEonetAggregate(source, context);
    const aggregate = loaded.payload;
    const latestAgeHours = geometryAgeHours(
      aggregate.latestGeometryAt,
      context.now
    );
    const parseError =
      aggregate.eventCount === null
        ? loaded.error ?? "NASA EONET aggregate has no valid event count."
        : undefined;
    const confidence = parseError ? "error" : loaded.confidence;
    const timestamp = aggregate.latestGeometryAt ?? loaded.fetchedAt;
    const common = {
      layer: "earth" as const,
      timestamp,
      source,
      sourceUrl: loaded.sourceUrl,
      confidence,
      ...(parseError === undefined ? {} : { error: parseError }),
      notes:
        "Aggregate-only projection of at most 200 EONET events reported open within the past 30 days; event rows and geometries are removed before cache persistence."
    };

    return {
      source,
      signals: [
        createSignal({
          ...common,
          id: "eonet_open_event_count_bounded",
          label: "NASA EONET open events in bounded aperture",
          unit: "events",
          value: aggregate.eventCount
        }),
        createSignal({
          ...common,
          id: "eonet_open_wildfire_count_bounded",
          label: "NASA EONET open wildfire events in bounded aperture",
          unit: "events",
          value: aggregate.wildfireCount
        }),
        createSignal({
          ...common,
          id: "eonet_open_severe_storm_count_bounded",
          label: "NASA EONET open severe-storm events in bounded aperture",
          unit: "events",
          value: aggregate.severeStormCount
        }),
        createSignal({
          ...common,
          id: "eonet_latest_geometry_age_hours",
          label: "Age of latest NASA EONET geometry",
          unit: "hours",
          value: latestAgeHours
        })
      ],
      health:
        parseError === undefined
          ? createHealthFromLoad(source, loaded, context.now)
          : {
              ...createHealthFromLoad(source, loaded, context.now),
              confidence: "error" as Confidence,
              error: parseError
            },
      cache: loaded.metadata
    };
  }
};

async function loadEonetAggregate(
  source: SourceDefinition,
  context: AdapterContext
): Promise<LoadedPayload<EonetAggregate>> {
  const url = source.endpoint!;
  if (context.mode === "fixture") {
    const fixture = await readFixture<unknown>(
      source,
      FIXTURE_PATH,
      context.now,
      CACHE_VARIANT
    );
    if (!isEonetAggregate(fixture.payload)) {
      throw new Error("NASA EONET fixture is not the aggregate-only schema.");
    }
    return {
      payload: fixture.payload,
      confidence: "low",
      fetchedAt: fixture.metadata.fetchedAt,
      sourceUrl: url,
      metadata: fixture.metadata
    };
  }

  const cachedBeforeFetch = await readCache<unknown>(
    source,
    context.now,
    CACHE_VARIANT
  );
  if (
    cachedBeforeFetch &&
    !cachedBeforeFetch.stale &&
    isEonetAggregate(cachedBeforeFetch.payload) &&
    cachedBeforeFetch.payload.eventCount !== null
  ) {
    return {
      payload: cachedBeforeFetch.payload,
      confidence: "medium",
      fetchedAt: cachedBeforeFetch.metadata.fetchedAt,
      sourceUrl: url,
      metadata: cachedBeforeFetch.metadata
    };
  }

  try {
    const providerPayload = await fetchJson(url, {
      timeoutMs: 6000,
      headers: { "User-Agent": USER_AGENT },
      ...(source.requestPolicy?.maxResponseBytes === undefined
        ? {}
        : { maxBytes: source.requestPolicy.maxResponseBytes }),
      ...(source.requestPolicy?.concurrencyKey === undefined
        ? {}
        : { concurrencyKey: source.requestPolicy.concurrencyKey })
    });
    const aggregate = reduceEonetPayload(providerPayload);
    if (aggregate.eventCount === null) {
      return await fallback(
        source,
        context,
        "Live NASA EONET payload has no events array."
      );
    }
    const fetchedAt = context.now.toISOString();
    // Provider titles, source links, and geometry coordinates never reach disk.
    const metadata = await writeCache(
      source,
      aggregate,
      fetchedAt,
      CACHE_VARIANT
    );
    return {
      payload: aggregate,
      confidence: "high",
      fetchedAt,
      sourceUrl: url,
      metadata
    };
  } catch (error) {
    return await fallback(
      source,
      context,
      error instanceof Error ? error.message : String(error)
    );
  }
}

function reduceEonetPayload(payload: unknown): EonetAggregate {
  const providerEvents =
    isRecord(payload) && Array.isArray(payload.events) ? payload.events : null;
  if (providerEvents === null) return emptyAggregate();
  // Enforce the declared aperture locally as well as in the provider query.
  // A provider that ignores `limit=200` must not widen the meaning, memory
  // work, or persisted aggregate of this source contract.
  const events = providerEvents.slice(0, 200).filter(isRecord);

  let wildfireCount = 0;
  let severeStormCount = 0;
  let latestGeometryAt: string | null = null;
  for (const event of events) {
    const categoryIds = Array.isArray(event.categories)
      ? event.categories
          .filter(isRecord)
          .map((category) =>
            typeof category.id === "string" ? category.id.toLowerCase() : ""
          )
      : [];
    if (categoryIds.includes("wildfires")) wildfireCount += 1;
    if (categoryIds.includes("severestorms")) severeStormCount += 1;

    if (!Array.isArray(event.geometry)) continue;
    for (const geometry of event.geometry) {
      if (!isRecord(geometry)) continue;
      const date = absoluteTimestamp(geometry.date);
      if (
        date !== null &&
        (latestGeometryAt === null || Date.parse(date) > Date.parse(latestGeometryAt))
      ) {
        latestGeometryAt = date;
      }
    }
  }

  return {
    kind: "cosmoaudition.eonet.aggregate.v1",
    apertureDays: 30,
    rowLimit: 200,
    eventCount: events.length,
    wildfireCount,
    severeStormCount,
    latestGeometryAt
  };
}

async function fallback(
  source: SourceDefinition,
  context: AdapterContext,
  error: string
): Promise<LoadedPayload<EonetAggregate>> {
  const sourceUrl = source.endpoint!;
  const cached = await readCache<unknown>(
    source,
    context.now,
    CACHE_VARIANT
  );
  if (
    cached &&
    isEonetAggregate(cached.payload) &&
    cached.payload.eventCount !== null
  ) {
    return {
      payload: cached.payload,
      confidence: cached.stale ? "stale" : "medium",
      fetchedAt: cached.metadata.fetchedAt,
      sourceUrl,
      metadata: cached.metadata,
      error: `Live fetch failed, using aggregate-only cache: ${error}`
    };
  }
  const fetchedAt = context.now.toISOString();
  return {
    payload: emptyAggregate(),
    confidence: "error",
    fetchedAt,
    sourceUrl,
    metadata: failureMetadata(source, fetchedAt),
    error: `Live fetch failed and no aggregate-only cache is available: ${error}`
  };
}

function emptyAggregate(): EonetAggregate {
  return {
    kind: "cosmoaudition.eonet.aggregate.v1",
    apertureDays: 30,
    rowLimit: 200,
    eventCount: null,
    wildfireCount: null,
    severeStormCount: null,
    latestGeometryAt: null
  };
}

function isEonetAggregate(value: unknown): value is EonetAggregate {
  return (
    isRecord(value) &&
    value.kind === "cosmoaudition.eonet.aggregate.v1" &&
    value.apertureDays === 30 &&
    value.rowLimit === 200 &&
    nullableNonNegativeInteger(value.eventCount) &&
    nullableNonNegativeInteger(value.wildfireCount) &&
    nullableNonNegativeInteger(value.severeStormCount) &&
    (value.latestGeometryAt === null || absoluteTimestamp(value.latestGeometryAt) !== null)
  );
}

function geometryAgeHours(value: string | null, now: Date): number | null {
  if (value === null) return null;
  return Math.max(0, (now.getTime() - Date.parse(value)) / 3_600_000);
}

function nullableNonNegativeInteger(value: unknown): boolean {
  return value === null ||
    (typeof value === "number" && Number.isInteger(value) && value >= 0);
}

function absoluteTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !/[zZ]|[+-]\d{2}:\d{2}$/.test(value)) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function failureMetadata(
  source: SourceDefinition,
  timestamp: string
): CacheMetadata {
  return {
    sourceId: source.id,
    cacheKey: `error:${source.id}:${CACHE_VARIANT}`,
    hit: false,
    fetchedAt: timestamp,
    expiresAt: timestamp,
    staleAt: timestamp,
    ageSeconds: 0
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
