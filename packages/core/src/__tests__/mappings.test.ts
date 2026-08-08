import { describe, expect, it } from "vitest";
import {
  getMappingBySignal,
  mappingCatalog,
  validateMappingCatalog
} from "../mappings";

describe("mapping catalog", () => {
  it("has valid documented mappings", () => {
    expect(validateMappingCatalog()).toEqual([]);
    expect(mappingCatalog.length).toBeGreaterThanOrEqual(8);
  });

  it("can find mappings for a normalized signal id", () => {
    const mappings = getMappingBySignal("bitcoin_mempool_vsize");

    expect(mappings).toHaveLength(1);
    expect(mappings[0]?.target).toBe("cloud.mempoolNoise.density");
  });

  it("covers the active module signals", () => {
    expect(getMappingBySignal("generation_mix_wind")[0]?.target).toBe(
      "earth.energyMixChoir.windNoiseBand"
    );
    expect(getMappingBySignal("generation_mix_coal")[0]?.target).toBe(
      "earth.energyMixChoir.coalNoiseGain"
    );
    expect(getMappingBySignal("local_temperature_2m")[0]?.target).toBe(
      "user.weatherFilter.cutoff"
    );
  });

  it("covers the Bogota mobility signal", () => {
    expect(getMappingBySignal("bogota_bike_availability_ratio")[0]?.target).toBe(
      "city.mobilityPulse.rate"
    );
  });

  it("requires epistemic notes for new mappings", () => {
    const errors = validateMappingCatalog([
      {
        id: "bad",
        signalId: "x",
        layer: "cloud",
        target: "x.y",
        scale: "linear",
        inputRange: [0, 1],
        outputRange: [0, 1],
        smoothingMs: 10,
        missingData: "skip",
        description: "test",
        epistemicNote: ""
      }
    ]);

    expect(errors).toContain("Mapping bad is missing an epistemic note.");
  });
});
