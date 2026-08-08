import { describe, expect, it } from "vitest";
import {
  calculateCarbonElectricIntensity,
  calculateCloudThermicIndex,
  calculateStackPulseIndex,
  createWeightedIndex
} from "../indices";

describe("derived indices", () => {
  it("skips null, stale, and error components instead of inventing values", () => {
    const index = createWeightedIndex(
      "SPI",
      [
        { id: "ready", value: 0.4, confidence: "high" },
        { id: "missing", value: null, confidence: "error", weight: 100 },
        { id: "stale", value: 1, confidence: "stale", weight: 100 }
      ],
      "test"
    );

    expect(index.value).toBe(0.4);
    expect(index.confidence).toBe("medium");
    expect(index.components).toEqual(["ready"]);
    expect(index.skippedComponents).toEqual(["missing", "stale"]);
  });

  it("returns stale confidence when only stale components exist", () => {
    const index = createWeightedIndex(
      "CTI",
      [{ id: "old", value: 0.9, confidence: "stale" }],
      "test"
    );

    expect(index.value).toBeNull();
    expect(index.confidence).toBe("stale");
  });

  it("calculates SPI with conservative weights", () => {
    const index = calculateStackPulseIndex({
      energyActivity: { id: "energy", value: 0.5, confidence: "high" },
      cloudActivity: { id: "cloud", value: 0.75, confidence: "high" },
      cryptoActivity: { id: "crypto", value: 0.25, confidence: "high" },
      logisticsActivity: { id: "logistics", value: null, confidence: "error" },
      localMachineActivity: { id: "local", value: 0.5, confidence: "high" }
    });

    expect(index.value).toBeGreaterThan(0.49);
    expect(index.value).toBeLessThan(0.57);
    expect(index.confidence).toBe("medium");
  });

  it("inverts renewable mix for CEI pressure", () => {
    const index = calculateCarbonElectricIntensity({
      carbonIntensity: { id: "carbon", value: 0.5, confidence: "high" },
      fossilMix: { id: "fossil", value: 0.75, confidence: "high" },
      renewableMix: { id: "renewable", value: 1, confidence: "high" }
    });

    expect(index.value).toBeGreaterThan(0.45);
    expect(index.value).toBeLessThan(0.6);
  });

  it("marks low-confidence usable components as low confidence", () => {
    const index = calculateCloudThermicIndex({
      hashrate: { id: "hashrate", value: 0.8, confidence: "low" },
      mempoolCongestion: { id: "mempool", value: 0.5, confidence: "high" },
      fetchLatency: { id: "latency", value: 0.25, confidence: "high" }
    });

    expect(index.value).not.toBeNull();
    expect(index.confidence).toBe("low");
  });

  it("never turns a non-finite renewable share into maximum carbon pressure", () => {
    const index = calculateCarbonElectricIntensity({
      carbonIntensity: { id: "carbon", value: 0.5, confidence: "high" },
      fossilMix: { id: "fossil", value: 0.5, confidence: "high" },
      renewableMix: { id: "renewable", value: Number.NaN, confidence: "high" }
    });

    expect(index.skippedComponents).toContain("renewable");
    expect(index.components).not.toContain("renewable");
    expect(index.value).toBeCloseTo(0.5, 10);
  });

  it("marks a zero-weight component as skipped instead of silently dropping it", () => {
    const index = createWeightedIndex(
      "SPI",
      [{ id: "only", value: 0.5, confidence: "high", weight: 0 }],
      "test"
    );

    expect(index.value).toBeNull();
    expect(index.components).toEqual([]);
    expect(index.skippedComponents).toEqual(["only"]);
    expect(index.confidence).not.toBe("high");
  });
});
