import { describe, expect, it } from "vitest";
import {
  isValidLatitude,
  isValidLongitude,
  manualLocalityPresets
} from "../localities";

describe("manual locality presets", () => {
  it("keeps the fixture default stable", () => {
    expect(manualLocalityPresets[0]).toMatchObject({
      id: "bogota",
      latitude: 4.711,
      longitude: -74.0721
    });
  });

  it("contains only valid coordinates and unique identifiers", () => {
    expect(new Set(manualLocalityPresets.map(({ id }) => id)).size).toBe(
      manualLocalityPresets.length
    );

    for (const locality of manualLocalityPresets) {
      expect(isValidLatitude(locality.latitude)).toBe(true);
      expect(isValidLongitude(locality.longitude)).toBe(true);
    }
  });

  it("rejects non-finite and out-of-range coordinates", () => {
    expect(isValidLatitude(Number.NaN)).toBe(false);
    expect(isValidLatitude(91)).toBe(false);
    expect(isValidLongitude(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidLongitude(181)).toBe(false);
  });
});
