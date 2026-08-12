import {
  createHealthFromLoad,
  createSignal,
  loadPayload,
  localWallClockToInstant,
  numberOrNull,
  requireSource
} from "./helpers";
import type { AdapterContext, AdapterResult, SourceAdapter } from "./types";

interface MarinePayload {
  utc_offset_seconds?: unknown;
  current?: {
    time?: unknown;
    wave_height?: unknown;
    wave_period?: unknown;
    sea_surface_temperature?: unknown;
    ocean_current_velocity?: unknown;
    sea_level_height_msl?: unknown;
  };
}

function marineUrl(latitude: number, longitude: number): string {
  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    current:
      "wave_height,wave_period,sea_surface_temperature,ocean_current_velocity,sea_level_height_msl",
    timezone: "auto"
  });
  return `https://marine-api.open-meteo.com/v1/marine?${params.toString()}`;
}

export const openMeteoMarineAdapter: SourceAdapter = {
  sourceId: "open_meteo_marine",
  async read(context: AdapterContext): Promise<AdapterResult> {
    const source = requireSource("open_meteo_marine");
    const url = marineUrl(context.latitude, context.longitude);
    const cacheVariant =
      `lat=${context.latitude.toFixed(4)}&lon=${context.longitude.toFixed(4)}`;
    let loaded;
    try {
      loaded = await loadPayload<MarinePayload>({
        source,
        context,
        url,
        fixturePath: "open-meteo-marine-bogota.json",
        cacheVariant,
        allowLiveFixtureFallback: false
      });
    } catch (error) {
      return unavailableResult(
        context,
        url,
        cacheVariant,
        error instanceof Error ? error.message : String(error)
      );
    }

    const current = loaded.payload.current;
    const timestamp = localWallClockToInstant(
      current?.time,
      loaded.payload.utc_offset_seconds,
      loaded.fetchedAt
    );
    const values = {
      marine_wave_height: numberOrNull(current?.wave_height),
      marine_wave_period: numberOrNull(current?.wave_period),
      marine_sea_surface_temperature: numberOrNull(current?.sea_surface_temperature),
      marine_ocean_current_velocity: numberOrNull(current?.ocean_current_velocity),
      marine_sea_level_height_msl: numberOrNull(current?.sea_level_height_msl)
    };
    const parseError =
      current === undefined
        ? "Open-Meteo marine payload missing current values."
        : undefined;
    const allUnavailable = Object.values(values).every((value) => value === null);
    const confidence = parseError ? "error" : loaded.confidence;
    const common = {
      layer: "earth" as const,
      timestamp,
      source,
      sourceUrl: loaded.sourceUrl,
      confidence,
      ...(parseError === undefined ? {} : { error: parseError }),
      notes: allUnavailable
        ? "The marine model returned no value for this inland or unsupported point; no coastal value was substituted."
        : "Marine-model forecast for manually supplied coordinates; not an in-situ buoy observation."
    };

    return {
      source,
      signals: [
        createSignal({ ...common, id: "marine_wave_height", label: "Marine wave height", unit: "m", value: values.marine_wave_height }),
        createSignal({ ...common, id: "marine_wave_period", label: "Marine wave period", unit: "s", value: values.marine_wave_period }),
        createSignal({ ...common, id: "marine_sea_surface_temperature", label: "Sea-surface temperature", unit: "C", value: values.marine_sea_surface_temperature }),
        createSignal({ ...common, id: "marine_ocean_current_velocity", label: "Ocean-current velocity", unit: "km/h", value: values.marine_ocean_current_velocity }),
        createSignal({ ...common, id: "marine_sea_level_height_msl", label: "Sea-level height above mean sea level", unit: "m", value: values.marine_sea_level_height_msl })
      ],
      health:
        parseError === undefined
          ? createHealthFromLoad(source, loaded, context.now)
          : {
              ...createHealthFromLoad(source, loaded, context.now),
              confidence: "error",
              error: parseError
            },
      cache: loaded.metadata
    };
  }
};

function unavailableResult(
  context: AdapterContext,
  url: string,
  cacheVariant: string,
  error: string
): AdapterResult {
  const source = requireSource("open_meteo_marine");
  const timestamp = context.now.toISOString();
  const common = {
    layer: "earth" as const,
    value: null,
    timestamp,
    source,
    sourceUrl: url,
    confidence: "error" as const,
    error,
    notes:
      "No matching locality cache was available; no fixture or coastal value was substituted."
  };
  return {
    source,
    signals: [
      createSignal({ ...common, id: "marine_wave_height", label: "Marine wave height", unit: "m" }),
      createSignal({ ...common, id: "marine_wave_period", label: "Marine wave period", unit: "s" }),
      createSignal({ ...common, id: "marine_sea_surface_temperature", label: "Sea-surface temperature", unit: "C" }),
      createSignal({ ...common, id: "marine_ocean_current_velocity", label: "Ocean-current velocity", unit: "km/h" }),
      createSignal({ ...common, id: "marine_sea_level_height_msl", label: "Sea-level height above mean sea level", unit: "m" })
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
