import {
  clamp01,
  getSourceDefinition,
  linearNormalize,
  type CacheMetadata,
  type ObservedSignal,
  type SourceDefinition
} from "@cosmoaudition/core";
import { carbonGenerationAdapter, carbonIntensityAdapter } from "./carbon";
import { gbfsBogotaStationStatusAdapter } from "./gbfs";
import { jplFireballAdapter } from "./fireball";
import { inaturalistRecentObservationsAdapter } from "./inaturalist";
import { jplCloseApproachesAdapter } from "./jpl";
import { mempoolHashrateAdapter, mempoolStatsAdapter } from "./mempool";
import { openMeteoAdapter } from "./openMeteo";
import {
  swpcMagneticFieldAdapter,
  swpcPlanetaryKIndexAdapter,
  swpcSolarWindSpeedAdapter
} from "./swpc";
import { usgsEarthquakesAdapter } from "./usgs";
import { wikimediaPageviewsAdapter } from "./wikimedia";
import type { AdapterContext, AdapterResult, FetchMode, SourceAdapter } from "./types";

const activeAdapters: readonly SourceAdapter[] = [
  carbonIntensityAdapter,
  carbonGenerationAdapter,
  openMeteoAdapter,
  usgsEarthquakesAdapter,
  swpcSolarWindSpeedAdapter,
  swpcMagneticFieldAdapter,
  swpcPlanetaryKIndexAdapter,
  jplCloseApproachesAdapter,
  jplFireballAdapter,
  inaturalistRecentObservationsAdapter,
  wikimediaPageviewsAdapter,
  mempoolStatsAdapter,
  mempoolHashrateAdapter,
  gbfsBogotaStationStatusAdapter
] as const;

export interface SnapshotOptions {
  mode: FetchMode;
  latitude?: number;
  longitude?: number;
  now?: Date;
  sourceIds?: readonly string[];
}

export const activeSourceIds = activeAdapters.map((adapter) => adapter.sourceId);

const DEFAULT_COORDINATES = {
  latitude: 4.711,
  longitude: -74.0721
} as const;

export async function collectSnapshot(options: SnapshotOptions) {
  const now = options.now ?? new Date();
  const requestedCoordinates = {
    latitude: options.latitude ?? DEFAULT_COORDINATES.latitude,
    longitude: options.longitude ?? DEFAULT_COORDINATES.longitude
  };
  // Every bundled weather fixture describes Bogota. Fixture mode therefore
  // reports and uses those coordinates instead of relabeling that payload as a
  // user-requested locality.
  const effectiveCoordinates =
    options.mode === "fixture" ? DEFAULT_COORDINATES : requestedCoordinates;
  const context: AdapterContext = {
    mode: options.mode,
    now,
    latitude: effectiveCoordinates.latitude,
    longitude: effectiveCoordinates.longitude
  };
  const adapters = resolveAdapters(options.sourceIds);

  const results = await Promise.all(
    adapters.map(async (adapter): Promise<AdapterResult> => {
      try {
        return await adapter.read(context);
      } catch (error) {
        return createAdapterFailureResult(
          adapter.sourceId,
          error instanceof Error ? error.message : String(error),
          now
        );
      }
    })
  );

  const signals = results.flatMap((result) => result.signals);
  signals.push(createStaleSourceSignal(results, now, adapters.length));

  return {
    generatedAt: now.toISOString(),
    mode: options.mode,
    selectedSourceIds: adapters.map((adapter) => adapter.sourceId),
    coordinates: {
      latitude: context.latitude,
      longitude: context.longitude,
      basis: options.mode === "fixture" ? "bundled-bogota-fixture" : "requested"
    },
    ...(options.mode === "fixture" &&
    (requestedCoordinates.latitude !== DEFAULT_COORDINATES.latitude ||
      requestedCoordinates.longitude !== DEFAULT_COORDINATES.longitude)
      ? { requestedCoordinates }
      : {}),
    signals,
    sources: results.map((result) => result.health),
    cache: results.map((result) => result.cache)
  };
}

function resolveAdapters(sourceIds: readonly string[] | undefined): readonly SourceAdapter[] {
  if (sourceIds === undefined) return activeAdapters;
  const requested = new Set(sourceIds);
  const adapters = activeAdapters.filter((adapter) => requested.has(adapter.sourceId));
  if (adapters.length !== requested.size || adapters.length === 0) {
    throw new RangeError("Source selection contains an unknown or empty adapter set.");
  }
  return adapters;
}

function createAdapterFailureResult(
  sourceId: string,
  error: string,
  now: Date
): AdapterResult {
  const source = getSourceDefinition(sourceId);
  if (!source) {
    throw new Error(`Unknown source definition for failed adapter: ${sourceId}`);
  }

  const cache = createFailureCacheMetadata(source, now);

  return {
    source,
    signals: [],
    health: {
      sourceId,
      status: source.status,
      confidence: "error",
      fetchedAt: null,
      staleAfterSeconds: source.ttlSeconds,
      error
    },
    cache
  };
}

function createFailureCacheMetadata(
  source: SourceDefinition,
  now: Date
): CacheMetadata {
  const timestamp = now.toISOString();

  return {
    sourceId: source.id,
    cacheKey: `error:${source.id}`,
    hit: false,
    fetchedAt: timestamp,
    expiresAt: timestamp,
    staleAt: timestamp,
    ageSeconds: 0
  };
}

function createStaleSourceSignal(
  results: readonly AdapterResult[],
  now: Date,
  sourceCount: number
): ObservedSignal {
  const count = results.filter(
    (result) =>
      result.health.confidence === "stale" ||
      result.health.confidence === "error" ||
      result.health.error !== undefined
  ).length;
  // Normalize against the full active aperture, not the selected subset, so
  // the signal's own normalized value and the catalog mapping's input range
  // tell one story. Against the subset, three stale sources out of three
  // selected would read as total failure while the mapping read it as a
  // fraction of fourteen.
  const normalized = linearNormalize(count, [0, activeSourceIds.length]);

  return {
    id: "source_stale_count",
    label: "Stale source count",
    layer: "interface",
    unit: "sources",
    value: count,
    normalized: clamp01(normalized),
    timestamp: now.toISOString(),
    sourceId: "system",
    confidence: count === 0 ? "high" : "medium",
    staleAfterSeconds: 30,
    notes:
      "Counts stale, errored, or live-fallback API sources in the current snapshot."
  };
}
