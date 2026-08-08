import {
  isExecutableControlDecision,
  type ControlDecision,
  type DerivedIndex,
  type ObservedSignal,
  type SignalTrigger
} from "@cosmoaudition/core";
import { createNoiseSource } from "../noise";
import { normalizedToRange, safeParamRamp } from "../params";
import type { AudioModule } from "./types";

export type ControlVoiceGroup = "cosmic" | "biosphere" | "culture";

export interface ControlVoiceGroupState {
  active: boolean;
  level: number | null;
  confidenceScalar: number;
  decisionCount: number;
}

const BIOSPHERE_PATTERN =
  /(\binat|biodivers|species|organism|ecolog|biosphere|taxon|living)/i;
const CULTURE_PATTERN =
  /(wikimedia|culture|cultural|pageview|attention|knowledge|\bmedia\b)/i;
const COSMIC_PATTERN =
  /(cosmic|space|solar|swpc|jpl|asteroid|comet|near.?earth|geomagnetic|aurora|sunspot|planet)/i;
const EVENT_TARGET_PATTERN =
  /(^|\.)(event|trigger)(\.|$)|approachHorizon|pageviewAccent/i;

export function isEventControlTarget(target: string): boolean {
  return EVENT_TARGET_PATTERN.test(target);
}

export function classifyControlDecision(
  decision: Pick<ControlDecision, "mappingId" | "target">
): ControlVoiceGroup | null {
  const semanticAddress = `${decision.mappingId} ${decision.target}`;
  if (BIOSPHERE_PATTERN.test(semanticAddress)) {
    return "biosphere";
  }
  if (CULTURE_PATTERN.test(semanticAddress)) {
    return "culture";
  }
  if (COSMIC_PATTERN.test(semanticAddress)) {
    return "cosmic";
  }
  return null;
}

export function calculateControlVoiceGroupState(
  decisions: readonly ControlDecision[],
  group: ControlVoiceGroup
): ControlVoiceGroupState {
  const executable = decisions
    .filter((decision) => classifyControlDecision(decision) === group)
    .filter(isExecutableControlDecision)
    .filter(
      (decision) =>
        decision.status !== "held" &&
        decision.normalizedInput !== null &&
        Number.isFinite(decision.normalizedInput)
    )
    .sort((left, right) => left.mappingId.localeCompare(right.mappingId));

  if (executable.length === 0) {
    return {
      active: false,
      level: null,
      confidenceScalar: 0,
      decisionCount: 0
    };
  }

  const level =
    executable.reduce(
      (sum, decision) =>
        decision.normalizedInput === null
          ? sum
          : sum + decision.normalizedInput,
      0
    ) / executable.length;
  const confidenceScalar = executable.some(
    (decision) => decision.status === "uncertainty"
  )
    ? 0.42
    : 1;

  return {
    active: true,
    level,
    confidenceScalar,
    decisionCount: executable.length
  };
}

/**
 * A restrained receiver for new mapped domains. It does not guess source ids:
 * semantic mapping targets select a cosmic FM field, a biosphere noise body,
 * or culture/event impulses. The same decisions can separately transform an
 * imported material through AudioEngine.routeMaterialControls().
 */
export class ControlFieldVoice implements AudioModule {
  readonly id = "controlFieldVoice";
  readonly layer = "address" as const;
  private cosmicCarrier: OscillatorNode | null = null;
  private cosmicModulator: OscillatorNode | null = null;
  private cosmicModGain: GainNode | null = null;
  private cosmicFilter: BiquadFilterNode | null = null;
  private cosmicGain: GainNode | null = null;
  private biosphereSource: AudioBufferSourceNode | null = null;
  private biosphereFilter: BiquadFilterNode | null = null;
  private biosphereGain: GainNode | null = null;
  private cultureCarrier: OscillatorNode | null = null;
  private cultureModulator: OscillatorNode | null = null;
  private cultureModGain: GainNode | null = null;
  private cultureGain: GainNode | null = null;
  private context: AudioContext | null = null;
  private destination: AudioNode | null = null;
  private playedTriggerIds = new Set<string>();

  start(context: AudioContext, destination: AudioNode): void {
    if (this.cosmicCarrier) {
      return;
    }

    const cosmicCarrier = context.createOscillator();
    const cosmicModulator = context.createOscillator();
    const cosmicModGain = context.createGain();
    const cosmicFilter = context.createBiquadFilter();
    const cosmicGain = context.createGain();
    const biosphereSource = createNoiseSource(context);
    const biosphereFilter = context.createBiquadFilter();
    const biosphereGain = context.createGain();
    const cultureCarrier = context.createOscillator();
    const cultureModulator = context.createOscillator();
    const cultureModGain = context.createGain();
    const cultureGain = context.createGain();

    cosmicCarrier.type = "sine";
    cosmicCarrier.frequency.value = 72;
    cosmicModulator.type = "sine";
    cosmicModulator.frequency.value = 0.12;
    cosmicModGain.gain.value = 0;
    cosmicFilter.type = "bandpass";
    cosmicFilter.frequency.value = 420;
    cosmicFilter.Q.value = 1.2;
    cosmicGain.gain.value = 0;

    biosphereFilter.type = "bandpass";
    biosphereFilter.frequency.value = 900;
    biosphereFilter.Q.value = 1;
    biosphereGain.gain.value = 0;

    cultureCarrier.type = "triangle";
    cultureCarrier.frequency.value = 130;
    cultureModulator.type = "sine";
    cultureModulator.frequency.value = 0.04;
    cultureModGain.gain.value = 0;
    cultureGain.gain.value = 0;

    cosmicModulator.connect(cosmicModGain);
    cosmicModGain.connect(cosmicCarrier.frequency);
    cosmicCarrier.connect(cosmicFilter);
    cosmicFilter.connect(cosmicGain);
    cosmicGain.connect(destination);
    biosphereSource.connect(biosphereFilter);
    biosphereFilter.connect(biosphereGain);
    biosphereGain.connect(destination);
    cultureModulator.connect(cultureModGain);
    cultureModGain.connect(cultureCarrier.detune);
    cultureCarrier.connect(cultureGain);
    cultureGain.connect(destination);

    cosmicCarrier.start();
    cosmicModulator.start();
    biosphereSource.start();
    cultureCarrier.start();
    cultureModulator.start();

    this.context = context;
    this.destination = destination;
    this.cosmicCarrier = cosmicCarrier;
    this.cosmicModulator = cosmicModulator;
    this.cosmicModGain = cosmicModGain;
    this.cosmicFilter = cosmicFilter;
    this.cosmicGain = cosmicGain;
    this.biosphereSource = biosphereSource;
    this.biosphereFilter = biosphereFilter;
    this.biosphereGain = biosphereGain;
    this.cultureCarrier = cultureCarrier;
    this.cultureModulator = cultureModulator;
    this.cultureModGain = cultureModGain;
    this.cultureGain = cultureGain;
  }

  update(
    _signals: readonly ObservedSignal[],
    context: AudioContext,
    _density: number,
    _indices: readonly DerivedIndex[],
    decisions: readonly ControlDecision[] = []
  ): void {
    if (
      !this.cosmicCarrier ||
      !this.cosmicModulator ||
      !this.cosmicModGain ||
      !this.cosmicFilter ||
      !this.cosmicGain ||
      !this.biosphereFilter ||
      !this.biosphereGain
    ) {
      return;
    }

    this.updateCosmicField(decisions, context);
    this.updateBiosphereField(decisions, context);
    this.updateCultureField(decisions, context);
  }

  stop(context: AudioContext): void {
    if (!this.cosmicCarrier) {
      return;
    }

    if (this.cosmicGain) {
      safeParamRamp(this.cosmicGain.gain, 0, context.currentTime, 20);
    }
    if (this.biosphereGain) {
      safeParamRamp(this.biosphereGain.gain, 0, context.currentTime, 20);
    }
    if (this.cultureGain) {
      safeParamRamp(this.cultureGain.gain, 0, context.currentTime, 20);
    }
    this.cosmicCarrier.stop(context.currentTime + 0.06);
    this.cosmicModulator?.stop(context.currentTime + 0.06);
    this.biosphereSource?.stop(context.currentTime + 0.06);
    this.cultureCarrier?.stop(context.currentTime + 0.06);
    this.cultureModulator?.stop(context.currentTime + 0.06);
    this.cosmicCarrier.disconnect();
    this.cosmicModulator?.disconnect();
    this.cosmicModGain?.disconnect();
    this.cosmicFilter?.disconnect();
    this.cosmicGain?.disconnect();
    this.biosphereSource?.disconnect();
    this.biosphereFilter?.disconnect();
    this.biosphereGain?.disconnect();
    this.cultureCarrier?.disconnect();
    this.cultureModulator?.disconnect();
    this.cultureModGain?.disconnect();
    this.cultureGain?.disconnect();
    this.cosmicCarrier = null;
    this.cosmicModulator = null;
    this.cosmicModGain = null;
    this.cosmicFilter = null;
    this.cosmicGain = null;
    this.biosphereSource = null;
    this.biosphereFilter = null;
    this.biosphereGain = null;
    this.cultureCarrier = null;
    this.cultureModulator = null;
    this.cultureModGain = null;
    this.cultureGain = null;
    this.context = null;
    this.destination = null;
    this.playedTriggerIds.clear();
  }

  private updateCosmicField(
    decisions: readonly ControlDecision[],
    context: AudioContext
  ): void {
    if (
      !this.cosmicCarrier ||
      !this.cosmicModulator ||
      !this.cosmicModGain ||
      !this.cosmicFilter ||
      !this.cosmicGain
    ) {
      return;
    }

    const relevant = decisions.filter(
      (decision) =>
        classifyControlDecision(decision) === "cosmic" &&
        !isEventControlTarget(decision.target)
    );
    const hasHeld = relevant.some((decision) => decision.status === "held");
    const state = calculateControlVoiceGroupState(relevant, "cosmic");
    if (!state.active || state.level === null) {
      if (!hasHeld) {
        safeParamRamp(this.cosmicGain.gain, 0, context.currentTime, 220);
      }
      return;
    }

    safeParamRamp(
      this.cosmicCarrier.frequency,
      normalizedToRange(state.level, [48, 174]),
      context.currentTime,
      1200
    );
    safeParamRamp(
      this.cosmicModulator.frequency,
      normalizedToRange(state.level, [0.04, 7.5]),
      context.currentTime,
      1500
    );
    safeParamRamp(
      this.cosmicModGain.gain,
      normalizedToRange(state.level, [0, 82]),
      context.currentTime,
      1500
    );
    safeParamRamp(
      this.cosmicFilter.frequency,
      normalizedToRange(state.level, [180, 4200]),
      context.currentTime,
      1200
    );
    safeParamRamp(
      this.cosmicGain.gain,
      normalizedToRange(state.level, [0.006, 0.026]) * state.confidenceScalar,
      context.currentTime,
      900
    );
  }

  private updateBiosphereField(
    decisions: readonly ControlDecision[],
    context: AudioContext
  ): void {
    if (!this.biosphereFilter || !this.biosphereGain) {
      return;
    }

    const relevant = decisions.filter(
      (decision) => classifyControlDecision(decision) === "biosphere"
    );
    const hasHeld = relevant.some((decision) => decision.status === "held");
    const state = calculateControlVoiceGroupState(relevant, "biosphere");
    if (!state.active || state.level === null) {
      if (!hasHeld) {
        safeParamRamp(this.biosphereGain.gain, 0, context.currentTime, 220);
      }
      return;
    }

    safeParamRamp(
      this.biosphereFilter.frequency,
      normalizedToRange(state.level, [240, 5600]),
      context.currentTime,
      1000
    );
    safeParamRamp(
      this.biosphereFilter.Q,
      normalizedToRange(state.level, [0.5, 8]),
      context.currentTime,
      1000
    );
    safeParamRamp(
      this.biosphereGain.gain,
      normalizedToRange(state.level, [0.002, 0.02]) * state.confidenceScalar,
      context.currentTime,
      800
    );
  }

  /** Emit only already-projected, stable-key triggers; repeated ids stay silent. */
  emitTriggers(triggers: readonly SignalTrigger[]): number {
    if (!this.context || !this.destination) return 0;
    let emitted = 0;
    for (const trigger of triggers.slice(0, 32)) {
      // A trigger without a bounded normalized level stays unvoiced; missing
      // data must not become a neutral midpoint.
      if (trigger.normalized === null || !Number.isFinite(trigger.normalized)) {
        continue;
      }
      if (this.playedTriggerIds.has(trigger.id)) continue;
      this.playedTriggerIds.add(trigger.id);
      while (this.playedTriggerIds.size > 4096) {
        const oldest = this.playedTriggerIds.values().next().value as
          | string
          | undefined;
        if (oldest === undefined) break;
        this.playedTriggerIds.delete(oldest);
      }
      const level = trigger.normalized;
      const uncertain = trigger.confidence === "low";
      this.emitTrigger(
        normalizedToRange(level, [260, 1680]),
        (uncertain ? 0.008 : 0.016) + level * (uncertain ? 0.006 : 0.012),
        normalizedToRange(1 - level, [0.045, 0.14]),
        emitted * 0.04
      );
      emitted += 1;
    }
    return emitted;
  }

  private updateCultureField(
    decisions: readonly ControlDecision[],
    context: AudioContext
  ): void {
    if (
      !this.cultureCarrier ||
      !this.cultureModulator ||
      !this.cultureModGain ||
      !this.cultureGain
    ) {
      return;
    }

    const relevant = decisions.filter(
      (decision) =>
        classifyControlDecision(decision) === "culture" &&
        !isEventControlTarget(decision.target)
    );
    const hasHeld = relevant.some((decision) => decision.status === "held");
    const state = calculateControlVoiceGroupState(relevant, "culture");
    if (!state.active || state.level === null) {
      if (!hasHeld) {
        safeParamRamp(this.cultureGain.gain, 0, context.currentTime, 220);
      }
      return;
    }

    safeParamRamp(
      this.cultureCarrier.frequency,
      normalizedToRange(state.level, [96, 240]),
      context.currentTime,
      2200
    );
    safeParamRamp(
      this.cultureModulator.frequency,
      normalizedToRange(state.level, [0.015, 0.35]),
      context.currentTime,
      2600
    );
    safeParamRamp(
      this.cultureModGain.gain,
      normalizedToRange(state.level, [5, 120]),
      context.currentTime,
      2600
    );
    safeParamRamp(
      this.cultureGain.gain,
      normalizedToRange(state.level, [0.001, 0.009]) * state.confidenceScalar,
      context.currentTime,
      1800
    );
  }

  private emitTrigger(
    frequency: number,
    gainValue: number,
    duration: number,
    offsetSeconds = 0
  ): void {
    if (!this.context || !this.destination) {
      return;
    }

    const now = this.context.currentTime + offsetSeconds;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(gainValue, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }
}
