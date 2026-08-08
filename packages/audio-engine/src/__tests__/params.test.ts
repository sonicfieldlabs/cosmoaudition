import { describe, expect, it, vi } from "vitest";
import {
  confidenceGain,
  densityIntervalScale,
  getSignalNormalized,
  normalizedToRange,
  safeParamRamp
} from "../params";
import type { ObservedSignal } from "@cosmoaudition/core";

describe("audio parameter helpers", () => {
  it("maps normalized values into output ranges", () => {
    expect(normalizedToRange(0.5, [100, 300])).toBe(200);
    expect(normalizedToRange(2, [100, 300])).toBe(300);
    expect(() => normalizedToRange(Number.NaN, [100, 300])).toThrow(
      /finite values/
    );
  });

  it("degrades gain by confidence", () => {
    expect(confidenceGain("high")).toBe(1);
    expect(confidenceGain("low")).toBeLessThan(confidenceGain("medium"));
    expect(confidenceGain("error")).toBe(0);
    expect(confidenceGain(undefined)).toBe(0);
  });

  it("reads normalized signal values without inventing a fallback", () => {
    const signals: ObservedSignal[] = [
      {
        id: "x",
        label: "x",
        layer: "earth",
        unit: "unit",
        value: 10,
        normalized: 0.42,
        timestamp: "2026-06-26T00:00:00.000Z",
        sourceId: "test",
        confidence: "high",
        staleAfterSeconds: 60
      }
    ];

    expect(getSignalNormalized(signals, "x")).toBe(0.42);
    expect(getSignalNormalized(signals, "missing")).toBeNull();
  });

  it("scales rhythmic interval by density and leaves 0.5 neutral", () => {
    expect(densityIntervalScale(0.5)).toBeCloseTo(1, 6);
    expect(densityIntervalScale(1)).toBeLessThan(1);
    expect(densityIntervalScale(0)).toBeGreaterThan(1);
  });

  it("ramps parameters with smoothing", () => {
    const param = {
      cancelScheduledValues: vi.fn().mockReturnThis(),
      setValueAtTime: vi.fn().mockReturnThis(),
      setTargetAtTime: vi.fn().mockReturnThis()
    };

    expect(safeParamRamp(param, 0.5, 12, 300)).toBe(true);

    expect(param.cancelScheduledValues).toHaveBeenCalledWith(12);
    expect(param.setTargetAtTime).toHaveBeenCalledWith(0.5, 12, 0.1);
    expect(param.setValueAtTime).not.toHaveBeenCalled();
  });

  it("refuses non-finite parameter ramps instead of routing them to zero", () => {
    const param = {
      cancelScheduledValues: vi.fn().mockReturnThis(),
      setValueAtTime: vi.fn().mockReturnThis(),
      setTargetAtTime: vi.fn().mockReturnThis()
    };

    expect(safeParamRamp(param, Number.NaN, 12, 300)).toBe(false);
    expect(param.cancelScheduledValues).not.toHaveBeenCalled();
    expect(param.setTargetAtTime).not.toHaveBeenCalled();
  });
});
