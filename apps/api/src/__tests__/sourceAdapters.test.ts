import { describe, expect, it } from "vitest";
import { collectSnapshot } from "../adapters";

describe("module adapter fixture parsing", () => {
  it("parses the active source signals from fixtures", async () => {
    const snapshot = await collectSnapshot({
      mode: "fixture",
      now: new Date("2026-06-26T17:10:00.000Z")
    });
    const signals = new Map(snapshot.signals.map((signal) => [signal.id, signal]));

    expect(signals.get("generation_mix_wind")?.value).toBe(22.3);
    expect(signals.get("generation_mix_coal")?.value).toBe(0);
    expect(signals.get("bitcoin_mempool_vsize")?.value).toBe(44_704_028);
    expect(signals.get("bitcoin_mempool_count")?.value).toBe(107_854);
    expect(signals.get("local_temperature_2m")?.value).toBe(20.5);
    expect(signals.get("local_wind_speed_10m")?.value).toBe(16);
    expect(signals.get("local_precipitation")?.value).toBe(0);
  });

  it("keeps parsed source normalizations bounded", async () => {
    const snapshot = await collectSnapshot({
      mode: "fixture",
      now: new Date("2026-06-26T17:10:00.000Z")
    });
    const ids = [
      "generation_mix_wind",
      "generation_mix_coal",
      "bitcoin_mempool_vsize",
      "bitcoin_mempool_count",
      "local_temperature_2m",
      "local_wind_speed_10m",
      "local_precipitation"
    ];

    for (const id of ids) {
      const normalized = snapshot.signals.find((signal) => signal.id === id)?.normalized;

      expect(normalized).not.toBeNull();
      expect(normalized).toBeGreaterThanOrEqual(0);
      expect(normalized).toBeLessThanOrEqual(1);
    }
  });
});

describe("GBFS adapter fixture parsing", () => {
  it("aggregates Bogota GBFS station status without exposing station rows", async () => {
    const snapshot = await collectSnapshot({
      mode: "fixture",
      now: new Date("2026-06-26T21:55:00.000Z")
    });
    const signals = new Map(snapshot.signals.map((signal) => [signal.id, signal]));

    expect(signals.get("bogota_bike_station_count")?.value).toBe(203);
    expect(signals.get("bogota_bike_stations_available")?.value).toBe(203);
    expect(signals.get("bogota_bike_vehicles_available")?.value).toBe(1844);
    expect(signals.get("bogota_bike_docks_available")?.value).toBe(1727);
    expect(signals.get("bogota_bike_availability_ratio")?.value).toBeCloseTo(
      0.5163819658,
      8
    );
    expect(signals.get("bogota_bike_stale_station_count")?.value).toBe(4);
    expect(snapshot.signals.some((signal) => "stations" in signal)).toBe(false);
  });

  it("keeps Bogota mobility normalizations bounded", async () => {
    const snapshot = await collectSnapshot({
      mode: "fixture",
      now: new Date("2026-06-26T21:55:00.000Z")
    });
    const ids = [
      "bogota_bike_station_count",
      "bogota_bike_stations_available",
      "bogota_bike_vehicles_available",
      "bogota_bike_docks_available",
      "bogota_bike_availability_ratio",
      "bogota_bike_stale_station_count"
    ];

    for (const id of ids) {
      const normalized = snapshot.signals.find((signal) => signal.id === id)?.normalized;

      expect(normalized).not.toBeNull();
      expect(normalized).toBeGreaterThanOrEqual(0);
      expect(normalized).toBeLessThanOrEqual(1);
    }
  });
});
