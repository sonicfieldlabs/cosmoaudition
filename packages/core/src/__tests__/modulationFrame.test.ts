import { describe, expect, it } from "vitest";
import {
  buildModulationFrame,
  MODULATION_CONTRACT,
  type ModulationFrameInput
} from "../modulation-frame";
import { mappingCatalog } from "../mappings";
import type { ObservedSignal, SourceHealth } from "../types";

function signal(overrides: Partial<ObservedSignal> & Pick<ObservedSignal, "id" | "sourceId">): ObservedSignal {
  const { id, sourceId, ...rest } = overrides;
  return {
    id,
    sourceId,
    label: id,
    layer: "earth",
    unit: "unit",
    value: 1,
    normalized: 0.5,
    timestamp: "2026-08-07T12:00:00.000Z",
    confidence: "high",
    staleAfterSeconds: 600,
    ...rest
  };
}

function health(sourceId: string): SourceHealth {
  return {
    sourceId,
    status: "ready",
    confidence: "high",
    fetchedAt: "2026-08-07T12:00:00.000Z",
    staleAfterSeconds: 600
  };
}

/** A catalog mapping whose signal is straightforward to satisfy. */
const sampleMapping = mappingCatalog[0]!;

function input(overrides: Partial<ModulationFrameInput> = {}): ModulationFrameInput {
  return {
    generatedAt: "2026-08-07T12:00:00.000Z",
    mode: "fixture",
    signals: [
      signal({
        id: sampleMapping.signalId,
        sourceId: "carbon_intensity_gb",
        value: 150,
        normalized: 0.3
      })
    ],
    sources: [health("carbon_intensity_gb")],
    ...overrides
  };
}

describe("modulation frame contract", () => {
  it("declares its contract and carries every catalog mapping as a control", () => {
    const frame = buildModulationFrame(input());

    expect(frame.contract).toBe(MODULATION_CONTRACT);
    expect(frame.controls).toHaveLength(mappingCatalog.length);
    expect(frame.generatedAt).toBe("2026-08-07T12:00:00.000Z");
  });

  it("never emits a value without its status, and states absence explicitly", () => {
    const frame = buildModulationFrame(input());

    // Every emitted number has a matching control carrying its decision.
    for (const target of Object.keys(frame.values)) {
      const control = frame.controls.find((item) => item.target === target);
      expect(control).toBeDefined();
      expect(control?.status).toBeDefined();
      expect(control?.outputValue).toBe(frame.values[target]);
    }

    // Anything absent is named with a reason rather than silently missing.
    for (const absence of frame.absences) {
      expect(frame.values[absence.target]).toBeUndefined();
      expect(absence.reason.length).toBeGreaterThan(0);
      expect(absence.epistemicNote.length).toBeGreaterThan(0);
    }

    const executable = frame.controls.filter(
      (control) => control.outputValue !== null
    ).length;
    expect(Object.keys(frame.values)).toHaveLength(executable);
  });

  it("emits absences rather than values for signals it does not have", () => {
    const frame = buildModulationFrame(input({ signals: [] }));

    expect(frame.values).toEqual({});
    expect(frame.absences).toHaveLength(mappingCatalog.length);
    expect(frame.absences.every((absence) => absence.reason.length > 0)).toBe(true);
  });

  it("carries attribution and licence notes for contributing sources", () => {
    const frame = buildModulationFrame(input());
    const carbon = frame.attribution.find(
      (entry) => entry.sourceId === "carbon_intensity_gb"
    );

    expect(carbon).toBeDefined();
    expect(carbon?.licenseNote.length).toBeGreaterThan(0);
    expect(carbon?.limitation.length).toBeGreaterThan(0);
  });

  it("reports the acquisition mode a replayed observation was taken in", () => {
    const frame = buildModulationFrame(
      input({ mode: "archive", originMode: "fixture" })
    );

    expect(frame.acquisitionMode).toBe("archive");
    expect(frame.originMode).toBe("fixture");
    expect(
      frame.attribution.every((entry) => entry.originalAcquisitionMode === "fixture")
    ).toBe(true);
  });

  it("honors operator route settings", () => {
    const disabled = buildModulationFrame(
      input({ routes: { [sampleMapping.id]: { enabled: false, amount: 1 } } })
    );
    const control = disabled.controls.find(
      (item) => item.mappingId === sampleMapping.id
    );

    expect(control?.status).toBe("skipped");
    expect(disabled.values[sampleMapping.target]).toBeUndefined();
    expect(
      disabled.absences.some((absence) => absence.mappingId === sampleMapping.id)
    ).toBe(true);
  });
});
