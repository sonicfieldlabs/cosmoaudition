import { parseAbsoluteTime } from "./time";
import type {
  Confidence,
  SourceDefinition,
  SourceHealth,
  SourceStatus
} from "./types";

export const sourceDefinitions: readonly SourceDefinition[] = [
  {
    id: "carbon_intensity_gb",
    label: "Carbon Intensity GB",
    status: "ready",
    layers: ["earth", "cloud"],
    sphere: "human",
    temporalCharacter: "aggregate",
    endpoint: "https://api.carbonintensity.org.uk/intensity",
    route: "api-proxy",
    ttlSeconds: 1800,
    unit: "gCO2/kWh",
    parser: "JSON data[0].intensity.actual/forecast/index",
    limitation: "Great Britain grid data only.",
    fallback: "Last-known-good cache as stale; otherwise null-valued signal.",
    licenseNote: "Public API attribution required."
  },
  {
    id: "carbon_generation_gb",
    label: "Carbon Intensity GB generation mix",
    status: "ready",
    layers: ["earth"],
    sphere: "human",
    temporalCharacter: "aggregate",
    endpoint: "https://api.carbonintensity.org.uk/generation",
    route: "api-proxy",
    ttlSeconds: 1800,
    unit: "percent",
    parser: "JSON data.generationmix[] fuel/perc",
    limitation: "Great Britain electricity mix only.",
    fallback: "Last-known-good cache as stale; otherwise null-valued mix.",
    licenseNote: "Public API attribution required."
  },
  {
    id: "open_meteo_local",
    label: "Open-Meteo current weather by manual coordinates",
    status: "ready",
    layers: ["earth", "user"],
    sphere: "atmosphere",
    temporalCharacter: "stream",
    endpointPattern:
      "https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,wind_speed_10m,precipitation&timezone=auto",
    route: "api-proxy",
    ttlSeconds: 600,
    unit: "mixed",
    parser: "JSON current temperature/wind/precipitation and current_units",
    limitation: "Manual point weather, not automatic location or planetary weather.",
    fallback: "Last-known-good cache for same rounded coordinates as stale.",
    licenseNote: "Public API attribution required."
  },
  {
    id: "usgs_earthquakes",
    label: "USGS earthquakes, past hour",
    status: "ready",
    layers: ["earth"],
    sphere: "geosphere",
    temporalCharacter: "event",
    endpoint:
      "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson",
    route: "api-proxy",
    ttlSeconds: 300,
    unit: "magnitude/count",
    parser: "GeoJSON features[].properties mag/time/place/type",
    limitation: "Past-hour earthquake feed; zero events is valid data.",
    fallback: "Last-known-good cache as stale; otherwise null event signals.",
    licenseNote: "USGS public feed attribution required."
  },
  {
    id: "noaa_swpc_solar_wind_speed",
    label: "NOAA SWPC real-time solar-wind speed",
    status: "ready",
    layers: ["earth"],
    sphere: "cosmos",
    temporalCharacter: "stream",
    endpoint:
      "https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json",
    route: "api-proxy",
    ttlSeconds: 60,
    unit: "km/s",
    parser: "JSON proton_speed and time_tag",
    limitation:
      "Near-real-time L1 spacecraft product; outages and upstream spacecraft switches must remain visible.",
    fallback:
      "Use matching last-known-good cache as stale; otherwise retain a null solar-wind value.",
    licenseNote: "NOAA SWPC public operational product; attribution required."
  },
  {
    id: "noaa_swpc_magnetic_field",
    label: "NOAA SWPC real-time solar-wind magnetic field",
    status: "ready",
    layers: ["earth"],
    sphere: "cosmos",
    temporalCharacter: "stream",
    endpoint:
      "https://services.swpc.noaa.gov/products/summary/solar-wind-mag-field.json",
    route: "api-proxy",
    ttlSeconds: 60,
    unit: "nT",
    parser: "JSON bt, bz_gsm, and time_tag",
    limitation:
      "Near-real-time L1 magnetic-field summary; Bz sign is material and must not be discarded.",
    fallback:
      "Use matching last-known-good cache as stale; otherwise retain null Bt and Bz values.",
    licenseNote: "NOAA SWPC public operational product; attribution required."
  },
  {
    id: "noaa_swpc_planetary_k_index",
    label: "NOAA SWPC estimated planetary K index",
    status: "ready",
    layers: ["earth"],
    sphere: "cosmos",
    temporalCharacter: "stream",
    endpoint:
      "https://services.swpc.noaa.gov/json/planetary_k_index_1m.json",
    route: "api-proxy",
    ttlSeconds: 300,
    unit: "Kp",
    parser: "Latest JSON row kp_index or estimated_kp and time_tag",
    limitation:
      "Estimated geomagnetic activity index, not a direct local magnetic measurement.",
    fallback:
      "Use matching last-known-good cache as stale; otherwise retain a null Kp estimate.",
    licenseNote: "NOAA SWPC public operational product; attribution required."
  },
  {
    id: "nasa_jpl_close_approaches",
    label: "NASA JPL small-body close approaches",
    status: "ready",
    layers: ["earth"],
    sphere: "cosmos",
    temporalCharacter: "forecast",
    endpoint:
      "https://ssd-api.jpl.nasa.gov/cad.api?date-min=now&date-max=%2B7&dist-max=0.2&fullname=true&diameter=true",
    route: "api-proxy",
    ttlSeconds: 21600,
    unit: "count/AU/km/s/hours",
    parser:
      "JSON fields/data table; closest parseable dist row inside the seven-day query window",
    limitation:
      "Ephemeris-based close-approach predictions, not live detections; API fair-use and sequential access rules apply.",
    fallback:
      "Use the matching seven-day cached query as stale; otherwise retain null approach details.",
    licenseNote: "NASA/JPL public API; attribution and API fair-use rules apply.",
    requestPolicy: {
      maxResponseBytes: 2_097_152,
      concurrencyKey: "nasa-jpl-ssd"
    }
  },
  {
    id: "nasa_jpl_fireballs",
    label: "NASA/JPL reported fireball events",
    status: "ready",
    layers: ["earth", "address"],
    sphere: "cosmos",
    temporalCharacter: "event",
    endpointPattern:
      "https://ssd-api.jpl.nasa.gov/fireball.api?date-min={past-30-days}&sort=-date&vel-comp=true",
    route: "api-proxy",
    ttlSeconds: 21600,
    unit: "count/10^10 J/kt/km/km/s",
    parser:
      "Version-checked JSON fields/data table; newest valid peak-brightness event in a rolling thirty-day window; optional velocity magnitude derived from vx/vy/vz",
    limitation:
      "Reported atmospheric fireball data from U.S. Government sensors; coverage, location, altitude, and velocity can be incomplete and this is not a live detector.",
    fallback:
      "Use the matching bounded cache as stale; otherwise retain missing event data without substituting a fixture.",
    licenseNote: "NASA/JPL public API; attribution and API fair-use rules apply.",
    requestPolicy: {
      maxResponseBytes: 1_048_576,
      concurrencyKey: "nasa-jpl-ssd"
    }
  },
  {
    id: "inaturalist_recent_observations",
    label: "iNaturalist recent global observation activity",
    status: "ready",
    layers: ["earth"],
    sphere: "biosphere",
    temporalCharacter: "aggregate",
    endpointPattern:
      "https://api.inaturalist.org/v1/observations?created_d1={start}&created_d2={end}&per_page=1&order=desc&order_by=created_at",
    route: "api-proxy",
    ttlSeconds: 300,
    unit: "observations/hour",
    parser: "JSON total_results and newest result created_at; emit aggregates only",
    limitation:
      "Counts platform submissions, not organism abundance or ecological population; creation time is not observation time.",
    fallback:
      "Use the matching global one-hour aggregate cache as stale; otherwise retain a null activity count.",
    licenseNote:
      "iNaturalist API attribution and recommended request-rate practices apply; no user, media, or precise-location fields are emitted."
  },
  {
    id: "wikimedia_pageviews_hourly",
    label: "Wikimedia all-project hourly pageviews",
    status: "ready",
    layers: ["city"],
    sphere: "human",
    temporalCharacter: "aggregate",
    endpointPattern:
      "https://wikimedia.org/api/rest_v1/metrics/pageviews/aggregate/all-projects/all-access/user/hourly/{start}/{end}",
    route: "api-proxy",
    ttlSeconds: 900,
    unit: "views/hour",
    parser: "JSON items[] timestamp and views; compare latest two complete rows",
    limitation:
      "Delayed platform-wide attention aggregate; not a direct measure of culture, population, or individual behavior.",
    fallback:
      "Use the matching recent-hour aggregate cache as stale; otherwise retain null pageview values.",
    licenseNote:
      "Wikimedia REST API attribution and identifying User-Agent requirements apply."
  },
  {
    id: "mempool_stats",
    label: "mempool.space mempool",
    status: "ready",
    layers: ["cloud"],
    sphere: "machine",
    temporalCharacter: "stream",
    endpoint: "https://mempool.space/api/mempool",
    route: "api-proxy",
    ttlSeconds: 60,
    unit: "transactions/vbytes/sats",
    parser: "JSON count, vsize, total_fee, fee_histogram[]",
    limitation: "Bitcoin mempool only.",
    fallback: "Last-known-good cache as stale; otherwise null congestion signals.",
    licenseNote: "Public API attribution required."
  },
  {
    id: "mempool_hashrate",
    label: "mempool.space mining hashrate 3d",
    status: "ready",
    layers: ["cloud"],
    sphere: "machine",
    temporalCharacter: "aggregate",
    endpoint: "https://mempool.space/api/v1/mining/hashrate/3d",
    route: "api-proxy",
    ttlSeconds: 1800,
    unit: "hashes/second",
    parser: "JSON currentHashrate, currentDifficulty, hashrates[]",
    limitation: "Bitcoin mining proxy; not total cloud infrastructure.",
    fallback: "Last-known-good cache as stale; otherwise null crypto load signals.",
    licenseNote: "Public API attribution required."
  },
  {
    id: "coingecko_btc",
    label: "CoinGecko Bitcoin simple price",
    status: "deferred",
    layers: ["cloud"],
    sphere: "human",
    temporalCharacter: "stream",
    endpoint:
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true",
    route: "api-proxy",
    ttlSeconds: 120,
    unit: "USD/percent",
    parser: "JSON bitcoin.usd and bitcoin.usd_24h_change",
    limitation:
      "Market price is not material throughput; use only for volatility coloration.",
    fallback: "Use stale cache; otherwise omit price drift from mapping.",
    licenseNote: "Public API with rate-limit risk; attribution required."
  },
  {
    id: "owid_oil_production",
    label: "OWID oil production by country",
    status: "deferred",
    layers: ["earth"],
    sphere: "human",
    temporalCharacter: "context",
    endpoint: "https://ourworldindata.org/grapher/oil-production-by-country.csv",
    route: "api-proxy",
    ttlSeconds: 604800,
    unit: "barrels/day",
    parser: "CSV Entity, Code, Year, Oil; select latest non-null values",
    limitation: "Historical annual dataset; not real-time extraction.",
    fallback: "Use bundled snapshot if live fetch fails; otherwise skip oil production metrics.",
    licenseNote: "OWID Grapher dataset attribution and license metadata required."
  },
  {
    id: "worldbank_population",
    label: "World Bank population",
    status: "deferred",
    layers: ["earth", "user"],
    sphere: "human",
    temporalCharacter: "context",
    endpointPattern:
      "https://api.worldbank.org/v2/country/{country}/indicator/SP.POP.TOTL?format=json&per_page=10",
    route: "api-proxy",
    ttlSeconds: 2592000,
    unit: "people",
    parser: "JSON [1][]; choose latest non-null value",
    limitation: "Annual demographic context only; not an activity signal.",
    fallback:
      "Use bundled snapshot for per-capita normalization; otherwise skip per-capita metrics.",
    licenseNote: "World Bank public API attribution required."
  },
  {
    id: "gbfs_systems",
    label: "GBFS systems registry",
    status: "deferred",
    layers: ["city"],
    sphere: "human",
    temporalCharacter: "context",
    endpoint: "https://github.com/MobilityData/gbfs/raw/master/systems.csv",
    route: "api-proxy",
    ttlSeconds: 604800,
    unit: "systems",
    parser: "CSV registry; use Auto-Discovery URL and Supported Versions",
    limitation:
      "Registry is only a directory; individual feeds have different GBFS versions and shapes.",
    fallback: "Use bundled registry snapshot; otherwise disable GBFS city module.",
    licenseNote: "MobilityData GBFS registry attribution required."
  },
  {
    id: "gbfs_bogota_station_status",
    label: "GBFS Bogota station status",
    status: "ready",
    layers: ["city"],
    sphere: "human",
    temporalCharacter: "stream",
    endpoint: "https://bogota.publicbikesystem.net/customer/gbfs/v3.0/station_status",
    route: "api-proxy",
    ttlSeconds: 30,
    unit: "bikes/docks/stations",
    parser:
      "GBFS v3 JSON data.stations[] station flags, num_vehicles_available, num_docks_available, last_reported",
    limitation:
      "Bogota bike system only; not a proxy for all city movement or all Latin American mobility.",
    fallback: "Last-known-good aggregate cache as stale; otherwise null city mobility signals.",
    licenseNote: "GBFS feed attribution required; public deployment terms need review."
  },
  {
    // The local runtime's own account of acquisition health. Declared so its
    // signal resolves like every other one — attribution, labels, and stratum
    // all look the source up by id.
    id: "system",
    label: "Cosmoaudition local runtime",
    status: "ready",
    layers: ["interface"],
    sphere: "machine",
    temporalCharacter: "local",
    route: "local-runtime",
    ttlSeconds: 30,
    unit: "sources",
    parser: "Derived locally from adapter health in the current snapshot",
    limitation:
      "Describes this runtime's own acquisition state, never an external system.",
    fallback: "Null local system signal.",
    licenseNote: "Generated locally; no external license."
  },
  {
    id: "browser_local_time",
    label: "Browser local time",
    status: "ready",
    layers: ["interface", "user"],
    sphere: "machine",
    temporalCharacter: "local",
    route: "browser-only",
    ttlSeconds: 1,
    unit: "time",
    parser: "Date/time derived locally in browser",
    limitation: "Local browser/session signal only.",
    fallback: "Null local-machine signal.",
    licenseNote: "Generated locally; no external license."
  },
  {
    id: "browser_fetch_latency",
    label: "Browser fetch latency",
    status: "ready",
    layers: ["interface", "user"],
    sphere: "machine",
    temporalCharacter: "local",
    route: "browser-only",
    ttlSeconds: 30,
    unit: "milliseconds",
    parser: "Measured round-trip to internal snapshot endpoint",
    limitation: "Local browser/session signal only.",
    fallback: "Null local-machine signal.",
    licenseNote: "Generated locally; no external license."
  },
  {
    id: "browser_window_size",
    label: "Browser window size",
    status: "ready",
    layers: ["interface", "user"],
    sphere: "machine",
    temporalCharacter: "local",
    route: "browser-only",
    ttlSeconds: 5,
    unit: "pixels",
    parser: "window.innerWidth and window.innerHeight",
    limitation: "Local browser/session signal only.",
    fallback: "Null local-machine signal.",
    licenseNote: "Generated locally; no external license."
  },
  {
    id: "browser_audio_context",
    label: "Browser audio context",
    status: "ready",
    layers: ["interface", "user"],
    sphere: "machine",
    temporalCharacter: "local",
    route: "browser-only",
    ttlSeconds: 60,
    unit: "Hz/state",
    parser: "AudioContext sampleRate and state after explicit user gesture",
    limitation: "Local browser/session signal only.",
    fallback: "Null local-machine signal.",
    licenseNote: "Generated locally; no external license."
  },
  {
    id: "local_modulation_bank",
    label: "Deterministic local modulation bank",
    status: "ready",
    layers: ["interface", "address", "user"],
    sphere: "machine",
    temporalCharacter: "local",
    route: "browser-only",
    ttlSeconds: 1,
    unit: "normalized/bipolar",
    parser:
      "Deterministic clock, pulse, LFO, envelope, and seeded sample-and-hold evaluated from an explicit phase origin",
    limitation:
      "Authored local modulation only; generator values are not observations of an external system.",
    fallback: "Stop generator emission; never substitute provider data.",
    licenseNote: "Generated locally; no external license."
  },
  {
    id: "local_archive",
    label: "Browser-local snapshot archive",
    status: "ready",
    layers: ["interface"],
    sphere: "machine",
    temporalCharacter: "context",
    route: "browser-only",
    ttlSeconds: 31536000,
    unit: "snapshot",
    parser: "Browser localStorage archive entry selected by explicit user action",
    limitation: "Browser-local replay marker only; archived payloads are not shared.",
    fallback: "No local archive source when no archived snapshot is selected.",
    licenseNote: "Generated locally; no external license."
  },
  {
    id: "yahoo_oil_cl",
    label: "Yahoo Finance WTI crude oil futures CL=F",
    status: "deferred",
    layers: ["earth"],
    sphere: "human",
    temporalCharacter: "stream",
    endpoint:
      "https://query2.finance.yahoo.com/v8/finance/chart/CL=F?range=1d&interval=1m",
    route: "api-proxy",
    ttlSeconds: 300,
    unit: "USD/barrel",
    parser: "JSON chart.result[0] meta and quote OHLC arrays",
    limitation: "Unofficial finance endpoint with rate-limit behavior.",
    fallback:
      "Deferred for MVP audio activation. If later activated, use last-known-good cache as stale; otherwise null oil price signal.",
    licenseNote: "Terms require review before public deployment."
  },
  {
    id: "opensky_states",
    label: "OpenSky Network all states",
    status: "deferred",
    layers: ["city"],
    sphere: "human",
    temporalCharacter: "stream",
    endpoint: "https://opensky-network.org/api/states/all",
    route: "api-proxy",
    ttlSeconds: 60,
    unit: "aircraft states",
    parser: "JSON time and states[] positional arrays",
    limitation:
      "Large global unauthenticated payload; aggregate server-side. Terms prohibit this instrument's use pattern outright, so the limitation is legal rather than technical.",
    fallback:
      "Blocked, not merely deferred. Do not activate without a written agreement from the OpenSky Network.",
    licenseNote:
      "OpenSky terms of use require a previous written agreement for operational REST API use, including integration into any automated system even if only internal, and restrict the REST API to non-profit research and education. A polling instrument is such an automated system, so this source stays inactive until that agreement exists. Verified 2026-08-07."
  }
] as const;

export function getSourceDefinition(sourceId: string): SourceDefinition | undefined {
  return sourceDefinitions.find((source) => source.id === sourceId);
}

/** Clock skew tolerated before a future acquisition time counts as unusable. */
const MAX_FUTURE_SKEW_MS = 120_000;

export function isSourceStale(
  fetchedAt: string | null,
  staleAfterSeconds: number,
  now: Date = new Date()
): boolean {
  if (fetchedAt === null) {
    return true;
  }

  // A zoneless timestamp would be localized per host, so the same acquisition
  // could read fresh on one machine and stale on another.
  const fetchedTime = parseAbsoluteTime(fetchedAt);
  if (fetchedTime === null) {
    return true;
  }

  const ageMs = now.getTime() - fetchedTime;
  // A future acquisition time is not evidence of freshness.
  if (ageMs < -MAX_FUTURE_SKEW_MS) {
    return true;
  }
  return ageMs > staleAfterSeconds * 1000;
}

export function createSourceHealth(
  source: SourceDefinition,
  options: {
    fetchedAt: string | null;
    now?: Date;
    latencyMs?: number;
    error?: string;
    statusOverride?: SourceStatus;
  }
): SourceHealth {
  let confidence: Confidence = "high";

  if (options.error) {
    confidence = "error";
  } else if (
    isSourceStale(options.fetchedAt, source.ttlSeconds, options.now ?? new Date())
  ) {
    confidence = "stale";
  } else if (source.status === "cache-only" || source.status === "fixture-only") {
    confidence = "medium";
  }

  return {
    sourceId: source.id,
    status: options.statusOverride ?? source.status,
    confidence,
    fetchedAt: options.fetchedAt,
    staleAfterSeconds: source.ttlSeconds,
    ...(options.latencyMs === undefined ? {} : { latencyMs: options.latencyMs }),
    ...(options.error === undefined ? {} : { error: options.error })
  };
}
