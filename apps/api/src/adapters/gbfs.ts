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

const STALE_STATION_REPORT_SECONDS = 60 * 60;

interface GbfsStationStatusPayload {
  last_updated?: string;
  data?: {
    stations?: GbfsStationStatus[];
  };
  version?: string;
}

interface GbfsStationStatus {
  station_id?: string;
  num_vehicles_available?: unknown;
  num_docks_available?: unknown;
  last_reported?: string;
  is_installed?: unknown;
  is_renting?: unknown;
  is_returning?: unknown;
}

interface GbfsBogotaAggregate {
  timestamp: string;
  stationCount: number;
  readyStationCount: number;
  vehiclesAvailable: number | null;
  docksAvailable: number | null;
  availabilityRatio: number | null;
  staleStationCount: number;
}

function aggregateGbfsBogotaStationStatus(
  payload: GbfsStationStatusPayload,
  fallbackTimestamp: string
): GbfsBogotaAggregate {
  const stations = arrayOrEmpty(payload.data?.stations) as GbfsStationStatus[];
  const timestamp = validIsoTimestamp(payload.last_updated) ?? fallbackTimestamp;
  const referenceMs = Date.parse(timestamp);
  let readyStationCount = 0;
  let staleStationCount = 0;
  let vehicleSum = 0;
  let dockSum = 0;
  let vehicleValueCount = 0;
  let dockValueCount = 0;

  for (const station of stations) {
    const vehicles = numberOrNull(station.num_vehicles_available);
    const docks = numberOrNull(station.num_docks_available);

    if (vehicles !== null) {
      vehicleSum += vehicles;
      vehicleValueCount += 1;
    }

    if (docks !== null) {
      dockSum += docks;
      dockValueCount += 1;
    }

    if (
      isGbfsTrue(station.is_installed) &&
      isGbfsTrue(station.is_renting) &&
      isGbfsTrue(station.is_returning)
    ) {
      readyStationCount += 1;
    }

    if (isStaleStationReport(station.last_reported, referenceMs)) {
      staleStationCount += 1;
    }
  }

  const vehiclesAvailable = vehicleValueCount === 0 ? null : vehicleSum;
  const docksAvailable = dockValueCount === 0 ? null : dockSum;
  const denominator = (vehiclesAvailable ?? 0) + (docksAvailable ?? 0);
  const availabilityRatio =
    vehiclesAvailable === null || docksAvailable === null || denominator <= 0
      ? null
      : vehiclesAvailable / denominator;

  return {
    timestamp,
    stationCount: stations.length,
    readyStationCount,
    vehiclesAvailable,
    docksAvailable,
    availabilityRatio,
    staleStationCount
  };
}

export const gbfsBogotaStationStatusAdapter: SourceAdapter = {
  sourceId: "gbfs_bogota_station_status",
  async read(context: AdapterContext): Promise<AdapterResult> {
    const source = requireSource("gbfs_bogota_station_status");
    const loaded = await loadPayload<GbfsStationStatusPayload>({
      source,
      context,
      url: source.endpoint!,
      fixturePath: "gbfs-bogota-station-status.json"
    });

    if (!Array.isArray(loaded.payload.data?.stations)) {
      throw new Error("GBFS Bogota payload missing data.stations.");
    }

    const aggregate = aggregateGbfsBogotaStationStatus(
      loaded.payload,
      loaded.fetchedAt
    );
    const notes =
      "Bogota GBFS station_status aggregate; raw station rows stay server-side.";

    return {
      source,
      signals: [
        createSignal({
          id: "bogota_bike_station_count",
          label: "Bogota bike station rows",
          layer: "city",
          unit: "stations",
          value: aggregate.stationCount,
          normalized: normalizeLinear(aggregate.stationCount, [0, 300]),
          timestamp: aggregate.timestamp,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence: loaded.confidence,
          notes
        }),
        createSignal({
          id: "bogota_bike_stations_available",
          label: "Bogota bike stations available",
          layer: "city",
          unit: "stations",
          value: aggregate.readyStationCount,
          normalized: normalizeLinear(aggregate.readyStationCount, [0, 300]),
          timestamp: aggregate.timestamp,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence: loaded.confidence,
          notes: "Stations reporting installed, renting, and returning status."
        }),
        createSignal({
          id: "bogota_bike_vehicles_available",
          label: "Bogota bikes available",
          layer: "city",
          unit: "vehicles",
          value: aggregate.vehiclesAvailable,
          normalized: normalizeLinear(aggregate.vehiclesAvailable, [0, 4000]),
          timestamp: aggregate.timestamp,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence: loaded.confidence,
          notes
        }),
        createSignal({
          id: "bogota_bike_docks_available",
          label: "Bogota docks available",
          layer: "city",
          unit: "docks",
          value: aggregate.docksAvailable,
          normalized: normalizeLinear(aggregate.docksAvailable, [0, 4000]),
          timestamp: aggregate.timestamp,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence: loaded.confidence,
          notes
        }),
        createSignal({
          id: "bogota_bike_availability_ratio",
          label: "Bogota bike availability ratio",
          layer: "city",
          unit: "ratio",
          value: aggregate.availabilityRatio,
          normalized: normalizeLinear(aggregate.availabilityRatio, [0, 1]),
          timestamp: aggregate.timestamp,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence: loaded.confidence,
          notes:
            "Bikes divided by bikes plus empty docks in the Bogota GBFS station_status feed."
        }),
        createSignal({
          id: "bogota_bike_stale_station_count",
          label: "Bogota stale station reports",
          layer: "city",
          unit: "stations",
          value: aggregate.staleStationCount,
          normalized: normalizeLinear(aggregate.staleStationCount, [0, 50]),
          timestamp: aggregate.timestamp,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence: loaded.confidence,
          notes:
            "Station rows whose last_reported value is older than 60 minutes relative to feed last_updated."
        })
      ],
      health: createHealthFromLoad(source, loaded, context.now),
      cache: loaded.metadata
    };
  }
};

function validIsoTimestamp(value: string | undefined): string | undefined {
  if (value === undefined || Number.isNaN(Date.parse(value))) {
    return undefined;
  }

  return value;
}

function isGbfsTrue(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function isStaleStationReport(
  lastReported: string | undefined,
  referenceMs: number
): boolean {
  if (lastReported === undefined || Number.isNaN(referenceMs)) {
    return true;
  }

  const reportedMs = Date.parse(lastReported);
  if (Number.isNaN(reportedMs)) {
    return true;
  }

  return referenceMs - reportedMs > STALE_STATION_REPORT_SECONDS * 1000;
}
