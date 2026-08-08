import type { Confidence } from "@cosmoaudition/core";
import {
  createHealthFromLoad,
  createSignal,
  loadPayload,
  normalizeLinear,
  normalizeLog,
  numberOrNull,
  requireSource
} from "./helpers";
import type { AdapterContext, AdapterResult, SourceAdapter } from "./types";

interface JplCadPayload {
  signature?: { version?: unknown; source?: unknown };
  count?: unknown;
  fields?: unknown;
  data?: unknown;
}

interface CloseApproachAggregate {
  count: number | null;
  distanceAu: number | null;
  relativeVelocityKmS: number | null;
  hoursUntil: number | null;
  timestamp: string;
  designation?: string;
  error?: string;
}

export const jplCloseApproachesAdapter: SourceAdapter = {
  sourceId: "nasa_jpl_close_approaches",
  async read(context: AdapterContext): Promise<AdapterResult> {
    const source = requireSource("nasa_jpl_close_approaches");
    const loaded = await loadPayload<JplCadPayload>({
      source,
      context,
      url: source.endpoint!,
      fixturePath: "nasa-jpl-close-approaches.json",
      cacheVariant: "window=7d&dist-max=0.2au"
    });
    const aggregate = aggregateCloseApproaches(
      loaded.payload,
      context.now,
      loaded.fetchedAt
    );
    const confidence = aggregate.error ? "error" : loaded.confidence;
    const objectNote = aggregate.designation
      ? `Closest parseable predicted approach: ${aggregate.designation}.`
      : "No closest parseable predicted approach is available.";

    return {
      source,
      signals: [
        createSignal({
          id: "close_approach_count_7d",
          label: "Small-body close approaches, next seven days",
          layer: "earth",
          unit: "count",
          value: aggregate.count,
          normalized: normalizeLinear(aggregate.count, [0, 40]),
          timestamp: loaded.fetchedAt,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence,
          epistemicStatus: "reported",
          temporalCharacter: "forecast",
          notes:
            "Count of JPL CAD rows within the configured 0.2 AU, seven-day query; a forecast schedule, not a live detection."
        }),
        createSignal({
          id: "closest_approach_distance_au",
          label: "Closest predicted approach distance",
          layer: "earth",
          unit: "AU",
          value: aggregate.distanceAu,
          normalized: normalizeLog(aggregate.distanceAu, [0.0001, 0.2]),
          timestamp: aggregate.timestamp,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence,
          epistemicStatus: "reported",
          temporalCharacter: "forecast",
          notes: objectNote
        }),
        createSignal({
          id: "closest_approach_velocity_km_s",
          label: "Closest approach relative velocity",
          layer: "earth",
          unit: "km/s",
          value: aggregate.relativeVelocityKmS,
          normalized: normalizeLinear(aggregate.relativeVelocityKmS, [0, 50]),
          timestamp: aggregate.timestamp,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence,
          epistemicStatus: "reported",
          temporalCharacter: "forecast",
          notes: objectNote
        }),
        createSignal({
          id: "closest_approach_time_hours",
          label: "Time until closest predicted approach",
          layer: "earth",
          unit: "hours",
          value: aggregate.hoursUntil,
          normalized: normalizeLinear(aggregate.hoursUntil, [0, 168]),
          timestamp: aggregate.timestamp,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence,
          epistemicStatus: "derived",
          temporalCharacter: "forecast",
          signalKind: "derived",
          eventKey:
            aggregate.designation
              ? `jpl-close-approach:${aggregate.designation}:${aggregate.timestamp}`
              : undefined,
          notes:
            "Derived from the JPL Julian date against this snapshot time; suitable for event scheduling, not astronomical certainty."
        })
      ],
      health: aggregate.error
        ? {
            ...createHealthFromLoad(source, loaded, context.now),
            confidence: "error" as Confidence,
            error: aggregate.error
          }
        : createHealthFromLoad(source, loaded, context.now),
      cache: loaded.metadata
    };
  }
};

export function aggregateCloseApproaches(
  payload: JplCadPayload,
  now: Date,
  fallbackTimestamp: string
): CloseApproachAggregate {
  if (payload.signature?.version !== "1.5") {
    return {
      count: null,
      distanceAu: null,
      relativeVelocityKmS: null,
      hoursUntil: null,
      timestamp: fallbackTimestamp,
      error: "JPL CAD payload signature version is not the supported 1.5 contract."
    };
  }
  const declaredCount = integerLikeOrNull(payload.count);
  if (declaredCount === 0) {
    return {
      count: 0,
      distanceAu: null,
      relativeVelocityKmS: null,
      hoursUntil: null,
      timestamp: fallbackTimestamp
    };
  }
  if (!Array.isArray(payload.fields) || !Array.isArray(payload.data)) {
    return {
      count: null,
      distanceAu: null,
      relativeVelocityKmS: null,
      hoursUntil: null,
      timestamp: fallbackTimestamp,
      error: "JPL CAD payload is missing fields or data arrays."
    };
  }

  const fields = payload.fields.filter(
    (field): field is string => typeof field === "string"
  );
  const distanceIndex = fields.indexOf("dist");
  const velocityIndex = fields.indexOf("v_rel");
  const julianIndex = fields.indexOf("jd");
  const designationIndex = fields.indexOf("fullname") >= 0
    ? fields.indexOf("fullname")
    : fields.indexOf("des");

  if (distanceIndex < 0 || velocityIndex < 0 || julianIndex < 0) {
    return {
      count: declaredCount ?? payload.data.length,
      distanceAu: null,
      relativeVelocityKmS: null,
      hoursUntil: null,
      timestamp: fallbackTimestamp,
      error: "JPL CAD fields omit dist, v_rel, or jd."
    };
  }

  const rows = payload.data.filter((row): row is unknown[] => Array.isArray(row));
  if (rows.length === 0 && declaredCount !== 0) {
    return {
      count: declaredCount ?? 0,
      distanceAu: null,
      relativeVelocityKmS: null,
      hoursUntil: null,
      timestamp: fallbackTimestamp,
      error: "JPL CAD payload declares records but contains no data rows."
    };
  }
  const candidates = rows
    .map((row) => ({
      distanceAu: numericLikeOrNull(row[distanceIndex]),
      relativeVelocityKmS: numericLikeOrNull(row[velocityIndex]),
      julianDate: numericLikeOrNull(row[julianIndex]),
      designation:
        designationIndex >= 0 && typeof row[designationIndex] === "string"
          ? row[designationIndex].trim()
          : undefined
    }))
    .filter(
      (row): row is typeof row & { distanceAu: number } =>
        row.distanceAu !== null
    )
    .sort((left, right) => left.distanceAu - right.distanceAu);
  const closest = candidates[0];
  if (!closest && rows.length > 0) {
    return {
      count: declaredCount ?? rows.length,
      distanceAu: null,
      relativeVelocityKmS: null,
      hoursUntil: null,
      timestamp: fallbackTimestamp,
      error: "JPL CAD data contains no row with a parseable distance."
    };
  }
  const approachTimestamp = julianDateToIso(closest?.julianDate) ?? fallbackTimestamp;
  const hoursUntil =
    closest?.julianDate === null || closest?.julianDate === undefined
      ? null
      : ((closest.julianDate - 2440587.5) * 86_400_000 - now.getTime()) /
        3_600_000;

  return {
    count: declaredCount ?? rows.length,
    distanceAu: closest?.distanceAu ?? null,
    relativeVelocityKmS: closest?.relativeVelocityKmS ?? null,
    hoursUntil: hoursUntil !== null && Number.isFinite(hoursUntil) ? hoursUntil : null,
    timestamp: approachTimestamp,
    ...(closest?.designation ? { designation: closest.designation } : {})
  };
}

function integerLikeOrNull(value: unknown): number | null {
  const parsed = numericLikeOrNull(value);
  return parsed !== null && Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function numericLikeOrNull(value: unknown): number | null {
  const direct = numberOrNull(value);
  if (direct !== null) {
    return direct;
  }

  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function julianDateToIso(julianDate: number | null | undefined): string | null {
  if (julianDate === null || julianDate === undefined) {
    return null;
  }

  const date = new Date((julianDate - 2440587.5) * 86_400_000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
