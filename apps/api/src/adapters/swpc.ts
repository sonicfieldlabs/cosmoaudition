import { parseAbsoluteTime, type Confidence } from "@cosmoaudition/core";
import {
  arrayOrEmpty,
  createHealthFromLoad,
  createSignal,
  loadPayload,
  normalizeLinear,
  numberOrNull,
  requireSource
} from "./helpers";
import type { AdapterContext, AdapterResult, SourceAdapter } from "./types";

interface SolarWindSpeedPayload {
  proton_speed?: unknown;
  time_tag?: unknown;
}

interface MagneticFieldPayload {
  bt?: unknown;
  bz_gsm?: unknown;
  time_tag?: unknown;
}

/**
 * The SWPC summary endpoints return the current reading wrapped in a
 * single-element array (`[{ "proton_speed": 255, ... }]`), while the bundled
 * fixtures hold the bare object. Accept either shape so live acquisition and
 * fixture replay read the same fields, and so a further provider change
 * between the two forms does not silently null the signal.
 */
function summaryRecord<T extends object>(payload: T | readonly T[] | undefined): T {
  if (Array.isArray(payload)) {
    return (payload[0] ?? {}) as T;
  }
  return (payload ?? {}) as T;
}

type KpPayload = unknown[] | Record<string, unknown>;

export const swpcSolarWindSpeedAdapter: SourceAdapter = {
  sourceId: "noaa_swpc_solar_wind_speed",
  async read(context: AdapterContext): Promise<AdapterResult> {
    const source = requireSource("noaa_swpc_solar_wind_speed");
    const loaded = await loadPayload<SolarWindSpeedPayload>({
      source,
      context,
      url: source.endpoint!,
      fixturePath: "noaa-swpc-solar-wind-speed.json"
    });
    const summary = summaryRecord<SolarWindSpeedPayload>(loaded.payload);
    const speed = numericLikeOrNull(summary.proton_speed);
    const timestamp = timestampOrFallback(
      summary.time_tag,
      loaded.fetchedAt
    );
    const parseError =
      speed === null ? "NOAA SWPC solar-wind payload has no valid proton_speed." : undefined;
    const confidence = parseError ? "error" : loaded.confidence;

    return {
      source,
      signals: [
        createSignal({
          id: "solar_wind_speed",
          label: "Solar-wind proton speed",
          layer: "earth",
          unit: "km/s",
          value: speed,
          normalized: normalizeLinear(speed, [250, 900]),
          timestamp,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence,
          epistemicStatus: "reported",
          notes:
            "Operational near-real-time L1 product. A value conditions the instrument; it is not treated as the sound of the solar wind."
        })
      ],
      health: healthWithParseError(
        createHealthFromLoad(source, loaded, context.now),
        parseError
      ),
      cache: loaded.metadata
    };
  }
};

export const swpcMagneticFieldAdapter: SourceAdapter = {
  sourceId: "noaa_swpc_magnetic_field",
  async read(context: AdapterContext): Promise<AdapterResult> {
    const source = requireSource("noaa_swpc_magnetic_field");
    const loaded = await loadPayload<MagneticFieldPayload>({
      source,
      context,
      url: source.endpoint!,
      fixturePath: "noaa-swpc-magnetic-field.json"
    });
    const summary = summaryRecord<MagneticFieldPayload>(loaded.payload);
    const totalField = numericLikeOrNull(summary.bt);
    const bzGsm = numericLikeOrNull(summary.bz_gsm);
    const timestamp = timestampOrFallback(
      summary.time_tag,
      loaded.fetchedAt
    );
    const parseError =
      totalField === null && bzGsm === null
        ? "NOAA SWPC magnetic-field payload has no valid Bt or Bz GSM value."
        : undefined;
    const confidence = parseError ? "error" : loaded.confidence;

    return {
      source,
      signals: [
        createSignal({
          id: "solar_wind_magnetic_field_bt",
          label: "Interplanetary magnetic-field magnitude",
          layer: "earth",
          unit: "nT",
          value: totalField,
          normalized: normalizeLinear(totalField, [0, 30]),
          timestamp,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence,
          epistemicStatus: "reported",
          notes: "Bt is retained as field magnitude for slow spectral-spread control."
        }),
        createSignal({
          id: "solar_wind_magnetic_field_bz_gsm",
          label: "Interplanetary magnetic field Bz GSM",
          layer: "earth",
          unit: "nT",
          value: bzGsm,
          normalized: normalizeLinear(bzGsm, [-20, 20]),
          timestamp,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence,
          epistemicStatus: "reported",
          notes:
            "The signed Bz value is preserved; normalized 0.5 represents the zero crossing."
        })
      ],
      health: healthWithParseError(
        createHealthFromLoad(source, loaded, context.now),
        parseError
      ),
      cache: loaded.metadata
    };
  }
};

export const swpcPlanetaryKIndexAdapter: SourceAdapter = {
  sourceId: "noaa_swpc_planetary_k_index",
  async read(context: AdapterContext): Promise<AdapterResult> {
    const source = requireSource("noaa_swpc_planetary_k_index");
    const loaded = await loadPayload<KpPayload>({
      source,
      context,
      url: source.endpoint!,
      fixturePath: "noaa-swpc-planetary-k-index.json"
    });
    const row = latestRecord(loaded.payload);
    const kp = numericLikeOrNull(row?.kp_index ?? row?.estimated_kp);
    const timestamp = timestampOrFallback(row?.time_tag, loaded.fetchedAt);
    const parseError =
      kp === null ? "NOAA SWPC planetary K-index payload has no valid latest estimate." : undefined;
    const confidence = parseError ? "error" : loaded.confidence;

    return {
      source,
      signals: [
        createSignal({
          id: "planetary_k_index",
          label: "Estimated planetary K index",
          layer: "earth",
          unit: "Kp",
          value: kp,
          normalized: normalizeLinear(kp, [0, 9]),
          timestamp,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence,
          epistemicStatus: "reported",
          notes:
            "Estimated planetary geomagnetic activity for slow, hysteretic scene control; not a local magnetometer reading."
        })
      ],
      health: healthWithParseError(
        createHealthFromLoad(source, loaded, context.now),
        parseError
      ),
      cache: loaded.metadata
    };
  }
};

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

/**
 * SWPC is inconsistent about zones: the summary products carry `Z`, while the
 * planetary K-index serves zoneless `time_tag` values. Parsing a zoneless
 * string with `Date` reads it as host-local, which silently shifts the
 * observation by the machine's UTC offset. Treat such a value as unusable and
 * fall back to the acquisition time instead of inventing an instant.
 */
function timestampOrFallback(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const parsed = parseAbsoluteTime(value);
  if (parsed !== null) return new Date(parsed).toISOString();
  // A zoneless SWPC time_tag is published in UTC by the provider, so read it
  // as UTC explicitly rather than letting the host's offset decide.
  const asUtc = parseAbsoluteTime(`${value.trim()}Z`);
  return asUtc === null ? fallback : new Date(asUtc).toISOString();
}

function latestRecord(payload: KpPayload): Record<string, unknown> | undefined {
  const rows = Array.isArray(payload) ? arrayOrEmpty(payload) : [payload];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (typeof row === "object" && row !== null && !Array.isArray(row)) {
      return row as Record<string, unknown>;
    }
  }

  return undefined;
}

function healthWithParseError(
  health: AdapterResult["health"],
  error: string | undefined
): AdapterResult["health"] {
  return error === undefined
    ? health
    : { ...health, confidence: "error" as Confidence, error };
}
