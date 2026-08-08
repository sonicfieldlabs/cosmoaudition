import type {
  CacheMetadata,
  Confidence,
  SourceDefinition
} from "@cosmoaudition/core";
import { readCache, readFixture, writeCache } from "../cache/fsCache";
import {
  createHealthFromLoad,
  createSignal,
  normalizeLinear,
  requireSource
} from "./helpers";
import { fetchJson } from "./http";
import type {
  AdapterContext,
  AdapterResult,
  LoadedPayload,
  SourceAdapter
} from "./types";

interface InaturalistProviderPayload {
  total_results?: unknown;
  results?: unknown;
}

interface InaturalistAggregatePayload {
  kind: "cosmoaudition.inaturalist.aggregate.v1";
  windowStart: string;
  windowEnd: string;
  totalResults: number | null;
  newestCreatedAt: string | null;
}

const WINDOW_MS = 60 * 60 * 1000;
const CACHE_VARIANT = "scope=global&created-window=1h&projection=aggregate-v1";
const FIXTURE_PATH =
  "inaturalist-recent-observations.json";
const USER_AGENT =
  "CosmoauditionSystem/0.1 (local sonic-matter research instrument; https://sonicfield.org)";

export const inaturalistRecentObservationsAdapter: SourceAdapter = {
  sourceId: "inaturalist_recent_observations",
  async read(context: AdapterContext): Promise<AdapterResult> {
    const source = requireSource("inaturalist_recent_observations");
    const end = context.now;
    const start = new Date(end.getTime() - WINDOW_MS);
    const url = inaturalistUrl(start, end);
    const loaded = await loadInaturalistAggregate(
      source,
      context,
      url,
      start,
      end
    );
    const count = loaded.payload.totalResults;
    const rate = count === null ? null : count / 60;
    const timestamp = loaded.payload.newestCreatedAt ?? loaded.fetchedAt;
    const parseError =
      count === null
        ? loaded.error ??
          "iNaturalist payload has no valid total_results aggregate."
        : undefined;
    const confidence = parseError ? "error" : loaded.confidence;
    const privacyNote =
      "Server-side global aggregate only: usernames, taxa rows, media, and coordinates are removed before cache persistence and are not emitted.";

    return {
      source,
      signals: [
        createSignal({
          id: "inaturalist_observations_created_1h",
          label: "iNaturalist observations submitted, past hour",
          layer: "earth",
          unit: "observations",
          value: count,
          normalized: normalizeLinear(count, [0, 20_000]),
          timestamp,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence,
          epistemicStatus: "reported",
          notes: `${privacyNote} Submission activity is not organism abundance.`
        }),
        createSignal({
          id: "inaturalist_observation_rate_per_minute",
          label: "iNaturalist submission rate",
          layer: "earth",
          unit: "observations/minute",
          value: rate,
          normalized: normalizeLinear(rate, [0, 350]),
          timestamp,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence,
          epistemicStatus: "derived",
          notes: `${privacyNote} Derived from the one-hour count divided by 60.`
        })
      ],
      health: parseError
        ? {
            ...createHealthFromLoad(source, loaded, context.now),
            confidence: "error" as Confidence,
            error: parseError
          }
        : createHealthFromLoad(source, loaded, context.now),
      cache: loaded.metadata
    };
  }
};

function reduceInaturalistPayload(
  payload: unknown,
  windowStart: Date,
  windowEnd: Date
): InaturalistAggregatePayload {
  const provider = isRecord(payload)
    ? (payload as InaturalistProviderPayload)
    : {};
  const results = Array.isArray(provider.results) ? provider.results : [];
  const newestCreatedAt = results
    .map((row) =>
      isRecord(row) ? validTimestamp(row.created_at) : null
    )
    .find((timestamp): timestamp is string => timestamp !== null) ?? null;

  return {
    kind: "cosmoaudition.inaturalist.aggregate.v1",
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    totalResults: integerOrNull(provider.total_results),
    newestCreatedAt
  };
}

async function loadInaturalistAggregate(
  source: SourceDefinition,
  context: AdapterContext,
  url: string,
  windowStart: Date,
  windowEnd: Date
): Promise<LoadedPayload<InaturalistAggregatePayload>> {
  if (context.mode === "fixture") {
    const fixture = await readFixture<unknown>(
      source,
      FIXTURE_PATH,
      context.now,
      CACHE_VARIANT
    );
    if (!isInaturalistAggregate(fixture.payload)) {
      throw new Error("iNaturalist fixture is not the aggregate-only schema.");
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
    isInaturalistAggregate(cachedBeforeFetch.payload) &&
    cachedBeforeFetch.payload.totalResults !== null
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
      headers: { "User-Agent": USER_AGENT }
    });
    // Reduction happens in memory before writeCache sees the payload. Provider
    // rows, user records, media, taxa, and coordinates cannot enter this cache.
    const aggregate = reduceInaturalistPayload(
      providerPayload,
      windowStart,
      windowEnd
    );
    if (aggregate.totalResults === null) {
      return await inaturalistFallback(
        source,
        context,
        url,
        windowStart,
        windowEnd,
        "Live iNaturalist payload has no valid total_results aggregate."
      );
    }

    const fetchedAt = context.now.toISOString();
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
    return await inaturalistFallback(
      source,
      context,
      url,
      windowStart,
      windowEnd,
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function inaturalistFallback(
  source: SourceDefinition,
  context: AdapterContext,
  url: string,
  windowStart: Date,
  windowEnd: Date,
  error: string
): Promise<LoadedPayload<InaturalistAggregatePayload>> {
  const cached = await readCache<unknown>(
    source,
    context.now,
    CACHE_VARIANT
  );
  if (
    cached &&
    isInaturalistAggregate(cached.payload) &&
    cached.payload.totalResults !== null
  ) {
    return {
      payload: cached.payload,
      confidence: cached.stale ? "stale" : "medium",
      fetchedAt: cached.metadata.fetchedAt,
      sourceUrl: url,
      metadata: cached.metadata,
      error: `Live fetch failed, using aggregate-only cache: ${error}`
    };
  }

  const fetchedAt = context.now.toISOString();
  return {
    payload: {
      kind: "cosmoaudition.inaturalist.aggregate.v1",
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      totalResults: null,
      newestCreatedAt: null
    },
    confidence: "error",
    fetchedAt,
    sourceUrl: url,
    metadata: failureMetadata(source, fetchedAt),
    error: `Live fetch failed and no aggregate-only cache is available: ${error}`
  };
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

function isInaturalistAggregate(
  value: unknown
): value is InaturalistAggregatePayload {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.kind === "cosmoaudition.inaturalist.aggregate.v1" &&
    validTimestamp(value.windowStart) !== null &&
    validTimestamp(value.windowEnd) !== null &&
    (value.totalResults === null || integerOrNull(value.totalResults) !== null) &&
    (value.newestCreatedAt === null ||
      validTimestamp(value.newestCreatedAt) !== null)
  );
}

function inaturalistUrl(start: Date, end: Date): string {
  const params = new URLSearchParams({
    created_d1: start.toISOString(),
    created_d2: end.toISOString(),
    per_page: "1",
    order: "desc",
    order_by: "created_at"
  });
  return `https://api.inaturalist.org/v1/observations?${params.toString()}`;
}

function integerOrNull(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : null;
}

function validTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    return null;
  }

  return new Date(value).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
