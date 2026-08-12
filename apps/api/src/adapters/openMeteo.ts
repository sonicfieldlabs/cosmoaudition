import {
  createHealthFromLoad,
  createSignal,
  loadPayload,
  localWallClockToInstant,
  normalizeLinear,
  numberOrNull,
  requireSource
} from "./helpers";
import type { AdapterContext, AdapterResult, SourceAdapter } from "./types";

interface OpenMeteoPayload {
  /** Offset of the returned local times from UTC, in seconds. */
  utc_offset_seconds?: unknown;
  current?: {
    time?: string;
    temperature_2m?: unknown;
    wind_speed_10m?: unknown;
    precipitation?: unknown;
  };
}

/**
 * Resolve Open-Meteo's zone-local `current.time` into an absolute instant
 * using the offset the same payload declares. Without the offset there is no
 * instant to resolve, so the acquisition time is used rather than a guess.
 */
function openMeteoUrl(latitude: number, longitude: number): string {
  const lat = latitude.toFixed(4);
  const lon = longitude.toFixed(4);
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,wind_speed_10m,precipitation&timezone=auto`;
}

export const openMeteoAdapter: SourceAdapter = {
  sourceId: "open_meteo_local",
  async read(context: AdapterContext): Promise<AdapterResult> {
    const source = requireSource("open_meteo_local");
    const url = openMeteoUrl(context.latitude, context.longitude);
    const cacheVariant = `lat=${context.latitude.toFixed(4)}&lon=${context.longitude.toFixed(4)}`;
    let loaded;
    try {
      loaded = await loadPayload<OpenMeteoPayload>({
        source,
        context,
        url,
        fixturePath: "open-meteo-bogota.json",
        cacheVariant,
        allowLiveFixtureFallback: false
      });
    } catch (error) {
      return unavailableWeatherResult(
        context,
        url,
        cacheVariant,
        error instanceof Error ? error.message : String(error)
      );
    }

    const current = loaded.payload.current;
    // Open-Meteo is queried with timezone=auto, so `current.time` is local to
    // the requested coordinates and carries no offset. Storing it raw makes
    // every consumer read it as its own local time, which misdates the
    // observation by the difference between the two zones. Convert it with the
    // offset the provider reports, and fall back to acquisition time when that
    // offset is missing rather than guessing.
    const timestamp = localWallClockToInstant(
      current?.time,
      loaded.payload.utc_offset_seconds,
      loaded.fetchedAt
    );
    const temperature = numberOrNull(current?.temperature_2m);
    const wind = numberOrNull(current?.wind_speed_10m);
    const precipitation = numberOrNull(current?.precipitation);
    const parseError =
      current === undefined
        ? "Open-Meteo payload missing current values."
        : undefined;
    const confidence = parseError ? "error" : loaded.confidence;

    return {
      source,
      signals: [
        createSignal({
          id: "local_temperature_2m",
          label: "Local temperature",
          layer: "user",
          unit: "C",
          value: temperature,
          normalized: normalizeLinear(temperature, [-10, 40]),
          timestamp,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence,
          ...(parseError ? { error: parseError } : {}),
          notes:
            context.mode === "fixture"
              ? "Bundled Bogota weather fixture; no automatic geolocation."
              : "Manual coordinate weather signal; no automatic geolocation."
        }),
        createSignal({
          id: "local_wind_speed_10m",
          label: "Local wind speed",
          layer: "earth",
          unit: "km/h",
          value: wind,
          normalized: normalizeLinear(wind, [0, 90]),
          timestamp,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence,
          ...(parseError ? { error: parseError } : {})
        }),
        createSignal({
          id: "local_precipitation",
          label: "Local precipitation",
          layer: "earth",
          unit: "mm",
          value: precipitation,
          normalized: normalizeLinear(precipitation, [0, 20]),
          timestamp,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence,
          ...(parseError ? { error: parseError } : {})
        })
      ],
      health: parseError
        ? {
            ...createHealthFromLoad(source, loaded, context.now),
            confidence: "error" as const,
            error: parseError
          }
        : createHealthFromLoad(source, loaded, context.now),
      cache: loaded.metadata
    };
  }
};

function unavailableWeatherResult(
  context: AdapterContext,
  url: string,
  cacheVariant: string,
  error: string
): AdapterResult {
  const source = requireSource("open_meteo_local");
  const timestamp = context.now.toISOString();
  const signalOptions = {
    layer: "earth" as const,
    timestamp,
    source,
    sourceUrl: url,
    confidence: "error" as const,
    error,
    notes:
      "No matching locality cache was available. The bundled Bogota fixture was not substituted."
  };

  return {
    source,
    signals: [
      createSignal({
        ...signalOptions,
        id: "local_temperature_2m",
        label: "Local temperature",
        layer: "user",
        unit: "C",
        value: null,
        normalized: null
      }),
      createSignal({
        ...signalOptions,
        id: "local_wind_speed_10m",
        label: "Local wind speed",
        unit: "km/h",
        value: null,
        normalized: null
      }),
      createSignal({
        ...signalOptions,
        id: "local_precipitation",
        label: "Local precipitation",
        unit: "mm",
        value: null,
        normalized: null
      })
    ],
    health: {
      sourceId: source.id,
      status: source.status,
      confidence: "error",
      fetchedAt: null,
      staleAfterSeconds: source.ttlSeconds,
      error
    },
    cache: {
      sourceId: source.id,
      cacheKey: `error:${source.id}:${cacheVariant}`,
      hit: false,
      fetchedAt: timestamp,
      expiresAt: timestamp,
      staleAt: timestamp,
      ageSeconds: 0
    }
  };
}
