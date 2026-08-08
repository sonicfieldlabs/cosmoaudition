import { describe, expect, it } from "vitest";
import {
  createDefaultModulatorBank,
  createModulatorSignals,
  evaluateModulator,
  type ModulatorDefinition
} from "../modulation";

const origin = "2026-07-29T00:00:00.000Z";

function definition(
  algorithm: ModulatorDefinition["algorithm"]
): ModulatorDefinition {
  return {
    id: `test-${algorithm}`,
    label: algorithm,
    algorithm,
    rateHz: 1,
    outputRange: [0, 1],
    seed: 42,
    phaseOrigin: origin,
    dutyCycle: 0.5,
    smoothingMs: 10
  };
}

describe("deterministic local modulation", () => {
  it("evaluates repeatably from phase origin, rate, and seed", () => {
    const at = new Date("2026-07-29T00:00:02.250Z");
    const first = evaluateModulator(definition("sample-and-hold"), at);
    const second = evaluateModulator(definition("sample-and-hold"), at);

    expect(first).toEqual(second);
    expect(first.cycle).toBe(2);
    expect(first.normalized).toBeGreaterThanOrEqual(0);
    expect(first.normalized).toBeLessThanOrEqual(1);
  });

  it("gives each open pulse cycle one stable event key", () => {
    const pulse = definition("pulse");
    const open = evaluateModulator(pulse, new Date("2026-07-29T00:00:03.100Z"));
    expect(open.eventKey).toBe(`test-pulse:${origin}:${pulse.rateHz}:cycle:3`);
    // The same cycle evaluated again yields the same key, so it deduplicates.
    expect(evaluateModulator(pulse, new Date("2026-07-29T00:00:03.200Z")).eventKey)
      .toBe(open.eventKey);
    expect(evaluateModulator(pulse, new Date("2026-07-29T00:00:03.700Z")).eventKey)
      .toBeUndefined();
  });

  it("does not reuse a cycle key across different rates", () => {
    // The cycle counter restarts its numbering when the rate changes, so a key
    // built from the cycle alone would collide with cycles already emitted and
    // the gate would fall silent until it counted past them.
    const slow = { ...definition("pulse"), rateHz: 1 };
    const fast = { ...definition("pulse"), rateHz: 8 };
    // Both reach cycle 3, at different moments: 3.1 s at 1 Hz, 0.38 s at 8 Hz.
    const slowFrame = evaluateModulator(slow, new Date("2026-07-29T00:00:03.100Z"));
    const fastFrame = evaluateModulator(fast, new Date("2026-07-29T00:00:00.380Z"));

    expect(slowFrame.cycle).toBe(3);
    expect(fastFrame.cycle).toBe(3);
    expect(slowFrame.eventKey).toBeDefined();
    expect(fastFrame.eventKey).toBeDefined();
    expect(slowFrame.eventKey).not.toBe(fastFrame.eventKey);
  });

  it("emits project-neutral generator provenance for the default bank", () => {
    const signals = createModulatorSignals(
      createDefaultModulatorBank(origin, 1234, 2),
      new Date("2026-07-29T00:00:01.000Z")
    );

    expect(signals).toHaveLength(5);
    expect(signals.every((signal) => signal.signalKind === "generator")).toBe(true);
    expect(signals.every((signal) => signal.generator?.seed !== undefined)).toBe(true);
    expect(signals.every((signal) => signal.normalized !== null && signal.normalized >= 0 && signal.normalized <= 1)).toBe(true);
  });

  it("rejects unsafe rates and invalid phase origins", () => {
    expect(() => evaluateModulator({ ...definition("sine"), rateHz: 41 }, new Date()))
      .toThrow(/rate/);
    expect(() => evaluateModulator({ ...definition("sine"), phaseOrigin: "invalid" }, new Date()))
      .toThrow(/phase origin/);
  });
});
