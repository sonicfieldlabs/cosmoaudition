import { describe, expect, it } from "vitest";
import { buildStackIndices } from "../stackIndices";
import type { Confidence, ObservedSignal, StackLayer } from "../types";

function signal(options: {
  id: string;
  normalized: number | null;
  confidence?: Confidence;
  layer?: StackLayer;
}): ObservedSignal {
  return {
    id: options.id,
    label: options.id,
    layer: options.layer ?? "earth",
    unit: "unit",
    value: options.normalized,
    normalized: options.normalized,
    timestamp: "2026-06-26T17:00:00.000Z",
    sourceId: "test",
    confidence: options.confidence ?? "high",
    staleAfterSeconds: 60
  };
}

describe("buildStackIndices", () => {
  it("returns all seven indices in a stable order", () => {
    const indices = buildStackIndices([]);
    expect(indices.map((index) => index.id)).toEqual([
      "SPI",
      "EPI",
      "CEI",
      "CTI",
      "LPI",
      "BNI",
      "LMI"
    ]);
  });

  it("activates indices from the available signals", () => {
    const indices = buildStackIndices([
      signal({ id: "carbon_intensity_actual", normalized: 0.3 }),
      signal({ id: "bitcoin_mempool_vsize", normalized: 0.6, layer: "cloud" }),
      signal({ id: "bitcoin_current_hashrate", normalized: 0.5, layer: "cloud" }),
      signal({ id: "bogota_bike_availability_ratio", normalized: 0.52, layer: "city" }),
      signal({ id: "browser_fetch_latency", normalized: 0.2, layer: "interface" }),
      signal({ id: "generation_mix_gas", normalized: 0.38 }),
      signal({ id: "generation_mix_wind", normalized: 0.22 }),
      signal({ id: "local_temperature_2m", normalized: 0.6, layer: "user" }),
      signal({ id: "earthquake_count_1h", normalized: 0.1 })
    ]);
    const byId = new Map(indices.map((index) => [index.id, index]));

    expect(byId.get("SPI")?.value).not.toBeNull();
    expect(byId.get("CEI")?.value).not.toBeNull();
    expect(byId.get("CTI")?.value).not.toBeNull();
    expect(byId.get("LPI")?.value).not.toBeNull();
    expect(byId.get("BNI")?.value).not.toBeNull();
  });

  it("keeps deferred indices null instead of inventing values", () => {
    // No oil or flight signals exist in the active source aperture.
    const indices = buildStackIndices([
      signal({ id: "carbon_intensity_actual", normalized: 0.3 })
    ]);
    const epi = indices.find((index) => index.id === "EPI");

    expect(epi?.value).toBeNull();
    expect(epi?.confidence).toBe("error");
  });

  it("never produces values outside the 0..1 range", () => {
    const indices = buildStackIndices([
      signal({ id: "generation_mix_coal", normalized: 0.9 }),
      signal({ id: "generation_mix_gas", normalized: 0.8 }),
      signal({ id: "generation_mix_oil", normalized: 0.7 }),
      signal({ id: "carbon_intensity_actual", normalized: 1 })
    ]);

    for (const index of indices) {
      if (index.value !== null) {
        expect(index.value).toBeGreaterThanOrEqual(0);
        expect(index.value).toBeLessThanOrEqual(1);
      }
    }
  });
});
