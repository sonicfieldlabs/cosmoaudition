import {
  createHealthFromLoad,
  createSignal,
  loadPayload,
  localWallClockToInstant,
  numberOrNull,
  requireSource
} from "./helpers";
import type { AdapterContext, AdapterResult, SourceAdapter } from "./types";

interface AirQualityPayload {
  utc_offset_seconds?: unknown;
  current?: {
    time?: unknown;
    pm10?: unknown;
    pm2_5?: unknown;
    nitrogen_dioxide?: unknown;
    ozone?: unknown;
    us_aqi?: unknown;
  };
}

function airQualityUrl(latitude: number, longitude: number): string {
  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    current: "pm10,pm2_5,nitrogen_dioxide,ozone,us_aqi",
    timezone: "auto"
  });
  return `https://air-quality-api.open-meteo.com/v1/air-quality?${params.toString()}`;
}

export const openMeteoAirQualityAdapter: SourceAdapter = {
  sourceId: "open_meteo_air_quality",
  async read(context: AdapterContext): Promise<AdapterResult> {
    const source = requireSource("open_meteo_air_quality");
    const url = airQualityUrl(context.latitude, context.longitude);
    const cacheVariant =
      `lat=${context.latitude.toFixed(4)}&lon=${context.longitude.toFixed(4)}`;
    let loaded;
    try {
      loaded = await loadPayload<AirQualityPayload>({
        source,
        context,
        url,
        fixturePath: "open-meteo-air-quality-bogota.json",
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
      air_quality_pm10: numberOrNull(current?.pm10),
      air_quality_pm2_5: numberOrNull(current?.pm2_5),
      air_quality_nitrogen_dioxide: numberOrNull(current?.nitrogen_dioxide),
      air_quality_ozone: numberOrNull(current?.ozone),
      air_quality_us_aqi: numberOrNull(current?.us_aqi)
    };
    const parseError =
      current === undefined
        ? "Open-Meteo air-quality payload missing current values."
        : undefined;
    const confidence = parseError ? "error" : loaded.confidence;
    const common = {
      layer: "earth" as const,
      timestamp,
      source,
      sourceUrl: loaded.sourceUrl,
      confidence,
      ...(parseError === undefined ? {} : { error: parseError }),
      notes:
        "Modelled air-quality value for manual coordinates; not a local monitor reading."
    };

    return {
      source,
      signals: [
        createSignal({ ...common, id: "air_quality_pm10", label: "PM10 concentration", unit: "ug/m3", value: values.air_quality_pm10 }),
        createSignal({ ...common, id: "air_quality_pm2_5", label: "PM2.5 concentration", unit: "ug/m3", value: values.air_quality_pm2_5 }),
        createSignal({ ...common, id: "air_quality_nitrogen_dioxide", label: "Nitrogen dioxide concentration", unit: "ug/m3", value: values.air_quality_nitrogen_dioxide }),
        createSignal({ ...common, id: "air_quality_ozone", label: "Ozone concentration", unit: "ug/m3", value: values.air_quality_ozone }),
        createSignal({ ...common, id: "air_quality_us_aqi", label: "US air quality index", unit: "US AQI", value: values.air_quality_us_aqi })
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
  const source = requireSource("open_meteo_air_quality");
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
      "No matching locality cache was available; the Bogotá fixture was not substituted."
  };
  return {
    source,
    signals: [
      createSignal({ ...common, id: "air_quality_pm10", label: "PM10 concentration", unit: "ug/m3" }),
      createSignal({ ...common, id: "air_quality_pm2_5", label: "PM2.5 concentration", unit: "ug/m3" }),
      createSignal({ ...common, id: "air_quality_nitrogen_dioxide", label: "Nitrogen dioxide concentration", unit: "ug/m3" }),
      createSignal({ ...common, id: "air_quality_ozone", label: "Ozone concentration", unit: "ug/m3" }),
      createSignal({ ...common, id: "air_quality_us_aqi", label: "US air quality index", unit: "US AQI" })
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
