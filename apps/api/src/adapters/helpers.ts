import {
  createSourceHealth,
  getSourceDefinition,
  getSignalDefinition,
  nullableLinearNormalize,
  nullableLogNormalize,
  normalizeSignalValue,
  parseAbsoluteTime,
  type Confidence,
  type EpistemicStatus,
  type ObservationSphere,
  type ObservedSignal,
  type SourceDefinition,
  type StackLayer,
  type TemporalCharacter
} from "@cosmoaudition/core";
import { readCache, readFixture, writeCache } from "../cache/fsCache";
import { fetchJson } from "./http";
import type { AdapterContext, LoadedPayload } from "./types";

export function requireSource(sourceId: string): SourceDefinition {
  const source = getSourceDefinition(sourceId);
  if (!source) {
    throw new Error(`Unknown source definition: ${sourceId}`);
  }

  return source;
}

export function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function missingDeclaredFieldsError(
  values: readonly (number | null)[],
  message: string
): string | undefined {
  return values.every((value) => value === null) ? message : undefined;
}

export function arrayOrEmpty(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function createSignal(options: {
  id: string;
  label: string;
  layer: StackLayer;
  unit: string;
  value: number | null;
  normalized?: number | null;
  timestamp: string;
  observedInterval?: ObservedSignal["observedInterval"];
  source: SourceDefinition;
  sourceUrl?: string | undefined;
  sphere?: ObservationSphere | undefined;
  epistemicStatus?: EpistemicStatus | undefined;
  temporalCharacter?: TemporalCharacter | undefined;
  signalKind?: ObservedSignal["signalKind"];
  eventKey?: string | undefined;
  confidence: Confidence;
  error?: string | undefined;
  notes?: string | undefined;
}): ObservedSignal {
  const definition = getSignalDefinition(options.id, options.source.id);
  if (definition === undefined) {
    throw new Error(`Signal is not declared in the catalog: ${options.id}`);
  }
  if (
    definition.sourceId !== options.source.id ||
    definition.layer !== options.layer ||
    definition.unit !== options.unit
  ) {
    throw new Error(
      `Signal ${options.id} does not match its catalog source, layer, or unit.`
    );
  }
  if (
    (options.sphere !== undefined && options.sphere !== definition.sphere) ||
    (options.epistemicStatus !== undefined &&
      options.epistemicStatus !== definition.epistemicStatus) ||
    (options.temporalCharacter !== undefined &&
      options.temporalCharacter !== definition.temporalCharacter) ||
    (options.signalKind !== undefined &&
      options.signalKind !== definition.signalKind)
  ) {
    throw new Error(`Signal ${options.id} conflicts with its catalog metadata.`);
  }
  const normalized = normalizeSignalValue(
    options.value,
    definition.normalization
  );
  if (
    options.normalized !== undefined &&
    (options.normalized === null || normalized === null
      ? options.normalized !== normalized
      : Math.abs(options.normalized - normalized) > 1e-12)
  ) {
    throw new Error(`Signal ${options.id} conflicts with catalog normalization.`);
  }

  return {
    id: options.id,
    label: definition.label,
    layer: definition.layer,
    unit: definition.unit,
    value: options.value,
    normalized,
    timestamp: options.timestamp,
    ...(options.observedInterval ? { observedInterval: options.observedInterval } : {}),
    sourceId: options.source.id,
    ...(options.sourceUrl === undefined ? {} : { sourceUrl: options.sourceUrl }),
    sphere: definition.sphere,
    epistemicStatus: definition.epistemicStatus,
    temporalCharacter: definition.temporalCharacter,
    signalKind: definition.signalKind,
    normalization: definition.normalization,
    ...(options.eventKey === undefined ? {} : { eventKey: options.eventKey }),
    confidence: options.confidence,
    staleAfterSeconds: options.source.ttlSeconds,
    ...(options.error === undefined ? {} : { error: options.error }),
    ...(options.notes === undefined ? {} : { notes: options.notes })
  };
}

/** Resolve a provider-local wall-clock timestamp using its declared UTC offset. */
export function localWallClockToInstant(
  localTime: unknown,
  offsetSeconds: unknown,
  fallback: string
): string {
  if (typeof localTime !== "string" || localTime.trim().length === 0) {
    return fallback;
  }
  if (typeof offsetSeconds !== "number" || !Number.isFinite(offsetSeconds)) {
    return fallback;
  }
  const asUtc = Date.parse(`${localTime.trim()}Z`);
  if (!Number.isFinite(asUtc)) return fallback;
  return new Date(asUtc - offsetSeconds * 1000).toISOString();
}

export function normalizeLinear(
  value: number | null,
  range: readonly [number, number]
): number | null {
  return nullableLinearNormalize(value, range);
}

export function normalizeLog(
  value: number | null,
  range: readonly [number, number]
): number | null {
  return nullableLogNormalize(value, range);
}

interface LoadPayloadOptions {
  source: SourceDefinition;
  context: AdapterContext;
  url: string;
  fixturePath: string;
  format?: "json" | "text";
  validate?: (payload: unknown) => void;
  cacheVariant?: string;
  allowLiveFixtureFallback?: boolean;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

const inFlightLoads = new Map<string, Promise<LoadedPayload<unknown>>>();

export async function loadPayload<T>(
  options: LoadPayloadOptions
): Promise<LoadedPayload<T>> {
  const timeoutMs = options.timeoutMs ?? 6000;

  if (options.context.mode === "fixture") {
    const fixture = await readFixture<T>(
      options.source,
      options.fixturePath,
      options.context.now,
      options.cacheVariant
    );

    return {
      payload: fixture.payload,
      confidence: "low",
      fetchedAt: fixture.metadata.fetchedAt,
      sourceUrl: options.url,
      metadata: fixture.metadata
    };
  }

  const cachedBeforeFetch = await readCache<T>(
    options.source,
    options.context.now,
    options.cacheVariant
  );
  if (cachedBeforeFetch && !cachedBeforeFetch.stale) {
    return {
      payload: cachedBeforeFetch.payload,
      confidence: "medium",
      fetchedAt: cachedBeforeFetch.metadata.fetchedAt,
      sourceUrl: options.url,
      metadata: cachedBeforeFetch.metadata
    };
  }

  const inFlightKey = `${options.source.id}:${options.cacheVariant ?? "default"}:${options.url}`;
  const existing = inFlightLoads.get(inFlightKey);
  if (existing) return (await existing) as LoadedPayload<T>;

  const pending = loadLivePayload<T>(options, timeoutMs);
  inFlightLoads.set(inFlightKey, pending as Promise<LoadedPayload<unknown>>);
  try {
    return await pending;
  } finally {
    if (inFlightLoads.get(inFlightKey) === pending) inFlightLoads.delete(inFlightKey);
  }
}

async function loadLivePayload<T>(
  options: LoadPayloadOptions,
  timeoutMs: number
): Promise<LoadedPayload<T>> {
  try {
    const payload = (await fetchJson(options.url, {
      timeoutMs,
      ...(options.format ? { format: options.format } : {}),
      ...(options.headers === undefined ? {} : { headers: options.headers }),
      ...(options.source.requestPolicy?.maxResponseBytes === undefined
        ? {}
        : { maxBytes: options.source.requestPolicy.maxResponseBytes }),
      ...(options.source.requestPolicy?.concurrencyKey === undefined
        ? {}
        : { concurrencyKey: options.source.requestPolicy.concurrencyKey })
    })) as T;
    options.validate?.(payload);
    const fetchedAt = options.context.now.toISOString();
    const metadata = await writeCache(
      options.source,
      payload,
      fetchedAt,
      options.cacheVariant
    );

    return {
      payload,
      confidence: "high",
      fetchedAt,
      sourceUrl: options.url,
      metadata
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const cached = await readCache<T>(
      options.source,
      options.context.now,
      options.cacheVariant
    );

    if (cached) {
      return {
        payload: cached.payload,
        confidence: cached.stale ? "stale" : "medium",
        fetchedAt: cached.metadata.fetchedAt,
        sourceUrl: options.url,
        metadata: cached.metadata,
        error: `Live fetch failed, using cache: ${errorMessage}`
      };
    }

    if (options.allowLiveFixtureFallback !== true) {
      throw new Error(
        `Live fetch failed and no matching cache is available: ${errorMessage}`
      );
    }

    const fixture = await readFixture<T>(
      options.source,
      options.fixturePath,
      options.context.now,
      options.cacheVariant
    );

    return {
      payload: fixture.payload,
      confidence: "low",
      fetchedAt: fixture.metadata.fetchedAt,
      sourceUrl: options.url,
      metadata: fixture.metadata,
      error: `Live fetch failed, using fixture: ${errorMessage}`
    };
  }
}

export function createHealthFromLoad<T>(
  source: SourceDefinition,
  loaded: LoadedPayload<T>,
  now: Date
) {
  const base = createSourceHealth(source, {
    fetchedAt: loaded.fetchedAt,
    now
  });

  return {
    ...base,
    confidence: loaded.confidence,
    ...(loaded.confidence === "low" ? { status: "fixture-only" as const } : {}),
    ...(loaded.error === undefined ? {} : { error: loaded.error })
  };
}

/**
 * Accept a provider timestamp only when it names an unambiguous instant.
 * A zoneless string has no absolute meaning — `Date.parse` would read it as
 * host-local — so it is rejected rather than silently localized.
 */
export function absoluteTimestampOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return parseAbsoluteTime(value) === null ? undefined : value;
}
