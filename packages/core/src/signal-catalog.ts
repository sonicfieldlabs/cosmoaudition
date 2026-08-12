import { nullableLinearNormalize, nullableLogNormalize } from "./normalize";
import { getSourceDefinition } from "./sources";
import type {
  EpistemicStatus,
  ObservationSphere,
  SignalKind,
  SignalNormalization,
  StackLayer,
  TemporalCharacter
} from "./types";

export const SIGNAL_CATALOG_CONTRACT = "cosmo/signal-catalog/v0.2";
export const SIGNAL_CATALOG_VERSION = "0.2.0";

export interface SignalDefinition {
  id: string;
  label: string;
  sourceId: string;
  layer: StackLayer;
  unit: string;
  sphere: ObservationSphere;
  epistemicStatus: EpistemicStatus;
  temporalCharacter: TemporalCharacter;
  signalKind: SignalKind;
  normalization: SignalNormalization;
}

export interface SignalCatalog {
  contract: typeof SIGNAL_CATALOG_CONTRACT;
  version: typeof SIGNAL_CATALOG_VERSION;
  signals: SignalDefinition[];
}

type DefinitionOverrides = Partial<
  Pick<
    SignalDefinition,
    "sphere" | "epistemicStatus" | "temporalCharacter" | "signalKind"
  >
>;

function define(
  id: string,
  label: string,
  sourceId: string,
  layer: StackLayer,
  unit: string,
  method: SignalNormalization["method"],
  inputRange: readonly [number, number],
  overrides: DefinitionOverrides = {}
): SignalDefinition {
  const source = getSourceDefinition(sourceId);
  const sphere = overrides.sphere ?? source?.sphere;
  const temporalCharacter =
    overrides.temporalCharacter ?? source?.temporalCharacter;
  if (sphere === undefined || temporalCharacter === undefined) {
    throw new Error(`Signal ${id} has no declared sphere or temporal character.`);
  }

  return {
    id,
    label,
    sourceId,
    layer,
    unit,
    sphere,
    epistemicStatus: overrides.epistemicStatus ?? "reported",
    temporalCharacter,
    signalKind: overrides.signalKind ?? "observation",
    normalization: {
      method,
      inputRange,
      outputRange: [0, 1],
      clipping: "clamp",
      basis:
        "Authored operational envelope for bounded modulation; not a physical minimum, maximum, threshold, or forecast."
    }
  };
}

const generationFuels = [
  "biomass",
  "coal",
  "imports",
  "gas",
  "nuclear",
  "other",
  "hydro",
  "solar",
  "wind"
] as const;

export const signalDefinitions: readonly SignalDefinition[] = [
  define("carbon_intensity_actual", "Carbon intensity actual", "carbon_intensity_gb", "earth", "gCO2/kWh", "linear", [0, 500]),
  define("carbon_intensity_forecast", "Carbon intensity forecast", "carbon_intensity_gb", "earth", "gCO2/kWh", "linear", [0, 500], { temporalCharacter: "forecast" }),
  ...generationFuels.map((fuel) =>
    define(`generation_mix_${fuel}`, `Generation mix ${fuel}`, "carbon_generation_gb", "earth", "percent", "linear", [0, 100])
  ),
  define("local_temperature_2m", "Local temperature", "open_meteo_local", "user", "C", "linear", [-10, 40], { temporalCharacter: "forecast" }),
  define("local_wind_speed_10m", "Local wind speed", "open_meteo_local", "earth", "km/h", "linear", [0, 90], { temporalCharacter: "forecast" }),
  define("local_precipitation", "Local precipitation", "open_meteo_local", "earth", "mm", "linear", [0, 20], { temporalCharacter: "forecast" }),
  define("air_quality_pm10", "PM10 concentration", "open_meteo_air_quality", "earth", "ug/m3", "linear", [0, 150], { temporalCharacter: "forecast" }),
  define("air_quality_pm2_5", "PM2.5 concentration", "open_meteo_air_quality", "earth", "ug/m3", "linear", [0, 75], { temporalCharacter: "forecast" }),
  define("air_quality_nitrogen_dioxide", "Nitrogen dioxide concentration", "open_meteo_air_quality", "earth", "ug/m3", "linear", [0, 340], { temporalCharacter: "forecast" }),
  define("air_quality_ozone", "Ozone concentration", "open_meteo_air_quality", "earth", "ug/m3", "linear", [0, 380], { temporalCharacter: "forecast" }),
  define("air_quality_us_aqi", "US air quality index", "open_meteo_air_quality", "earth", "US AQI", "linear", [0, 500], { temporalCharacter: "forecast" }),
  define("marine_wave_height", "Marine wave height", "open_meteo_marine", "earth", "m", "linear", [0, 15], { temporalCharacter: "forecast" }),
  define("marine_wave_period", "Marine wave period", "open_meteo_marine", "earth", "s", "linear", [0, 25], { temporalCharacter: "forecast" }),
  define("marine_sea_surface_temperature", "Sea-surface temperature", "open_meteo_marine", "earth", "C", "linear", [-2, 40], { temporalCharacter: "forecast" }),
  define("marine_ocean_current_velocity", "Ocean-current velocity", "open_meteo_marine", "earth", "km/h", "linear", [0, 10], { temporalCharacter: "forecast" }),
  define("marine_sea_level_height_msl", "Sea-level height above mean sea level", "open_meteo_marine", "earth", "m", "linear", [-2, 2], { temporalCharacter: "forecast" }),
  define("earthquake_count_1h", "Earthquake count, past hour", "usgs_earthquakes", "earth", "count", "linear", [0, 30], { epistemicStatus: "derived", temporalCharacter: "aggregate", signalKind: "derived" }),
  define("earthquake_max_magnitude_1h", "Max earthquake magnitude, past hour", "usgs_earthquakes", "earth", "magnitude", "linear", [0, 8], { epistemicStatus: "derived", temporalCharacter: "aggregate", signalKind: "derived" }),
  define("earthquake_recent_magnitude", "Most recent earthquake magnitude", "usgs_earthquakes", "earth", "magnitude", "linear", [0, 8]),
  define("eonet_open_event_count_bounded", "NASA EONET open events in bounded aperture", "nasa_eonet_open_events", "earth", "events", "linear", [0, 200], { epistemicStatus: "derived", temporalCharacter: "aggregate", signalKind: "derived" }),
  define("eonet_open_wildfire_count_bounded", "NASA EONET open wildfire events in bounded aperture", "nasa_eonet_open_events", "earth", "events", "linear", [0, 200], { epistemicStatus: "derived", temporalCharacter: "aggregate", signalKind: "derived" }),
  define("eonet_open_severe_storm_count_bounded", "NASA EONET open severe-storm events in bounded aperture", "nasa_eonet_open_events", "earth", "events", "linear", [0, 100], { epistemicStatus: "derived", temporalCharacter: "aggregate", signalKind: "derived" }),
  define("eonet_latest_geometry_age_hours", "Age of latest NASA EONET geometry", "nasa_eonet_open_events", "earth", "hours", "linear", [0, 720], { epistemicStatus: "derived", temporalCharacter: "aggregate", signalKind: "derived" }),
  define("solar_wind_speed", "Solar-wind proton speed", "noaa_swpc_solar_wind_speed", "earth", "km/s", "linear", [250, 900]),
  define("solar_wind_magnetic_field_bt", "Interplanetary magnetic-field magnitude", "noaa_swpc_magnetic_field", "earth", "nT", "linear", [0, 30]),
  define("solar_wind_magnetic_field_bz_gsm", "Interplanetary magnetic field Bz GSM", "noaa_swpc_magnetic_field", "earth", "nT", "linear", [-20, 20]),
  define("planetary_k_index", "Estimated planetary K index", "noaa_swpc_planetary_k_index", "earth", "Kp", "linear", [0, 9]),
  define("close_approach_count_7d", "Small-body close approaches, next seven days", "nasa_jpl_close_approaches", "earth", "count", "linear", [0, 40]),
  define("closest_approach_distance_au", "Closest predicted approach distance", "nasa_jpl_close_approaches", "earth", "AU", "log", [0.0001, 0.2]),
  define("closest_approach_velocity_km_s", "Closest approach relative velocity", "nasa_jpl_close_approaches", "earth", "km/s", "linear", [0, 50]),
  define("closest_approach_time_hours", "Time until closest predicted approach", "nasa_jpl_close_approaches", "earth", "hours", "linear", [0, 168], { epistemicStatus: "derived", signalKind: "derived" }),
  define("fireball_count_30d", "Reported fireballs, past thirty days", "nasa_jpl_fireballs", "earth", "count", "linear", [0, 40], { temporalCharacter: "aggregate", signalKind: "derived" }),
  define("fireball_latest_impact_energy_kt", "Latest reported fireball impact energy", "nasa_jpl_fireballs", "address", "kt TNT equivalent", "log", [0.01, 100]),
  define("fireball_latest_radiated_energy", "Latest reported fireball radiated energy", "nasa_jpl_fireballs", "address", "10^10 J", "log", [0.1, 10_000]),
  define("fireball_latest_altitude_km", "Latest reported fireball peak altitude", "nasa_jpl_fireballs", "earth", "km", "linear", [10, 80]),
  define("fireball_latest_velocity_km_s", "Latest reported fireball entry velocity", "nasa_jpl_fireballs", "earth", "km/s", "linear", [5, 80], { epistemicStatus: "derived", signalKind: "derived" }),
  define("inaturalist_observations_created_1h", "iNaturalist observations submitted, past hour", "inaturalist_recent_observations", "earth", "observations", "linear", [0, 20_000]),
  define("inaturalist_observation_rate_per_minute", "iNaturalist submission rate", "inaturalist_recent_observations", "earth", "observations/minute", "linear", [0, 350], { epistemicStatus: "derived", signalKind: "derived" }),
  define("wikimedia_pageviews_latest_hour", "Wikimedia pageviews, latest complete hour", "wikimedia_pageviews_hourly", "city", "views/hour", "linear", [0, 1_000_000_000]),
  define("wikimedia_pageviews_hourly_change", "Wikimedia pageview change from prior hour", "wikimedia_pageviews_hourly", "city", "percent", "linear", [-50, 50], { epistemicStatus: "derived", signalKind: "derived" }),
  define("bitcoin_mempool_count", "Bitcoin mempool count", "mempool_stats", "cloud", "transactions", "log", [1_000, 300_000]),
  define("bitcoin_mempool_vsize", "Bitcoin mempool virtual size", "mempool_stats", "cloud", "vbytes", "log", [1_000_000, 250_000_000]),
  define("bitcoin_mempool_total_fee", "Bitcoin mempool total fee", "mempool_stats", "cloud", "sats", "log", [100_000, 100_000_000]),
  define("bitcoin_current_hashrate", "Bitcoin current hashrate", "mempool_hashrate", "cloud", "hashes/second", "log", [100_000_000_000_000_000_000, 1_500_000_000_000_000_000_000]),
  define("bitcoin_current_difficulty", "Bitcoin current difficulty", "mempool_hashrate", "cloud", "difficulty", "log", [1_000_000_000_000, 200_000_000_000_000]),
  define("bogota_bike_station_count", "Bogota bike station rows", "gbfs_bogota_station_status", "city", "stations", "linear", [0, 300]),
  define("bogota_bike_stations_available", "Bogota bike stations available", "gbfs_bogota_station_status", "city", "stations", "linear", [0, 300]),
  define("bogota_bike_vehicles_available", "Bogota bikes available", "gbfs_bogota_station_status", "city", "vehicles", "linear", [0, 4_000]),
  define("bogota_bike_docks_available", "Bogota docks available", "gbfs_bogota_station_status", "city", "docks", "linear", [0, 4_000]),
  define("bogota_bike_availability_ratio", "Bogota bike availability ratio", "gbfs_bogota_station_status", "city", "ratio", "linear", [0, 1]),
  define("bogota_bike_stale_station_count", "Bogota stale station reports", "gbfs_bogota_station_status", "city", "stations", "linear", [0, 50]),
  define("source_stale_count", "Stale source count", "system", "interface", "sources", "linear", [0, 17], { epistemicStatus: "derived", signalKind: "derived" }),
  define("browser_fetch_latency", "Browser fetch latency", "browser_fetch_latency", "interface", "ms", "log", [10, 3_000], { epistemicStatus: "measured" }),
  define("browser_local_time", "Browser local time", "browser_local_time", "interface", "minute-of-day", "linear", [0, 1_439], { epistemicStatus: "derived", signalKind: "derived" }),
  define("browser_window_size", "Browser viewport area", "browser_window_size", "interface", "CSS-pixels²", "log", [102_400, 8_294_400], { epistemicStatus: "measured" }),
  define("browser_audio_context", "Browser audio sample rate", "browser_audio_context", "interface", "Hz", "linear", [22_050, 96_000]),
  define("local_clock_phase", "Local modulation clock", "local_modulation_bank", "interface", "normalized", "linear", [0, 1], { epistemicStatus: "interpreted", signalKind: "generator" }),
  define("local_pulse_gate", "Local pulse gate", "local_modulation_bank", "interface", "normalized", "linear", [0, 1], { epistemicStatus: "interpreted", signalKind: "generator" }),
  define("local_lfo_bipolar", "Local bipolar LFO", "local_modulation_bank", "interface", "bipolar", "linear", [-1, 1], { epistemicStatus: "interpreted", signalKind: "generator" }),
  define("local_decay_envelope", "Local cyclic envelope", "local_modulation_bank", "interface", "normalized", "linear", [0, 1], { epistemicStatus: "interpreted", signalKind: "generator" }),
  define("local_sample_and_hold", "Local deterministic sample and hold", "local_modulation_bank", "interface", "normalized", "linear", [0, 1], { epistemicStatus: "interpreted", signalKind: "generator" })
] as const;

const definitionsById = new Map(
  signalDefinitions.map((definition) => [definition.id, definition])
);

export function getSignalDefinition(
  signalId: string,
  sourceId?: string
): SignalDefinition | undefined {
  const exact = definitionsById.get(signalId);
  if (exact !== undefined) return exact;
  if (sourceId !== "carbon_generation_gb" || !signalId.startsWith("generation_mix_")) {
    return undefined;
  }
  const fuel = signalId.slice("generation_mix_".length).trim();
  if (!fuel) return undefined;
  return define(signalId, `Generation mix ${fuel}`, sourceId, "earth", "percent", "linear", [0, 100]);
}

export function normalizeSignalValue(
  value: number | null,
  normalization: SignalNormalization
): number | null {
  return normalization.method === "log"
    ? nullableLogNormalize(value, normalization.inputRange)
    : nullableLinearNormalize(value, normalization.inputRange);
}

export function buildSignalCatalog(
  sourceIds?: readonly string[]
): SignalCatalog {
  const selected = sourceIds === undefined ? null : new Set(sourceIds);
  return {
    contract: SIGNAL_CATALOG_CONTRACT,
    version: SIGNAL_CATALOG_VERSION,
    signals: signalDefinitions
      .filter((definition) => selected === null || selected.has(definition.sourceId))
      .map((definition) => ({
        ...definition,
        normalization: { ...definition.normalization }
      }))
  };
}

export function assertSignalCatalog(): void {
  const ids = new Set<string>();
  for (const definition of signalDefinitions) {
    if (ids.has(definition.id)) {
      throw new Error(`Duplicate signal definition: ${definition.id}`);
    }
    ids.add(definition.id);
    const [start, end] = definition.normalization.inputRange;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) {
      throw new Error(`Invalid normalization range for ${definition.id}.`);
    }
    if (definition.normalization.method === "log" && (start <= 0 || end <= 0)) {
      throw new Error(`Log normalization requires a positive range for ${definition.id}.`);
    }
  }
}
