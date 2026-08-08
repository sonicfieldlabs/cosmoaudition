import {
  confidenceGain,
  getSignal,
  getSignalNormalized,
  normalizedToRange,
  safeParamRamp
} from "../params";
import type { AudioModule } from "./types";
import type { ObservedSignal } from "@cosmoaudition/core";

export class QuakeResonator implements AudioModule {
  readonly id = "quakeResonator";
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

    oscillator.type = "sine";
    oscillator.frequency.value = 42;
    filter.type = "lowpass";
    filter.frequency.value = 160;
    filter.Q.value = 2.5;
    gain.gain.value = 0;

    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    oscillator.start();

    this.oscillator = oscillator;
    this.filter = filter;
    this.gain = gain;
  }

  update(signals: readonly ObservedSignal[], context: AudioContext): void {
    if (!this.oscillator || !this.filter || !this.gain) {
      return;
    }

    const countSignal = getSignal(signals, "earthquake_count_1h");
    const density = getSignalNormalized(signals, "earthquake_count_1h");
    const maxMag = getSignalNormalized(signals, "earthquake_max_magnitude_1h");
    const confidence = confidenceGain(countSignal?.confidence);

    if (maxMag !== null) {
      safeParamRamp(this.oscillator.frequency, normalizedToRange(maxMag, [36, 72]), context.currentTime, 500);
      safeParamRamp(this.filter.frequency, normalizedToRange(maxMag, [90, 420]), context.currentTime, 450);
    }
    safeParamRamp(
      this.gain.gain,
      density === null ? 0 : density * 0.045 * confidence,
      context.currentTime,
      250
    );
  }

  stop(context: AudioContext): void {
    if (!this.oscillator || !this.gain) {
      return;
    }

    safeParamRamp(this.gain.gain, 0, context.currentTime, 20);
    this.oscillator.stop(context.currentTime + 0.06);
    this.oscillator.disconnect();
    this.filter?.disconnect();
    this.gain.disconnect();
    this.oscillator = null;
    this.filter = null;
    this.gain = null;
  }
}
