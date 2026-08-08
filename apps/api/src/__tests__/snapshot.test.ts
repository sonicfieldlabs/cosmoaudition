import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { collectSnapshot } from "../adapters";

describe("API snapshot", () => {
  it("collects a bounded fixture snapshot for the active source aperture", async () => {
    const snapshot = await collectSnapshot({
      mode: "fixture",
      now: new Date("2026-06-26T17:10:00.000Z")
    });

    const signalIds = snapshot.signals.map((signal) => signal.id);

    expect(snapshot.mode).toBe("fixture");
    expect(snapshot.sources).toHaveLength(14);
    expect(snapshot.cache).toHaveLength(14);
    expect(signalIds).toContain("carbon_intensity_actual");
    expect(signalIds).toContain("generation_mix_wind");
    expect(signalIds).toContain("local_temperature_2m");
    expect(signalIds).toContain("earthquake_count_1h");
    expect(signalIds).toContain("bitcoin_mempool_vsize");
    expect(signalIds).toContain("bitcoin_current_hashrate");
    expect(signalIds).toContain("bogota_bike_availability_ratio");
    expect(signalIds).toContain("solar_wind_speed");
    expect(signalIds).toContain("solar_wind_magnetic_field_bz_gsm");
    expect(signalIds).toContain("planetary_k_index");
    expect(signalIds).toContain("closest_approach_distance_au");
    expect(signalIds).toContain("fireball_latest_impact_energy_kt");
    expect(signalIds).toContain("inaturalist_observations_created_1h");
    expect(signalIds).toContain("wikimedia_pageviews_latest_hour");
    expect(signalIds).toContain("source_stale_count");
    expect(snapshot.sources.every((source) => source.confidence === "low")).toBe(
      true
    );
  });

  it("does not relabel the bundled Bogota weather fixture as another locality", async () => {
    const snapshot = await collectSnapshot({
      mode: "fixture",
      latitude: 51.5072,
      longitude: -0.1276,
      now: new Date("2026-07-28T17:10:00.000Z")
    });

    expect(snapshot.coordinates).toEqual({
      latitude: 4.711,
      longitude: -74.0721,
      basis: "bundled-bogota-fixture"
    });
    expect(snapshot.requestedCoordinates).toEqual({
      latitude: 51.5072,
      longitude: -0.1276
    });
    expect(
      snapshot.signals.find((signal) => signal.id === "local_temperature_2m")
        ?.notes
    ).toMatch(/Bogota weather fixture/);
  });

  it("serves fixture snapshots over HTTP", async () => {
    const response = await app.request("/api/snapshot?mode=fixture");
    const body = (await response.json()) as {
      mode: string;
      signals: Array<{ id: string; value: number | null }>;
    };

    expect(response.status).toBe(200);
    expect(body.mode).toBe("fixture");
    expect(body.signals.some((signal) => signal.id === "source_stale_count")).toBe(
      true
    );
  });

  it("rejects malformed or out-of-range coordinates over HTTP", async () => {
    const malformed = await app.request("/api/snapshot?mode=fixture&lat=4.7abc");
    const outOfRange = await app.request("/api/snapshot?mode=fixture&lon=181");

    expect(malformed.status).toBe(400);
    expect(outOfRange.status).toBe(400);
  });

  it("rejects unknown snapshot modes instead of falling through to live fetches", async () => {
    const response = await app.request("/api/snapshot?mode=fixtur");
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/mode must be either fixture or live/);
  });

  it("counts live fallback errors in the stale source signal", async () => {
    const originalFetch = globalThis.fetch;
    const originalCacheDir = process.env.COSMOAUDITION_CACHE_DIR;
    const cacheDir = await mkdtemp(join(tmpdir(), "cosmoaudition-test-cache-"));

    process.env.COSMOAUDITION_CACHE_DIR = cacheDir;
    globalThis.fetch = (async () => {
      throw new Error("forced fetch failure");
    }) as typeof fetch;

    try {
      const snapshot = await collectSnapshot({
        mode: "live",
        now: new Date("2026-06-26T17:10:00.000Z")
      });
      const staleSourceSignal = snapshot.signals.find(
        (signal) => signal.id === "source_stale_count"
      );
      const weatherSignal = snapshot.signals.find(
        (signal) => signal.id === "local_temperature_2m"
      );

      expect(snapshot.sources).toHaveLength(14);
      expect(snapshot.sources.every((source) => source.error !== undefined)).toBe(
        true
      );
      expect(staleSourceSignal?.value).toBe(14);
      expect(staleSourceSignal?.confidence).toBe("medium");
      expect(weatherSignal?.value).toBeNull();
      expect(weatherSignal?.notes).toMatch(/Bogota fixture was not substituted/);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalCacheDir === undefined) {
        delete process.env.COSMOAUDITION_CACHE_DIR;
      } else {
        process.env.COSMOAUDITION_CACHE_DIR = originalCacheDir;
      }
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it("serves source health and definitions over HTTP", async () => {
    const response = await app.request("/api/sources?mode=fixture");
    const body = (await response.json()) as {
      definitions: Array<{ id: string }>;
      sources: Array<{ sourceId: string; confidence: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.definitions.some((source) => source.id === "mempool_stats")).toBe(
      true
    );
    expect(body.sources).toHaveLength(14);
    expect(body.sources[0]?.confidence).toBe("low");
  });

  it("collects only an allowlisted source subset and normalizes staleness to it", async () => {
    const snapshot = await collectSnapshot({
      mode: "fixture",
      sourceIds: ["nasa_jpl_fireballs", "usgs_earthquakes"],
      now: new Date("2026-07-28T17:10:00.000Z")
    });

    expect([...snapshot.selectedSourceIds].sort()).toEqual([
      "nasa_jpl_fireballs",
      "usgs_earthquakes"
    ]);
    expect(snapshot.sources.map((source) => source.sourceId).sort()).toEqual([
      "nasa_jpl_fireballs",
      "usgs_earthquakes"
    ]);
    expect(snapshot.cache).toHaveLength(2);
    expect(snapshot.signals.find((signal) => signal.id === "source_stale_count")?.normalized)
      .toBeGreaterThanOrEqual(0);
  });

  it("serves a validated source subset and rejects unknown source ids", async () => {
    const selected = await app.request(
      "/api/snapshot?mode=fixture&sources=nasa_jpl_fireballs,usgs_earthquakes"
    );
    const selectedBody = (await selected.json()) as {
      selectedSourceIds: string[];
      sources: Array<{ sourceId: string }>;
    };
    const unknown = await app.request(
      "/api/snapshot?mode=fixture&sources=nasa_jpl_fireballs,not-a-source"
    );

    expect(selected.status).toBe(200);
    expect([...selectedBody.selectedSourceIds].sort()).toEqual([
      "nasa_jpl_fireballs",
      "usgs_earthquakes"
    ]);
    expect(selectedBody.sources).toHaveLength(2);
    expect(unknown.status).toBe(400);
  });
});
