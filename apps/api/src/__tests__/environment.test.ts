import { describe, expect, it } from "vitest";
import { collectSnapshot } from "../adapters";
import { parseEnvironment, environmentAdapters } from "../adapters/environment";

describe("bounded environmental observations", () => {
  it("separates monthly intervals from latest points and declares provenance", async () => {
    const snapshot = await collectSnapshot({
      mode: "fixture",
      sourceIds: environmentAdapters.map((a) => a.sourceId),
      now: new Date("2026-09-12T17:00:00Z"),
    });
    expect(snapshot.series).toHaveLength(4);
    expect(snapshot.sources.every((s) => s.status === "fixture-only")).toBe(
      true,
    );
    for (const series of snapshot.series) {
      expect(series.provenanceHash).toMatch(/^[a-f0-9]{64}$/);
      expect(series.mode).toBe("fixture");
      expect(series.points.length).toBeLessThanOrEqual(120);
      expect(series.attribution).toBeTruthy();
    }
    const climate = snapshot.series.find(
      (s) => s.sourceId === "climate_trace_colombia",
    )!;
    expect(climate.points[0]?.intervalEnd).toBe("2025-02-01T00:00:00.000Z");
    expect(climate.points[0]?.value).toBeGreaterThan(0);
    expect(
      snapshot.series.find((s) => s.sourceId === "usgs_water_streamflow")
        ?.cadence,
    ).toBe("latest-point");
  });
  it("preserves PSL missing slots and does not confuse SST with anomaly units", () => {
    const points = parseEnvironment(
      "noaa_psl_nino34",
      "2026 2026\n2026 0.1 0.2 -99.99 -99.99 -99.99 -99.99 -99.99 -99.99 -99.99 -99.99 -99.99 -99.99\nERSST V6\nAnomaly from 1981-2010\nunits=degC",
    );
    expect(points).toHaveLength(12);
    expect(points[2]?.value).toBeNull();
    expect(points[2]?.status).toBe("missing");
    expect(points[1]?.intervalEnd).toBe("2026-03-01T00:00:00.000Z");
  });
  it("refuses station, units and interval drift instead of relabeling values", () => {
    expect(() =>
      parseEnvironment("noaa_coops_water_level", {
        metadata: { id: "other" },
        data: [],
      }),
    ).toThrow("identity");
    expect(() =>
      parseEnvironment("usgs_water_streamflow", {
        features: [{ properties: { value: "12", unit_of_measure: "m3/s" } }],
      }),
    ).toThrow("units");
    expect(() =>
      parseEnvironment("climate_trace_colombia", {
        totals: { start: "2026-01-01" },
      }),
    ).toThrow("interval");
  });
});

it("live rate limiting never substitutes a fixture and suppresses repeated requests", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = await mkdtemp(join(tmpdir(), "cosmo-phase4-"));
  const oldCache = process.env.COSMOAUDITION_CACHE_DIR;
  const oldFetch = globalThis.fetch;
  let calls = 0;
  process.env.COSMOAUDITION_CACHE_DIR = root;
  globalThis.fetch = async () => {
    calls++;
    return new Response("rate limited", {
      status: 429,
      headers: { "Retry-After": "120" },
    });
  };
  try {
    for (let i = 0; i < 2; i++) {
      const result = await collectSnapshot({
        mode: "live",
        sourceIds: ["noaa_coops_water_level"],
      });
      expect(result.sources[0]?.confidence).toBe("error");
      expect(result.series).toEqual([]);
      expect(result.signals.some((s) => s.id === "coops_water_level")).toBe(
        false,
      );
    }
    expect(calls).toBe(1);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldCache === undefined) delete process.env.COSMOAUDITION_CACHE_DIR;
    else process.env.COSMOAUDITION_CACHE_DIR = oldCache;
    await rm(root, { recursive: true, force: true });
  }
});
