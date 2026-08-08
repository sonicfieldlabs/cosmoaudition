import type { Confidence } from "@cosmoaudition/core";
import {
  createHealthFromLoad,
  createSignal,
  loadPayload,
  normalizeLinear,
  normalizeLog,
  requireSource
} from "./helpers";
import type { AdapterContext, AdapterResult, SourceAdapter } from "./types";

interface FireballPayload {
  signature?: { version?: unknown; source?: unknown };
  count?: unknown;
  fields?: unknown;
  data?: unknown;
}

export interface FireballAggregate {
  count: number | null;
  timestamp: string;
  radiatedEnergy: number | null;
  impactEnergyKt: number | null;
  altitudeKm: number | null;
  velocityKmS: number | null;
  eventKey?: string;
  error?: string;
}

const WINDOW_DAYS = 30;

export const jplFireballAdapter: SourceAdapter = {
  sourceId: "nasa_jpl_fireballs",
  async read(context: AdapterContext): Promise<AdapterResult> {
    const source = requireSource("nasa_jpl_fireballs");
    const dateMin = new Date(context.now.getTime() - WINDOW_DAYS * 86_400_000);
    const loaded = await loadPayload<FireballPayload>({
      source,
      context,
      url: `https://ssd-api.jpl.nasa.gov/fireball.api?date-min=${formatDate(dateMin)}&sort=-date&vel-comp=true`,
      fixturePath: "nasa-jpl-fireballs.json",
      cacheVariant: "window=30d&sort=-date&vel-comp=true"
    });
    const aggregate = aggregateFireballs(loaded.payload, loaded.fetchedAt);
    const confidence = aggregate.error ? "error" : loaded.confidence;
    const eventNote =
      "Reported peak-brightness event from the NASA/JPL fireball dataset. It is not raw sensor audio, a complete census, or a live impact warning.";

    return {
      source,
      signals: [
        createSignal({
          id: "fireball_count_30d",
          label: "Reported fireballs, past thirty days",
          layer: "earth",
          unit: "count",
          value: aggregate.count,
          normalized: normalizeLinear(aggregate.count, [0, 40]),
          timestamp: loaded.fetchedAt,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence,
          epistemicStatus: "reported",
          temporalCharacter: "aggregate",
          signalKind: "derived",
          notes:
            "Count inside this rolling API query window; zero is valid and does not imply zero meteoroid activity outside the dataset."
        }),
        createSignal({
          id: "fireball_latest_impact_energy_kt",
          label: "Latest reported fireball impact energy",
          layer: "address",
          unit: "kt TNT equivalent",
          value: aggregate.impactEnergyKt,
          normalized: normalizeLog(aggregate.impactEnergyKt, [0.01, 100]),
          timestamp: aggregate.timestamp,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence,
          epistemicStatus: "reported",
          temporalCharacter: "event",
          signalKind: "observation",
          eventKey: aggregate.eventKey,
          notes: eventNote
        }),
        createSignal({
          id: "fireball_latest_radiated_energy",
          label: "Latest reported fireball radiated energy",
          layer: "address",
          unit: "10^10 J",
          value: aggregate.radiatedEnergy,
          normalized: normalizeLog(aggregate.radiatedEnergy, [0.1, 10_000]),
          timestamp: aggregate.timestamp,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence,
          epistemicStatus: "reported",
          temporalCharacter: "event",
          notes: eventNote
        }),
        createSignal({
          id: "fireball_latest_altitude_km",
          label: "Latest reported fireball peak altitude",
          layer: "earth",
          unit: "km",
          value: aggregate.altitudeKm,
          normalized: normalizeLinear(aggregate.altitudeKm, [10, 80]),
          timestamp: aggregate.timestamp,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence,
          epistemicStatus: "reported",
          temporalCharacter: "event",
          notes: `${eventNote} Altitude is above the geoid and can be unavailable.`
        }),
        createSignal({
          id: "fireball_latest_velocity_km_s",
          label: "Latest reported fireball entry velocity",
          layer: "earth",
          unit: "km/s",
          value: aggregate.velocityKmS,
          normalized: normalizeLinear(aggregate.velocityKmS, [5, 80]),
          timestamp: aggregate.timestamp,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence,
          epistemicStatus: "derived",
          temporalCharacter: "event",
          signalKind: "derived",
          notes: `${eventNote} Entry velocity is optional in the provider record.`
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

export function aggregateFireballs(
  payload: FireballPayload,
  fallbackTimestamp: string
): FireballAggregate {
  if (payload.signature?.version !== "1.2") {
    return emptyFireball(
      fallbackTimestamp,
      "NASA/JPL fireball payload signature version is not the supported 1.2 contract."
    );
  }
  const declaredCount = integerLikeOrNull(payload.count);
  if (declaredCount === 0) {
    return {
      count: 0,
      timestamp: fallbackTimestamp,
      radiatedEnergy: null,
      impactEnergyKt: null,
      altitudeKm: null,
      velocityKmS: null
    };
  }
  if (!Array.isArray(payload.fields)) {
    return emptyFireball(fallbackTimestamp, "NASA/JPL fireball payload is missing fields.");
  }
  const fields = payload.fields.filter((field): field is string => typeof field === "string");
  const dateIndex = fields.indexOf("date");
  const energyIndex = fields.indexOf("energy");
  const impactIndex = fields.indexOf("impact-e");
  if (dateIndex < 0 || energyIndex < 0 || impactIndex < 0) {
    return emptyFireball(
      fallbackTimestamp,
      "NASA/JPL fireball fields omit date, energy, or impact-e."
    );
  }
  const rows = Array.isArray(payload.data)
    ? payload.data.filter((row): row is unknown[] => Array.isArray(row))
    : [];
  if (rows.length === 0) {
    // A declared zero already returned above as a real observation of no
    // events. Reaching here means the payload either declared records it did
    // not supply, or declared nothing at all — the latter establishes no
    // count, so it stays null rather than becoming a measured zero.
    return declaredCount === null
      ? emptyFireball(
          fallbackTimestamp,
          "NASA/JPL fireball payload contains neither a record count nor data rows.",
          null
        )
      : emptyFireball(
          fallbackTimestamp,
          "NASA/JPL fireball payload declares records but contains no data rows.",
          declaredCount
        );
  }
  const count = declaredCount ?? rows.length;
  const altitudeIndex = fields.indexOf("alt");
  const vxIndex = fields.indexOf("vx");
  const vyIndex = fields.indexOf("vy");
  const vzIndex = fields.indexOf("vz");
  const latest = rows
    .map((row) => ({
      timestamp: fireballTimestamp(row[dateIndex]),
      radiatedEnergy: numericLikeOrNull(row[energyIndex]),
      impactEnergyKt: numericLikeOrNull(row[impactIndex]),
      altitudeKm: altitudeIndex < 0 ? null : numericLikeOrNull(row[altitudeIndex]),
      velocityKmS: vectorMagnitude(
        vxIndex < 0 ? null : numericLikeOrNull(row[vxIndex]),
        vyIndex < 0 ? null : numericLikeOrNull(row[vyIndex]),
        vzIndex < 0 ? null : numericLikeOrNull(row[vzIndex])
      )
    }))
    .filter(
      (row): row is typeof row & { timestamp: string } => row.timestamp !== null
    )
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))[0];
  if (!latest || latest.radiatedEnergy === null || latest.impactEnergyKt === null) {
    return emptyFireball(
      fallbackTimestamp,
      "NASA/JPL fireball payload contains no valid dated energy record.",
      count
    );
  }

  return {
    count,
    timestamp: latest.timestamp,
    radiatedEnergy: latest.radiatedEnergy,
    impactEnergyKt: latest.impactEnergyKt,
    altitudeKm: latest.altitudeKm,
    velocityKmS: latest.velocityKmS,
    eventKey: `nasa-jpl-fireball:${latest.timestamp}`
  };
}

function emptyFireball(
  timestamp: string,
  error: string,
  count: number | null = null
): FireballAggregate {
  return {
    count,
    timestamp,
    radiatedEnergy: null,
    impactEnergyKt: null,
    altitudeKm: null,
    velocityKmS: null,
    error
  };
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function numericLikeOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerLikeOrNull(value: unknown): number | null {
  const parsed = numericLikeOrNull(value);
  return parsed !== null && Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function vectorMagnitude(
  x: number | null,
  y: number | null,
  z: number | null
): number | null {
  return x === null || y === null || z === null
    ? null
    : Math.sqrt(x * x + y * y + z * z);
}

function fireballTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/);
  if (!match) return null;
  const date = new Date(`${match[1]}T${match[2]}Z`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
