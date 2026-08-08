import type {
  Confidence,
  DerivedIndex,
  ObservedSignal,
  StackLayer
} from "@cosmoaudition/core";
import { describe, expect, it } from "vitest";
import { calculateCarbonDroneParams } from "../modules/CarbonDrone";
import { calculateEnergyMixChoirParams } from "../modules/EnergyMixChoir";
import { calculateMempoolNoiseParams } from "../modules/MempoolNoise";
import { calculateMobilityPulseParams } from "../modules/MobilityPulse";
import { calculateWeatherFilterParams } from "../modules/WeatherFilter";

function signal(options: {
  id: string;
  value: number | null;
  normalized: number | null;
  confidence?: Confidence;
  layer?: StackLayer;
}): ObservedSignal {
  return {
    id: options.id,
    label: options.id,
    layer: options.layer ?? "earth",
    unit: "unit",
    value: options.value,
    normalized: options.normalized,
    timestamp: "2026-06-26T17:00:00.000Z",
    sourceId: "test",
    confidence: options.confidence ?? "high",
    staleAfterSeconds: 60
  };
}

describe("audio module parameters", () => {
  it("maps generation mix into a restrained energy choir", () => {
    const params = calculateEnergyMixChoirParams([
      signal({ id: "generation_mix_wind", value: 22.3, normalized: 0.223 }),
      signal({ id: "generation_mix_coal", value: 0, normalized: 0 }),
      signal({ id: "generation_mix_solar", value: 21.8, normalized: 0.218 }),
      signal({ id: "generation_mix_gas", value: 37.8, normalized: 0.378 })
    ]);

    expect(params.windBandFrequency!).toBeGreaterThan(400);
    expect(params.windGain).toBeGreaterThan(0);
    expect(params.coalNoiseGain).toBe(0);
    expect(params.solarFrequency!).toBeGreaterThan(185);
    expect(params.gasGain).toBeLessThanOrEqual(0.024);
  });

  it("silences energy mix paths when values are absent or errored", () => {
    const params = calculateEnergyMixChoirParams([
      signal({
        id: "generation_mix_wind",
        value: null,
        normalized: null,
        confidence: "error"
      })
    ]);

    expect(params.windGain).toBe(0);
    expect(params.solarGain).toBe(0);
    expect(params.gasGain).toBe(0);
  });

  it("maps mempool congestion into bounded noise density", () => {
    const params = calculateMempoolNoiseParams([
      signal({
        id: "bitcoin_mempool_vsize",
        value: 44_704_028,
        normalized: 0.62,
        layer: "cloud"
      }),
      signal({
        id: "bitcoin_mempool_count",
        value: 107_854,
        normalized: 0.74,
        layer: "cloud"
      })
    ]);

    expect(params.densityGain).toBeGreaterThan(0);
    expect(params.densityGain).toBeLessThanOrEqual(0.04);
    expect(params.filterFrequency!).toBeGreaterThan(700);
    expect(params.filterQ!).toBeGreaterThan(0.4);
  });

  it("silences mempool noise when the primary value is missing", () => {
    const params = calculateMempoolNoiseParams([
      signal({
        id: "bitcoin_mempool_vsize",
        value: null,
        normalized: null,
        confidence: "error",
        layer: "cloud"
      })
    ]);

    expect(params.densityGain).toBe(0);
  });

  it("maps manual weather into user-layer filter parameters", () => {
    const params = calculateWeatherFilterParams([
      signal({ id: "local_temperature_2m", value: 20.5, normalized: 0.61, layer: "user" }),
      signal({ id: "local_wind_speed_10m", value: 16, normalized: 0.18 }),
      signal({ id: "local_precipitation", value: 2, normalized: 0.1 })
    ]);

    expect(params.cutoff!).toBeGreaterThan(500);
    expect(params.toneFrequency!).toBeGreaterThan(96);
    expect(params.toneGain).toBeGreaterThan(0);
    expect(params.windQ!).toBeGreaterThan(0.45);
    expect(params.precipitationGain).toBeGreaterThan(0);
  });

  it("does not make weather tone without a temperature value", () => {
    const params = calculateWeatherFilterParams([]);

    expect(params.toneGain).toBe(0);
  });

  it("maps Bogota mobility into bounded city pulses", () => {
    const params = calculateMobilityPulseParams([
      signal({
        id: "bogota_bike_availability_ratio",
        value: 0.516,
        normalized: 0.516,
        layer: "city"
      }),
      signal({
        id: "bogota_bike_stations_available",
        value: 203,
        normalized: 0.676,
        layer: "city"
      }),
      signal({
        id: "bogota_bike_stale_station_count",
        value: 4,
        normalized: 0.08,
        layer: "city"
      })
    ]);

    expect(params.intervalMs!).toBeGreaterThanOrEqual(180);
    expect(params.intervalMs!).toBeLessThanOrEqual(760);
    expect(params.frequency!).toBeGreaterThan(180);
    expect(params.pulseGain).toBeGreaterThan(0);
    expect(params.pulseGain).toBeLessThanOrEqual(0.028);
  });

  it("tightens the city pulse interval as stack density rises", () => {
    const signals = [
      signal({
        id: "bogota_bike_availability_ratio",
        value: 0.5,
        normalized: 0.5,
        layer: "city"
      }),
      signal({
        id: "bogota_bike_stations_available",
        value: 200,
        normalized: 0.66,
        layer: "city"
      })
    ];
    const sparse = calculateMobilityPulseParams(signals, 0.1);
    const neutral = calculateMobilityPulseParams(signals, 0.5);
    const dense = calculateMobilityPulseParams(signals, 0.95);

    expect(dense.intervalMs!).toBeLessThan(neutral.intervalMs!);
    expect(sparse.intervalMs!).toBeGreaterThan(neutral.intervalMs!);
    // density changes rhythm only; the pulse gain is unaffected
    expect(dense.pulseGain).toBeCloseTo(neutral.pulseGain, 6);
  });

  it("silences mobility pulse when the availability ratio is absent", () => {
    const params = calculateMobilityPulseParams([
      signal({
        id: "bogota_bike_stations_available",
        value: 203,
        normalized: 0.676,
        layer: "city"
      })
    ]);

    expect(params.pulseGain).toBe(0);
  });
});

function ceiIndex(
  normalized: number | null,
  confidence: Confidence = "high"
): DerivedIndex {
  return {
    id: "CEI",
    label: "Carbon-Electric Intensity",
    value: normalized,
    normalized,
    confidence,
    components: [],
    skippedComponents: [],
    notes: "test"
  };
}

describe("CarbonDrone Carbon-Electric Intensity wiring", () => {
  it("drives the carbon drone from the CEI index when present", () => {
    const dirty = calculateCarbonDroneParams([], [ceiIndex(0.9)]);
    const clean = calculateCarbonDroneParams([], [ceiIndex(0.1)]);

    expect(dirty.source).toBe("cei");
    expect(dirty.cutoff!).toBeGreaterThan(clean.cutoff!);
    expect(dirty.filterQ!).toBeGreaterThan(clean.filterQ!);
    expect(dirty.gain).toBeGreaterThan(clean.gain);
  });

  it("falls back to raw grid carbon when the CEI index is unavailable", () => {
    const params = calculateCarbonDroneParams(
      [signal({ id: "carbon_intensity_actual", value: 250, normalized: 0.5 })],
      [ceiIndex(null, "error")]
    );

    expect(params.source).toBe("carbon");
    expect(params.cutoff!).toBeGreaterThan(260);
  });

  it("stays silent when neither the index nor grid carbon is present", () => {
    const params = calculateCarbonDroneParams([], []);

    expect(params.source).toBe("none");
    expect(params.gain).toBe(0);
  });
});
