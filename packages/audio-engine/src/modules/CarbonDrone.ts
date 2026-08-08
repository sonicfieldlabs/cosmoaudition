import {
  confidenceGain,
  getSignal,
  getSignalNormalized,
  normalizedToRange,
  safeParamRamp
} from "../params";
import type { AudioModule } from "./types";
import type { DerivedIndex, ObservedSignal } from "@cosmoaudition/core";

export interface CarbonDroneParams {
  cutoff: number | null;
  gain: number;
  detune: number | null;
  filterQ: number | null;
  source: "cei" | "carbon" | "none";
}

/**
 * The carbon drone follows the composite Carbon-Electric Intensity index (grid
 * carbon plus fossil and renewable mix) when it is available, and falls back to
 * raw grid carbon intensity when the generation mix is missing. Dirtier
 * electricity opens the filter, lifts presence, adds bite (Q), and detunes
 * slightly; with no data at all the drone stays silent rather than inventing a
 * floor.
 */
export function calculateCarbonDroneParams(
  signals: readonly ObservedSignal[],
  indices: readonly DerivedIndex[]
): CarbonDroneParams {
  const cei = indices.find((index) => index.id === "CEI");
  const carbon = getSignal(signals, "carbon_intensity_actual");
  const ceiLevel =
    cei &&
    cei.normalized !== null &&
    Number.isFinite(cei.normalized) &&
    cei.confidence !== "error"
      ? cei.normalized
      : null;
  const carbonLevel = getSignalNormalized(signals, "carbon_intensity_actual");

  let level: number | null;
  let confidence: number;
  let source: CarbonDroneParams["source"];

  if (ceiLevel !== null) {
    level = ceiLevel;
    confidence = confidenceGain(cei?.confidence);
    source = "cei";
  } else if (carbon && carbonLevel !== null) {
    level = carbonLevel;
    confidence = confidenceGain(carbon.confidence);
    source = "carbon";
  } else {
    level = null;
    confidence = 0;
    source = "none";
  }

  return {
    cutoff: level === null ? null : normalizedToRange(level, [260, 2600]),
    gain: level === null ? 0 : (0.012 + level * 0.04) * confidence,
    detune: level === null ? null : normalizedToRange(level, [-8, 18]),
    filterQ: level === null ? null : normalizedToRange(level, [0.7, 3]),
    source
  };
}

export class CarbonDrone implements AudioModule {
  readonly id = "carbonDrone";
  readonly layer = "earth" as const;
  private oscillator: OscillatorNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private gain: GainNode | null = null;

  start(context: AudioContext, destination: AudioNode): void {
    if (this.oscillator) {
      return;
    }

    const oscillator = context.createOscillator();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();

    oscillator.type = "sawtooth";
    oscillator.frequency.value = 55;
    filter.type = "lowpass";
    filter.frequency.value = 320;
    filter.Q.value = 0.7;
    gain.gain.value = 0;

    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    oscillator.start();

    this.oscillator = oscillator;
    this.filter = filter;
    this.gain = gain;
  }

  update(
    signals: readonly ObservedSignal[],
    context: AudioContext,
    _density: number,
    indices: readonly DerivedIndex[] = []
  ): void {
    if (!this.filter || !this.gain || !this.oscillator) {
      return;
    }

    const params = calculateCarbonDroneParams(signals, indices);

    if (params.cutoff !== null) {
      safeParamRamp(this.filter.frequency, params.cutoff, context.currentTime, 1200);
    }
    if (params.filterQ !== null) {
      safeParamRamp(this.filter.Q, params.filterQ, context.currentTime, 1200);
    }
    safeParamRamp(this.gain.gain, params.gain, context.currentTime, 900);
    if (params.detune !== null) {
      safeParamRamp(this.oscillator.detune, params.detune, context.currentTime, 1200);
    }
  }

  stop(context: AudioContext): void {
    if (!this.oscillator || !this.gain) {
      return;
    }

    safeParamRamp(this.gain.gain, 0, context.currentTime, 30);
    this.oscillator.stop(context.currentTime + 0.08);
    this.oscillator.disconnect();
    this.filter?.disconnect();
    this.gain.disconnect();
    this.oscillator = null;
    this.filter = null;
    this.gain = null;
  }
}
