import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  controlFrame,
  executeMapping,
  executeMappings,
  updateControlState
} from "../control";
import type { ObservedSignal, SonicMapping } from "../types";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-07-28T00:00:00.000Z")); });
afterEach(() => vi.useRealTimers());

const mapping: SonicMapping = {
  id: "test-cutoff",
  signalId: "test-signal",
  layer: "earth",
  target: "earth.test.cutoff",
  scale: "linear",
  inputRange: [0, 100],
  outputRange: [200, 2200],
  smoothingMs: 400,
  missingData: "hold-explicitly",
  description: "test mapping",
  epistemicNote: "test signal, not a total account"
};

function signal(
  value: number | null,
  confidence: ObservedSignal["confidence"] = "high"
): ObservedSignal {
  return {
    id: "test-signal",
    label: "test signal",
    layer: "earth",
    unit: "unit",
    value,
    normalized: value === null ? null : value / 100,
    timestamp: "2026-07-28T00:00:00.000Z",
    sourceId: "test",
    confidence,
    staleAfterSeconds: 60
  };
}

describe("executable control mappings", () => {
  it("maps valid observations and preserves valid zero as data", () => {
    const middle = executeMapping(mapping, signal(50));
    const zero = executeMapping(mapping, signal(0));

    expect(middle).toMatchObject({
      status: "applied",
      reason: "mapped",
      normalizedInput: 0.5,
      outputValue: 1200
    });
    expect(zero).toMatchObject({
      status: "applied",
      normalizedInput: 0,
      outputValue: 200
    });
  });

  it("does not turn an absent observation into the output minimum", () => {
    const decision = executeMapping(mapping, undefined);

    expect(decision).toMatchObject({
      status: "skipped",
      reason: "missing-signal",
      inputValue: null,
      normalizedInput: null,
      outputValue: null
    });
  });

  it("holds only a valid, explicitly supplied previous output", () => {
    const held = executeMapping(mapping, signal(null), { previousOutput: 840 });
    const invalidHold = executeMapping(mapping, signal(null), {
      previousOutput: 9000
    });

    expect(held).toMatchObject({
      status: "held",
      reason: "missing-value",
      outputValue: 840,
      previousOutput: 840
    });
    expect(invalidHold).toMatchObject({
      status: "refused",
      reason: "invalid-previous-output",
      outputValue: null
    });
  });

  it("maps low confidence with uncertainty and refuses stale observations", () => {
    expect(executeMapping(mapping, signal(25, "low"))).toMatchObject({
      status: "uncertainty",
      reason: "low-confidence",
      outputValue: 700
    });
    expect(executeMapping(mapping, signal(25, "stale"))).toMatchObject({
      status: "refused",
      reason: "stale-input",
      outputValue: null
    });
  });

  it("refuses malformed input and malformed categorical mappings", () => {
    const malformed = signal(Number.NaN);
    const { inputRange: _inputRange, ...mappingWithoutInputRange } = mapping;
    const categorical: SonicMapping = {
      ...mappingWithoutInputRange,
      id: "categorical",
      scale: "categorical"
    };

    expect(executeMapping(mapping, malformed)).toMatchObject({
      status: "refused",
      reason: "invalid-input",
      outputValue: null
    });
    expect(executeMapping(categorical, signal(20))).toMatchObject({
      status: "refused",
      reason: "invalid-mapping",
      outputValue: null
    });
  });

  it("executes declared categorical values and refuses unknown categories", () => {
    const { inputRange: _inputRange, ...mappingWithoutInputRange } = mapping;
    const categorical: SonicMapping = {
      ...mappingWithoutInputRange,
      id: "gate",
      scale: "categorical",
      outputRange: [0, 1],
      categories: [
        { value: 0, output: 0, label: "closed" },
        { value: 1, output: 1, label: "open" }
      ]
    };

    expect(executeMapping(categorical, signal(1), { amount: 0.4 })).toMatchObject({
      status: "applied",
      rawNormalizedInput: 1,
      normalizedInput: 0.4,
      mappingAmount: 0.4,
      outputValue: 0.4
    });
    expect(executeMapping(categorical, signal(0.5))).toMatchObject({
      status: "refused",
      reason: "invalid-input",
      outputValue: null
    });
  });

  it("applies bounded route amount and reports disabled routes precisely", () => {
    expect(executeMapping(mapping, signal(50), { amount: 0.4 })).toMatchObject({
      status: "applied",
      rawNormalizedInput: 0.5,
      normalizedInput: 0.2,
      mappingAmount: 0.4,
      outputValue: 600
    });
    expect(executeMapping(mapping, signal(50), { enabled: false })).toMatchObject({
      status: "skipped",
      reason: "route-disabled",
      outputValue: null
    });
  });

  it("refuses interpolation when attributed history is unavailable", () => {
    expect(
      executeMapping(mapping, signal(null), {
        missingData: "interpolate-explicitly",
        previousOutput: 800
      })
    ).toMatchObject({
      status: "refused",
      reason: "interpolation-history-unavailable",
      outputValue: null
    });
  });

  it("quantizes only declared integer output ranges", () => {
    const quantized: SonicMapping = {
      ...mapping,
      id: "events",
      scale: "quantized",
      outputRange: [0, 8]
    };

    expect(executeMapping(quantized, signal(49)).outputValue).toBe(4);
  });

  it("builds control state and frames only from executable decisions", () => {
    const decisions = executeMappings([mapping], [signal(50)], {
      previousOutputs: new Map([[mapping.id, 500]])
    });
    const skipped = executeMapping(mapping, undefined, { missingData: "skip" });
    const next = updateControlState(new Map([["prior", 12]]), [
      ...decisions,
      skipped
    ]);
    const frame = controlFrame([...decisions, skipped]);

    expect(next).toEqual(
      new Map([
        ["prior", 12],
        [mapping.id, 1200]
      ])
    );
    expect(frame).toEqual(new Map([[mapping.target, 1200]]));
  });
});

describe("missing-data policies", () => {
  it("refuses under the refuse policy rather than emitting anything", () => {
    const decision = executeMapping(
      { ...mapping, missingData: "refuse" },
      signal(null)
    );

    expect(decision.status).toBe("refused");
    expect(decision.reason).toBe("policy-refusal");
    expect(decision.outputValue).toBeNull();
  });

  it("refuses interpolation without two attributed observations", () => {
    const decision = executeMapping(
      { ...mapping, missingData: "interpolate-explicitly" },
      signal(null),
      { previousOutput: 1200 }
    );

    expect(decision.status).toBe("refused");
    expect(decision.reason).toBe("interpolation-history-unavailable");
    expect(decision.outputValue).toBeNull();
  });

  it("skips under the skip policy", () => {
    const decision = executeMapping({ ...mapping, missingData: "skip" }, signal(null));

    expect(decision.status).toBe("skipped");
    expect(decision.outputValue).toBeNull();
  });

  it("sounds uncertainty only when a bounded uncertainty output is declared", () => {
    const declared = executeMapping(
      { ...mapping, missingData: "map-uncertainty", uncertaintyOutput: 300 },
      signal(null)
    );
    expect(declared.status).toBe("uncertainty");
    expect(declared.outputValue).toBe(300);

    // A mapping declaring this policy with no value to emit is malformed, and
    // is refused as such rather than quietly behaving like a skip.
    const undeclared = executeMapping(
      { ...mapping, missingData: "map-uncertainty" },
      signal(null)
    );
    expect(undeclared.status).toBe("refused");
    expect(undeclared.reason).toBe("invalid-mapping");
    expect(undeclared.outputValue).toBeNull();

    const outOfRange = executeMapping(
      { ...mapping, missingData: "map-uncertainty", uncertaintyOutput: 9_999 },
      signal(null)
    );
    expect(outOfRange.status).toBe("refused");
  });

  it("refuses an out-of-range previous output instead of holding it", () => {
    const decision = executeMapping(mapping, signal(null), { previousOutput: 9_999 });

    expect(decision.status).toBe("refused");
    expect(decision.reason).toBe("invalid-previous-output");
  });

  it("treats an error-confidence input as missing rather than as a value", () => {
    const decision = executeMapping({ ...mapping, missingData: "skip" }, signal(50, "error"));

    expect(decision.status).not.toBe("applied");
    expect(decision.outputValue).toBeNull();
    expect(decision.reason).toBe("source-error");
  });

  it("treats a stale input as missing rather than as a value", () => {
    const decision = executeMapping({ ...mapping, missingData: "skip" }, signal(50, "stale"));

    expect(decision.status).not.toBe("applied");
    expect(decision.reason).toBe("stale-input");
  });
});

describe("output ranges and scales", () => {
  it("traverses a reversed output range without inverting the gesture", () => {
    const reversed: SonicMapping = { ...mapping, outputRange: [2200, 200] };

    expect(executeMapping(reversed, signal(0)).outputValue).toBe(2200);
    expect(executeMapping(reversed, signal(100)).outputValue).toBe(200);
    // A zero amount means "off"; on a reversed range naive scaling would emit
    // the range start, which is the strongest value the mapping can produce.
    const off = executeMapping(reversed, signal(100), { amount: 0 });
    expect(off.outputValue).toBeNull();
    expect(off.status).toBe("skipped");
  });

  it("traverses a signed output range across zero", () => {
    const signed: SonicMapping = { ...mapping, outputRange: [-1, 1] };

    expect(executeMapping(signed, signal(0)).outputValue).toBeCloseTo(-1, 10);
    expect(executeMapping(signed, signal(50)).outputValue).toBeCloseTo(0, 10);
    expect(executeMapping(signed, signal(100)).outputValue).toBeCloseTo(1, 10);
  });

  it("maps a logarithmic scale over a strictly positive input range", () => {
    const logarithmic: SonicMapping = {
      ...mapping,
      scale: "log",
      inputRange: [1, 1000],
      outputRange: [0, 1]
    };

    const low = executeMapping(logarithmic, signal(1));
    const high = executeMapping(logarithmic, signal(1000));
    const middle = executeMapping(logarithmic, signal(100));

    expect(low.outputValue).toBeCloseTo(0, 6);
    expect(high.outputValue).toBeCloseTo(1, 6);
    // Logarithmic placement puts 100 nearer the top than linear would.
    expect(middle.outputValue!).toBeGreaterThan(0.6);
  });

  it("refuses a logarithmic mapping whose input range includes zero", () => {
    const invalid: SonicMapping = {
      ...mapping,
      scale: "log",
      inputRange: [0, 1000]
    };

    const decision = executeMapping(invalid, signal(10));
    expect(decision.status).toBe("refused");
    expect(decision.reason).toBe("invalid-mapping");
  });

  it("maps an exponential scale monotonically", () => {
    const exponential: SonicMapping = {
      ...mapping,
      scale: "exp",
      inputRange: [0, 100],
      outputRange: [0, 1]
    };

    const low = executeMapping(exponential, signal(10)).outputValue!;
    const high = executeMapping(exponential, signal(90)).outputValue!;
    expect(low).toBeLessThan(high);
    expect(executeMapping(exponential, signal(0)).outputValue).toBeCloseTo(0, 6);
    expect(executeMapping(exponential, signal(100)).outputValue).toBeCloseTo(1, 6);
  });
});
