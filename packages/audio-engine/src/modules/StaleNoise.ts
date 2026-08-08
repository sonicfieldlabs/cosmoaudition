import { createNoiseSource } from "../noise";
import {
  confidenceGain,
  getSignal,
  getSignalNormalized,
  normalizedToRange,
  safeParamRamp
} from "../params";
import type { AudioModule } from "./types";
import type { ObservedSignal } from "@cosmoaudition/core";

export class StaleNoise implements AudioModule {
  readonly id = "staleNoise";
  readonly layer = "interface" as const;
  private source: AudioBufferSourceNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private gain: GainNode | null = null;

  start(context: AudioContext, destination: AudioNode): void {
    if (this.source) {
      return;
    }

    const source = createNoiseSource(context);
    const filter = context.createBiquadFilter();
    const gain = context.createGain();

    filter.type = "lowpass";
    filter.frequency.value = 620;
    filter.Q.value = 0.4;
    gain.gain.value = 0;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    source.start();

    this.source = source;
    this.filter = filter;
    this.gain = gain;
  }

  update(signals: readonly ObservedSignal[], context: AudioContext): void {
    if (!this.gain || !this.filter) {
      return;
    }

    const signal = getSignal(signals, "source_stale_count");
    const normalized = getSignalNormalized(signals, "source_stale_count");
    const confidence = confidenceGain(signal?.confidence);

    if (normalized === null) {
      safeParamRamp(this.gain.gain, 0, context.currentTime, 120);
      return;
    }

    safeParamRamp(this.gain.gain, normalizedToRange(normalized, [0, 0.08]) * confidence, context.currentTime, 700);
    safeParamRamp(this.filter.frequency, normalizedToRange(normalized, [320, 1200]), context.currentTime, 700);
  }

  stop(context: AudioContext): void {
    if (!this.source || !this.gain) {
      return;
    }

    safeParamRamp(this.gain.gain, 0, context.currentTime, 20);
    this.source.stop(context.currentTime + 0.05);
    this.source.disconnect();
    this.filter?.disconnect();
    this.gain.disconnect();
    this.source = null;
    this.filter = null;
    this.gain = null;
  }
}
