import type { Confidence } from "@cosmoaudition/core";
import { createHealthFromLoad, createSignal, loadPayload, normalizeLinear, numberOrNull, requireSource } from "./helpers";
import type { AdapterContext, AdapterResult, SourceAdapter } from "./types";

interface UsgsFeature {
  id?: string;
  properties?: {
    mag?: unknown;
    time?: unknown;
    title?: string;
  };
}

interface UsgsPayload {
  type?: unknown;
  features?: UsgsFeature[];
}

export const usgsEarthquakesAdapter: SourceAdapter = {
  sourceId: "usgs_earthquakes",
  async read(context: AdapterContext): Promise<AdapterResult> {
    const source = requireSource("usgs_earthquakes");
    const loaded = await loadPayload<UsgsPayload>({
      source,
      context,
      url: source.endpoint!,
      fixturePath: "usgs-earthquakes-hour.json"
    });
    const features = Array.isArray(loaded.payload.features)
      ? loaded.payload.features
      : null;
    const shapeError =
      loaded.payload.type !== "FeatureCollection" || features === null
        ? "USGS payload is not a FeatureCollection with a features array."
        : undefined;
    const validFeatures = shapeError ? null : features;
    const rows = validFeatures ?? [];
    const magnitudes = validFeatures
      ? validFeatures
      .map((feature) => numberOrNull(feature.properties?.mag))
      .filter((value): value is number => value !== null)
      : [];
    const maxMagnitude =
      magnitudes.length === 0 ? null : Math.max(...magnitudes);
    const timedRows = rows
      .map((feature) => ({ feature, time: validEpochMilliseconds(feature.properties?.time) }))
      .filter(
        (entry): entry is { feature: UsgsFeature; time: { value: number; iso: string } } =>
          entry.time !== null
      )
      .sort((left, right) => right.time.value - left.time.value);
    const recent = timedRows[0]?.feature;
    const recentMagnitude = numberOrNull(recent?.properties?.mag);
    const timestamp = timedRows[0]?.time.iso ?? loaded.fetchedAt;
    const eventTimeError =
      validFeatures !== null && rows.length > 0 && timedRows.length === 0
        ? "USGS features contain no valid event epoch timestamp."
        : undefined;
    const parseError = shapeError ?? eventTimeError;

    const confidence = parseError ? "error" : loaded.confidence;
    return {
      source,
      signals: [
        createSignal({
          id: "earthquake_count_1h",
          label: "Earthquake count, past hour",
          layer: "earth",
          unit: "count",
          value: validFeatures === null ? null : validFeatures.length,
          normalized: normalizeLinear(validFeatures === null ? null : validFeatures.length, [0, 30]),
          timestamp: loaded.fetchedAt,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence,
          ...(parseError ? { error: parseError } : {}),
          epistemicStatus: "derived",
          temporalCharacter: "aggregate",
          signalKind: "derived",
          notes: "Zero events is valid data."
        }),
        createSignal({
          id: "earthquake_max_magnitude_1h",
          label: "Max earthquake magnitude, past hour",
          layer: "earth",
          unit: "magnitude",
          value: maxMagnitude,
          normalized: normalizeLinear(maxMagnitude, [0, 8]),
          timestamp: loaded.fetchedAt,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence,
          ...(parseError ? { error: parseError } : {}),
          epistemicStatus: "derived",
          temporalCharacter: "aggregate",
          signalKind: "derived"
        }),
        createSignal({
          id: "earthquake_recent_magnitude",
          label: "Most recent earthquake magnitude",
          layer: "earth",
          unit: "magnitude",
          value: recentMagnitude,
          normalized: normalizeLinear(recentMagnitude, [0, 8]),
          timestamp,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence,
          ...(parseError ? { error: parseError } : {}),
          epistemicStatus: "reported",
          temporalCharacter: "event",
          signalKind: "observation",
          eventKey:
            typeof recent?.id === "string" && recent.id.trim()
              ? `usgs-earthquake:${recent.id.trim()}`
              : undefined,
          notes: recent?.properties?.title
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

function validEpochMilliseconds(
  value: unknown
): { value: number; iso: string } | null {
  const milliseconds = numberOrNull(value);
  if (milliseconds === null) return null;
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) return null;
  return { value: milliseconds, iso: date.toISOString() };
}
