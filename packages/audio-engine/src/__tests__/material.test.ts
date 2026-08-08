import {
  executeMapping,
  mappingCatalog,
  type ControlDecision,
  type ObservedSignal
} from "@cosmoaudition/core";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MATERIAL_CONTROL,
  DEFAULT_MATERIAL_CONTROL_ROUTES,
  materialControlPatchFromDecisions,
  validateMaterialControlPatch
} from "../material";

function decision(
  status: ControlDecision["status"],
  outputValue: number | null,
  target = "material.cutoffHz"
): ControlDecision {
  return {
    mappingId: `mapping-${status}`,
    signalId: "signal",
    layer: "user",
    target,
    status,
    reason: status === "refused" ? "invalid-input" : "mapped",
    inputValue: outputValue,
    normalizedInput: outputValue === null ? null : 0.5,
    outputValue,
    previousOutput: null,
    confidence: "high",
    smoothingMs: 100,
    epistemicNote: "test"
  };
}

describe("imported material controls", () => {
  it("applies finite controls inside conservative bounds", () => {
    const update = validateMaterialControlPatch(DEFAULT_MATERIAL_CONTROL, {
      cutoffHz: 4200,
      playbackRate: 0.75,
      delayMix: 0.4,
      gain: 0.3
    });

    expect(update.controls).toEqual({
      ...DEFAULT_MATERIAL_CONTROL,
      cutoffHz: 4200,
      playbackRate: 0.75,
      delayMix: 0.4,
      gain: 0.3
    });
    expect(update.decisions.every((item) => item.status === "applied")).toBe(true);
  });

  it("refuses unsafe and non-finite values without changing prior state", () => {
    const update = validateMaterialControlPatch(DEFAULT_MATERIAL_CONTROL, {
      cutoffHz: Number.NaN,
      playbackRate: 20,
      gain: 0.8
    });

    expect(update.controls).toEqual(DEFAULT_MATERIAL_CONTROL);
    expect(update.decisions.map((item) => item.status)).toEqual([
      "refused",
      "refused",
      "refused"
    ]);
  });

  it("respects the active context's Nyquist-derived cutoff ceiling", () => {
    const update = validateMaterialControlPatch(
      DEFAULT_MATERIAL_CONTROL,
      { cutoffHz: 6000 },
      4000
    );
    expect(update.controls.cutoffHz).toBe(DEFAULT_MATERIAL_CONTROL.cutoffHz);
    expect(update.decisions[0]?.reason).toBe("outside-safe-range");
  });

  it("routes only executable, non-null control decisions", () => {
    const routed = materialControlPatchFromDecisions(
      [
        decision("applied", 4200),
        decision("uncertainty", 0.35, "material.delayMix"),
        decision("skipped", null, "material.gain"),
        decision("refused", null, "material.playbackRate")
      ],
      [
        { target: "material.cutoffHz", control: "cutoffHz" },
        { target: "material.delayMix", control: "delayMix" },
        { target: "material.gain", control: "gain" },
        { target: "material.playbackRate", control: "playbackRate" }
      ]
    );

    expect(routed.patch).toEqual({ cutoffHz: 4200, delayMix: 0.35 });
    expect(routed.routedMappingIds).toEqual([
      "mapping-applied",
      "mapping-uncertainty"
    ]);
    expect(routed.smoothingMsByControl).toEqual({
      cutoffHz: 100,
      delayMix: 100
    });
  });

  it("refuses ambiguous duplicate routing", () => {
    expect(() =>
      materialControlPatchFromDecisions([decision("applied", 4200)], [
        { target: "material.cutoffHz", control: "cutoffHz" },
        { target: "other", control: "cutoffHz" }
      ])
    ).toThrow(/Duplicate material route control/);
  });

  it("turns the declared solar-wind mapping into a material transformation", () => {
    const mapping = mappingCatalog.find(
      (candidate) => candidate.id === "solar-wind-speed-microsonic-clock"
    );
    expect(mapping).toBeDefined();

    const signal: ObservedSignal = {
      id: "solar_wind_speed",
      label: "solar wind speed",
      layer: "address",
      unit: "km/s",
      value: 575,
      normalized: 0.5,
      timestamp: "2026-07-28T00:00:00.000Z",
      sourceId: "noaa_swpc_solar_wind_speed",
      confidence: "high",
      staleAfterSeconds: 300
    };
    const mapped = executeMapping(mapping!, signal);
    const routed = materialControlPatchFromDecisions(
      [mapped],
      DEFAULT_MATERIAL_CONTROL_ROUTES
    );

    expect(mapped.status).toBe("applied");
    expect(routed.patch.playbackRate).toBeCloseTo(1.125);
    expect(routed.smoothingMsByControl.playbackRate).toBe(1600);
  });
});
