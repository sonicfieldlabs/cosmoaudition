import { describe, expect, it } from "vitest";
import {
  clamp01,
  linearNormalize,
  logNormalize,
  nullableLinearNormalize,
  nullableLogNormalize,
  quantize,
  smoothValue,
  weightedMean
} from "../normalize";

describe("normalization utilities", () => {
  it("clamps values into the 0..1 range", () => {
    expect(clamp01(-0.25)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(1.25)).toBe(1);
  });

  it("linearly normalizes values and clamps out-of-range input", () => {
    expect(linearNormalize(50, [0, 100])).toBe(0.5);
    expect(linearNormalize(-10, [0, 100])).toBe(0);
    expect(linearNormalize(110, [0, 100])).toBe(1);
  });

  it("preserves null for nullable normalization helpers", () => {
    expect(nullableLinearNormalize(null, [0, 100])).toBeNull();
    expect(nullableLogNormalize(null, [1, 100])).toBeNull();
  });

  it("normalizes logarithmic ranges", () => {
    expect(logNormalize(10, [1, 100])).toBeCloseTo(0.5);
    expect(logNormalize(0.5, [1, 100])).toBe(0);
    expect(logNormalize(1000, [1, 100])).toBe(1);
  });

  it("quantizes normalized values into stable steps", () => {
    expect(quantize(0.12, 5)).toBe(0);
    expect(quantize(0.26, 5)).toBe(0.25);
    expect(quantize(0.9, 5)).toBe(1);
  });

  it("smooths values with clamped smoothing", () => {
    expect(smoothValue(0, 10, 0.25)).toBe(2.5);
    expect(smoothValue(0, 10, 2)).toBe(10);
  });

  it("computes weighted means without inventing missing values", () => {
    expect(
      weightedMean([
        { value: 0.25, weight: 1 },
        { value: null, weight: 100 },
        { value: 0.75, weight: 1 }
      ])
    ).toBe(0.5);

    expect(weightedMean([{ value: null, weight: 1 }])).toBeNull();
  });
});
