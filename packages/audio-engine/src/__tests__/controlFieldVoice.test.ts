import {
  mappingCatalog,
  type ControlDecision,
  type SignalTrigger
} from "@cosmoaudition/core";
import { describe, expect, it, vi } from "vitest";
import {
  ControlFieldVoice,
  calculateControlVoiceGroupState,
  classifyControlDecision
} from "../modules/ControlFieldVoice";

function decision(options: {
  mappingId: string;
  target: string;
  status?: ControlDecision["status"];
  normalized?: number | null;
}): ControlDecision {
  const status = options.status ?? "applied";
  const normalized = options.normalized === undefined ? 0.5 : options.normalized;
  return {
    mappingId: options.mappingId,
    signalId: "source-signal",
    layer: "address",
    target: options.target,
    status,
    reason: status === "uncertainty" ? "low-confidence" : "mapped",
    inputValue: normalized,
    normalizedInput: normalized,
    outputValue: normalized,
    previousOutput: null,
    confidence: status === "uncertainty" ? "low" : "high",
    smoothingMs: 500,
    epistemicNote: "test"
  };
}

describe("semantic control-field voice routing", () => {
  it("recognizes new source families by mapping address, not adapter signal id", () => {
    expect(
      classifyControlDecision(
        decision({ mappingId: "swpc-kp", target: "cosmic.spaceWeather.fmDepth" })
      )
    ).toBe("cosmic");
    expect(
      classifyControlDecision(
        decision({ mappingId: "inat-species", target: "earth.biodiversity.band" })
      )
    ).toBe("biosphere");
    expect(
      classifyControlDecision(
        decision({ mappingId: "wikimedia", target: "culture.attention.trigger" })
      )
    ).toBe("culture");
  });

  it("combines executable inputs and attenuates uncertainty", () => {
    const state = calculateControlVoiceGroupState(
      [
        decision({ mappingId: "swpc-a", target: "cosmic.solar.a", normalized: 0.2 }),
        decision({
          mappingId: "jpl-b",
          target: "cosmic.nearEarth.b",
          normalized: 0.8,
          status: "uncertainty"
        })
      ],
      "cosmic"
    );

    expect(state.level).toBeCloseTo(0.5);
    expect(state.confidenceScalar).toBe(0.42);
    expect(state.decisionCount).toBe(2);
  });

  it("does not convert skipped or held decisions into a fresh control value", () => {
    const state = calculateControlVoiceGroupState(
      [
        decision({
          mappingId: "swpc-skipped",
          target: "cosmic.solar.a",
          normalized: null,
          status: "skipped"
        }),
        decision({
          mappingId: "swpc-held",
          target: "cosmic.solar.b",
          normalized: null,
          status: "held"
        })
      ],
      "cosmic"
    );

    expect(state).toEqual({
      active: false,
      level: null,
      confidenceScalar: 0,
      decisionCount: 0
    });
  });

  it("covers every active control mapping with an audible route", () => {
    const expectedGroups = new Map([
      ["solar-wind-speed-microsonic-clock", "cosmic"],
      ["solar-magnetic-bt-spectral-aperture", "cosmic"],
      ["solar-magnetic-bz-bipolar-field", "cosmic"],
      ["geomagnetic-kp-slow-scene", "cosmic"],
      ["jpl-near-earth-approach-clock", "cosmic"],
      ["jpl-approach-velocity-material-delay", "cosmic"],
      ["inaturalist-biosphere-submission-density", "biosphere"],
      ["wikimedia-culture-pageview-drift", "culture"],
      ["wikimedia-pageview-level", "culture"]
    ] as const);

    for (const [mappingId, group] of expectedGroups) {
      const mapping = mappingCatalog.find((candidate) => candidate.id === mappingId);
      expect(mapping, `missing mapping ${mappingId}`).toBeDefined();
      expect(
        classifyControlDecision({
          mappingId,
          target: mapping!.target
        })
      ).toBe(group);
    }
  });

  it("emits only explicit projected trigger ids and deduplicates repeats", () => {
    const createOscillator = vi.fn(() => ({
      type: "sine",
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn()
    }));
    const createGain = vi.fn(() => ({
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn()
      },
      connect: vi.fn()
    }));
    const voice = new ControlFieldVoice();
    const internals = voice as unknown as {
      context: AudioContext;
      destination: AudioNode;
    };
    internals.context = {
      currentTime: 1,
      createOscillator,
      createGain
    } as unknown as AudioContext;
    internals.destination = { connect: vi.fn() } as unknown as AudioNode;
    const trigger: SignalTrigger = {
      id: "cosmo-trigger:event-1",
      eventKey: "event-1",
      signalId: "event-signal",
      sourceId: "provider",
      occurredAt: "2026-07-29T00:00:00.000Z",
      projectedAt: "2026-07-29T00:00:01.000Z",
      value: 3,
      normalized: 0.5,
      unit: "unit",
      confidence: "high",
      claimBoundary: "test"
    };

    expect(voice.emitTriggers([trigger, trigger])).toBe(1);
    expect(voice.emitTriggers([trigger])).toBe(0);
    expect(createOscillator).toHaveBeenCalledTimes(1);

    const unmeasured: SignalTrigger = {
      ...trigger,
      id: "cosmo-trigger:event-2",
      eventKey: "event-2",
      normalized: null
    };
    expect(voice.emitTriggers([unmeasured])).toBe(0);
    expect(createOscillator).toHaveBeenCalledTimes(1);
  });
});
