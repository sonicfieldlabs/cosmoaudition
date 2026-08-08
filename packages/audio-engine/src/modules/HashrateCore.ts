import {
  confidenceGain,
  getSignal,
  getSignalNormalized,
  normalizedToRange,
  safeParamRamp
} from "../params";
import type { AudioModule } from "./types";
import type { ObservedSignal } from "@cosmoaudition/core";

export class HashrateCore implements AudioModule {
  readonly id = "hashrateCore";
  readonly layer = "cloud" as const;
  private carrier: OscillatorNode | null = null;
  private modulator: OscillatorNode | null = null;
  private modGain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private gain: GainNode | null = null;

  start(context: AudioContext, destination: AudioNode): void {
    if (this.carrier) {
      return;
    }

    const carrier = context.createOscillator();
    const modulator = context.createOscillator();
    const modGain = context.createGain();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();

    carrier.type = "sine";
    carrier.frequency.value = 96;
    modulator.type = "sine";
    modulator.frequency.value = 144;
    modGain.gain.value = 0;
    filter.type = "bandpass";
    filter.frequency.value = 700;
    filter.Q.value = 1.4;
    gain.gain.value = 0;

    modulator.connect(modGain);
    modGain.connect(carrier.frequency);
    carrier.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    carrier.start();
    modulator.start();

    this.carrier = carrier;
    this.modulator = modulator;
    this.modGain = modGain;
    this.filter = filter;
    this.gain = gain;
  }

  update(signals: readonly ObservedSignal[], context: AudioContext): void {
    if (!this.carrier || !this.modulator || !this.modGain || !this.filter || !this.gain) {
      return;
    }

    const signal = getSignal(signals, "bitcoin_current_hashrate");
    const hashrate = getSignalNormalized(signals, "bitcoin_current_hashrate");
    const mempool = getSignalNormalized(signals, "bitcoin_mempool_vsize");
    const confidence = confidenceGain(signal?.confidence);
    if (hashrate === null) {
      safeParamRamp(this.gain.gain, 0, context.currentTime, 120);
      return;
    }

    const carrierFrequency = normalizedToRange(hashrate, [72, 168]);

    safeParamRamp(this.carrier.frequency, carrierFrequency, context.currentTime, 1200);
    safeParamRamp(this.modGain.gain, normalizedToRange(hashrate, [4, 74]), context.currentTime, 1500);
    if (mempool !== null) {
      const modulationFrequency =
        carrierFrequency * normalizedToRange(mempool, [0.8, 2.1]);
      safeParamRamp(this.modulator.frequency, modulationFrequency, context.currentTime, 1200);
      safeParamRamp(this.filter.frequency, normalizedToRange(mempool, [380, 1800]), context.currentTime, 900);
    }
    safeParamRamp(this.gain.gain, (0.01 + hashrate * 0.035) * confidence, context.currentTime, 900);
  }

  stop(context: AudioContext): void {
    if (!this.carrier || !this.modulator || !this.gain) {
      return;
    }

    safeParamRamp(this.gain.gain, 0, context.currentTime, 30);
    this.carrier.stop(context.currentTime + 0.08);
    this.modulator.stop(context.currentTime + 0.08);
    this.carrier.disconnect();
    this.modulator.disconnect();
    this.modGain?.disconnect();
    this.filter?.disconnect();
    this.gain.disconnect();
    this.carrier = null;
    this.modulator = null;
    this.modGain = null;
    this.filter = null;
    this.gain = null;
  }
}
