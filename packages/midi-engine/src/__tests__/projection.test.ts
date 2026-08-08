import type { ControlDecision } from "@cosmoaudition/core";
import { describe, expect, it, vi } from "vitest";
import {
  listMidiOutputs,
  projectControlDecision,
  projectControlDecisions,
  requestBrowserMidiAccess,
  sendProjectedControls,
  type MidiAccessLike,
  type MidiOutputLike
} from "../projection";

function decision(
  status: ControlDecision["status"],
  outputValue: number | null
): ControlDecision {
  return {
    mappingId: "temperature-cutoff",
    signalId: "temperature",
    layer: "user",
    target: "material.cutoffHz",
    status,
    reason: status === "uncertainty" ? "low-confidence" : "mapped",
    inputValue: outputValue,
    normalizedInput: outputValue === null ? null : 0.5,
    outputValue,
    previousOutput: null,
    confidence: status === "uncertainty" ? "low" : "high",
    smoothingMs: 100,
    epistemicNote: "test"
  };
}

const route = {
  target: "material.cutoffHz",
  channel: 2,
  controller: 74,
  sourceRange: [200, 2200] as const
};

describe("control-decision MIDI projection", () => {
  it("projects applied and uncertainty decisions but never null output", () => {
    expect(projectControlDecision(decision("applied", 1200), route, 96)?.event).toEqual({
      type: "control-change",
      tick: 96,
      channel: 2,
      controller: 74,
      value: 64
    });
    expect(
      projectControlDecision(decision("uncertainty", 1200), route)?.decisionStatus
    ).toBe("uncertainty");
    expect(projectControlDecision(decision("skipped", null), route)).toBeNull();
    expect(projectControlDecision(decision("refused", null), route)).toBeNull();
  });

  it("does not retransmit held state unless a route explicitly requests it", () => {
    expect(projectControlDecision(decision("held", 1200), route)).toBeNull();
    expect(
      projectControlDecision(decision("held", 1200), {
        ...route,
        transmitHeld: true
      })?.event.value
    ).toBe(64);
  });

  it("projects only decisions with declared target routes", () => {
    const projected = projectControlDecisions(
      [decision("applied", 1200), { ...decision("applied", 1200), target: "other" }],
      [route]
    );
    expect(projected).toHaveLength(1);
  });

  it("uses browser-safe structural Web MIDI helpers", async () => {
    const send = vi.fn();
    const output: MidiOutputLike = { id: "out", name: "test", send };
    const access: MidiAccessLike = {
      outputs: new Map([[output.id, output]])
    };
    const requestMIDIAccess = vi.fn(async () => access);

    expect(await requestBrowserMidiAccess({ requestMIDIAccess })).toBe(access);
    expect(listMidiOutputs(access)).toEqual([output]);

    const projected = projectControlDecisions([decision("applied", 1200)], [route]);
    sendProjectedControls(output, projected, 42);
    expect(send).toHaveBeenCalledWith([0xb2, 74, 64], 42);
  });

  it("reports browsers without Web MIDI explicitly", async () => {
    await expect(requestBrowserMidiAccess({})).rejects.toThrow(/not available/);
  });

  it("refuses duplicate and invalid routes instead of silently dropping them", () => {
    expect(() =>
      projectControlDecisions([decision("applied", 1200)], [route, { ...route, controller: 75 }])
    ).toThrow(/Duplicate MIDI control route target/);

    expect(() =>
      projectControlDecisions(
        [decision("applied", 1200)],
        [{ ...route, target: "material.gain", channel: 99 }]
      )
    ).toThrow();
  });
});
