import { createHash } from "node:crypto";
import type { ObservationSeries } from "@cosmoaudition/core";
import {
  createSignal,
  createHealthFromLoad,
  loadPayload,
  requireSource,
} from "./helpers";
import type { AdapterContext, SourceAdapter } from "./types";

type Point = ObservationSeries["points"][number];
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function numeric(value: unknown): number | null {
  if (
    typeof value !== "number" &&
    (typeof value !== "string" || !/^-?\d+(\.\d+)?$/.test(value.trim()))
  )
    return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function point(
  time: unknown,
  value: unknown,
  quality: unknown,
  intervalEnd: string | null = null,
): Point {
  if (
    typeof time !== "string" ||
    !/(Z|[+-]\d\d:\d\d)$/.test(time) ||
    !Number.isFinite(Date.parse(time))
  )
    throw new Error("Missing absolute provider timestamp");
  const number = numeric(value);
  return {
    timestamp: new Date(time).toISOString(),
    intervalEnd,
    value: number,
    status: number === null ? "missing" : "reported",
    quality:
      typeof quality === "string" ? quality.slice(0, 256) : "not supplied",
  };
}

export function parseEnvironment(id: string, payload: unknown): Point[] {
  const data = object(payload);
  if (id === "noaa_coops_water_level") {
    if (object(data.metadata).id !== "9414290")
      throw new Error("CO-OPS station identity mismatch");
    return list(data.data)
      .slice(-1)
      .map((value) => {
        const row = object(value);
        return point(
          typeof row.t === "string" ? row.t.replace(" ", "T") + ":00Z" : null,
          row.v,
          `quality=${row.q};flags=${row.f};sigma=${row.s}`,
        );
      });
  }
  if (id === "usgs_water_streamflow") {
    return list(data.features)
      .slice(0, 1)
      .map((value) => {
        const row = object(object(value).properties);
        if (
          row.monitoring_location_id !== "USGS-01435000" ||
          row.parameter_code !== "00060" ||
          row.statistic_id !== "00011" ||
          row.unit_of_measure !== "ft^3/s"
        )
          throw new Error(
            "USGS station, parameter, statistic or units changed",
          );
        return point(
          row.time,
          row.value,
          `${row.approval_status};qualifier=${row.qualifier};series=${row.time_series_id}`,
        );
      });
  }
  if (id === "climate_trace_colombia") {
    const totals = object(data.totals);
    if (
      totals.start !== "2025-01-01" ||
      totals.end !== "2025-01-31" ||
      totals.gas !== "co2e_100yr"
    )
      throw new Error("Climate TRACE interval or gas changed");
    const row = list(data.rankings)
      .map(object)
      .find((row) => row.country === "COL");
    return [
      point(
        "2025-01-01T00:00:00Z",
        row?.emissionsQuantity,
        "Inventory estimate; all sectors; 100-year CO2 equivalent",
        "2025-02-01T00:00:00.000Z",
      ),
    ];
  }
  if (id === "noaa_psl_nino34") {
    if (typeof payload !== "string")
      throw new Error("PSL requires its monthly text table");
    if (
      !/ERSST\s+V6/i.test(payload) ||
      !/Anomaly from 1981-2010/.test(payload) ||
      !/units=degC/.test(payload)
    )
      throw new Error("PSL dataset, anomaly baseline or units changed");
    const lines = payload.trim().split(/\r?\n/);
    if (!/^\d{4}\s+\d{4}$/.test(lines[0]?.trim() ?? ""))
      throw new Error("PSL year header missing");
    const result: Point[] = [];
    for (const line of lines.slice(1)) {
      const fields = line.trim().split(/\s+/);
      if (fields.length !== 13 || !/^\d{4}$/.test(fields[0] ?? "")) continue;
      const year = Number(fields[0]);
      for (let month = 0; month < 12; month++) {
        const value = numeric(fields[month + 1]);
        result.push(
          point(
            new Date(Date.UTC(year, month, 1)).toISOString(),
            value !== null && value > -90 ? value : null,
            "Monthly ERSST v6 Niño 3.4 anomaly, 1981–2010 baseline; missing sentinel preserved",
            new Date(Date.UTC(year, month + 1, 1)).toISOString(),
          ),
        );
      }
    }
    if (!result.length) throw new Error("PSL monthly rows unavailable");
    return result.slice(-120);
  }
  throw new Error("Unknown environmental source");
}

const configs = [
  ["climate_trace_colombia", "climate_trace_colombia_emissions", "climate"],
  ["noaa_coops_water_level", "coops_water_level", "coops"],
  ["usgs_water_streamflow", "usgs_water_streamflow", "water"],
  ["noaa_psl_nino34", "nino34_anomaly", "psl"],
] as const;
const retryAfter = new Map<string, number>();
export const environmentAdapters: SourceAdapter[] = configs.map(
  ([id, signalId, fixture]) => ({
    sourceId: id,
    async read(context: AdapterContext) {
      const source = requireSource(id);
      const url = source.endpoint!;
      if (context.mode === "live" && (retryAfter.get(id) ?? 0) > Date.now())
        throw new Error("Provider backoff active; observation unavailable");
      try {
        const loaded = await loadPayload<unknown>({
          source,
          context,
          url,
          validate: (payload) => {
            parseEnvironment(id, payload);
          },
          fixturePath: `phase4-${fixture}.json`,
          ...(fixture === "psl" ? { format: "text" as const } : {}),
          allowLiveFixtureFallback: false,
        });
        const points = parseEnvironment(id, loaded.payload).sort((a, b) =>
          a.timestamp.localeCompare(b.timestamp),
        );
        const last = [...points].reverse().find((p) => p.status === "reported");
        const series: ObservationSeries = {
          contract: "cosmo/observation-series/v1",
          sourceId: id,
          seriesId: signalId,
          unit: source.unit,
          fetchedAt: loaded.fetchedAt,
          sourceUrl: url,
          mode: context.mode,
          status:
            loaded.confidence === "stale"
              ? "stale"
              : last
                ? "available"
                : "unavailable",
          cadence:
            source.temporalCharacter === "aggregate"
              ? "monthly"
              : "latest-point",
          normalizationVersion: "0.3.0",
          provenanceHash: createHash("sha256")
            .update(
              JSON.stringify({ sourceId: id, url, payload: loaded.payload }),
            )
            .digest("hex"),
          attribution: source.licenseNote,
          coverage: source.limitation,
          points,
        };
        return {
          source,
          signals: [
            createSignal({
              id: signalId,
              label: source.label,
              source,
              sourceUrl: url,
              layer: "earth",
              unit: source.unit,
              value: last?.value ?? null,
              timestamp: last?.timestamp ?? loaded.fetchedAt,
              confidence: loaded.confidence,
              notes: source.limitation,
              error: loaded.error,
            }),
          ],
          series: [series],
          health: createHealthFromLoad(source, loaded, context.now),
          cache: loaded.metadata,
        };
      } catch (error) {
        if (context.mode === "live") retryAfter.set(id, Date.now() + 60_000);
        throw error;
      }
    },
  }),
);
