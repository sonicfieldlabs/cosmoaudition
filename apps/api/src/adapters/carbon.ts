import {
  absoluteTimestampOrUndefined,
  createHealthFromLoad,
  createSignal,
  loadPayload,
  normalizeLinear,
  numberOrNull,
  requireSource
} from "./helpers";
import type { AdapterContext, AdapterResult, SourceAdapter } from "./types";

interface CarbonIntensityPayload {
  data?: Array<{
    from?: string;
    to?: string;
    intensity?: {
      forecast?: unknown;
      actual?: unknown;
      index?: string;
    };
  }>;
}

interface GenerationMixPayload {
  data?: {
    generationmix?: Array<{
      fuel?: string;
      perc?: unknown;
    }>;
  };
}

function carbonSignalConfidence(actual: number | null, fallbackConfidence: AdapterResult["health"]["confidence"]) {
  if (fallbackConfidence === "low" || fallbackConfidence === "stale" || fallbackConfidence === "error") {
    return fallbackConfidence;
  }

  return actual === null ? "medium" : fallbackConfidence;
}

export const carbonIntensityAdapter: SourceAdapter = {
  sourceId: "carbon_intensity_gb",
  async read(context: AdapterContext): Promise<AdapterResult> {
    const source = requireSource("carbon_intensity_gb");
    const loaded = await loadPayload<CarbonIntensityPayload>({
      source,
      context,
      url: source.endpoint!,
      fixturePath: "carbon-intensity-gb.json"
    });
    const row = loaded.payload.data?.[0];

    if (!row?.intensity) {
      throw new Error("Carbon intensity payload missing data[0].intensity.");
    }

    // `to` is the settlement period's end, which is in the future while the
    // period is still running; the value averages the interval, so its
    // observation time is the interval's start.
    const timestamp =
      absoluteTimestampOrUndefined(row.from) ??
      absoluteTimestampOrUndefined(row.to) ??
      loaded.fetchedAt;
    const actual = numberOrNull(row.intensity.actual);
    const forecast = numberOrNull(row.intensity.forecast);
    const confidence = carbonSignalConfidence(actual, loaded.confidence);

    return {
      source,
      signals: [
        createSignal({
          id: "carbon_intensity_actual",
          label: "Carbon intensity actual",
          layer: "earth",
          unit: "gCO2/kWh",
          value: actual,
          normalized: normalizeLinear(actual, [0, 500]),
          timestamp,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence,
          notes: `Index: ${row.intensity.index ?? "unknown"}`
        }),
        createSignal({
          id: "carbon_intensity_forecast",
          label: "Carbon intensity forecast",
          layer: "earth",
          unit: "gCO2/kWh",
          value: forecast,
          normalized: normalizeLinear(forecast, [0, 500]),
          timestamp,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence: loaded.confidence
        })
      ],
      health: createHealthFromLoad(source, loaded, context.now),
      cache: loaded.metadata
    };
  }
};

export const carbonGenerationAdapter: SourceAdapter = {
  sourceId: "carbon_generation_gb",
  async read(context: AdapterContext): Promise<AdapterResult> {
    const source = requireSource("carbon_generation_gb");
    const loaded = await loadPayload<GenerationMixPayload>({
      source,
      context,
      url: source.endpoint!,
      fixturePath: "carbon-generation-gb.json"
    });
    const mix = loaded.payload.data?.generationmix;

    if (!Array.isArray(mix)) {
      throw new Error("Carbon generation payload missing data.generationmix.");
    }

    return {
      source,
      signals: mix
        .filter((entry) => typeof entry.fuel === "string")
        .map((entry) => {
          const value = numberOrNull(entry.perc);
          const fuel = entry.fuel!;

          return createSignal({
            id: `generation_mix_${fuel}`,
            label: `Generation mix ${fuel}`,
            layer: "earth",
            unit: "percent",
            value,
            normalized: normalizeLinear(value, [0, 100]),
            timestamp: loaded.fetchedAt,
            source,
            sourceUrl: loaded.sourceUrl,
            confidence: loaded.confidence,
            notes: "Great Britain generation mix share."
          });
        }),
      health: createHealthFromLoad(source, loaded, context.now),
      cache: loaded.metadata
    };
  }
};
