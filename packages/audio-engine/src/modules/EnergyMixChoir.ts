import type { ObservedSignal } from "@cosmoaudition/core";
import { createNoiseSource } from "../noise";
import {
  confidenceGain,
  getSignal,
  getSignalNormalized,
  normalizedToRange,
  safeParamRamp
} from "../params";
import type { AudioModule } from "./types";

export interface EnergyMixChoirParams {
  windBandFrequency: number | null;
  windGain: number;
  coalNoiseGain: number;
  coalFilterFrequency: number | null;
  solarFrequency: number | null;
  solarGain: number;
  gasFrequency: number | null;
  gasGain: number;
}

function activeConfidence(signal: ObservedSignal | undefined): number {
  if (
    !signal ||
    signal.value === null ||
    signal.normalized === null ||
    !Number.isFinite(signal.value) ||
    !Number.isFinite(signal.normalized)
  ) {
    return 0;
  }

  return confidenceGain(signal.confidence);
}

export function calculateEnergyMixChoirParams(
  signals: readonly ObservedSignal[]
): EnergyMixChoirParams {
  const wind = getSignal(signals, "generation_mix_wind");
  const coal = getSignal(signals, "generation_mix_coal");
  const solar = getSignal(signals, "generation_mix_solar");
  const gas = getSignal(signals, "generation_mix_gas");
  const windLevel = getSignalNormalized(signals, "generation_mix_wind");
  const coalLevel = getSignalNormalized(signals, "generation_mix_coal");
  const solarLevel = getSignalNormalized(signals, "generation_mix_solar");
  const gasLevel = getSignalNormalized(signals, "generation_mix_gas");

  return {
    windBandFrequency:
      windLevel === null ? null : normalizedToRange(windLevel, [400, 5000]),
    windGain:
      windLevel === null
        ? 0
        : normalizedToRange(windLevel, [0, 0.03]) * activeConfidence(wind),
    coalNoiseGain:
      coalLevel === null
        ? 0
        : normalizedToRange(coalLevel, [0, 0.024]) * activeConfidence(coal),
    coalFilterFrequency:
      coalLevel === null ? null : normalizedToRange(coalLevel, [120, 420]),
    solarFrequency:
      solarLevel === null ? null : normalizedToRange(solarLevel, [185, 370]),
    solarGain:
      solarLevel === null
        ? 0
        : normalizedToRange(solarLevel, [0, 0.022]) * activeConfidence(solar),
    gasFrequency:
      gasLevel === null ? null : normalizedToRange(gasLevel, [82, 146]),
    gasGain:
      gasLevel === null
        ? 0
        : normalizedToRange(gasLevel, [0, 0.024]) * activeConfidence(gas)
  };
}

export class EnergyMixChoir implements AudioModule {
  readonly id = "energyMixChoir";
  readonly layer = "earth" as const;
  private windSource: AudioBufferSourceNode | null = null;
  private coalSource: AudioBufferSourceNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private coalFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private coalGain: GainNode | null = null;
  private solarOscillator: OscillatorNode | null = null;
  private solarGain: GainNode | null = null;
  private gasOscillator: OscillatorNode | null = null;
  private gasGain: GainNode | null = null;

  start(context: AudioContext, destination: AudioNode): void {
    if (this.windSource) {
      return;
    }

    const windSource = createNoiseSource(context);
    const coalSource = createNoiseSource(context);
    const windFilter = context.createBiquadFilter();
    const coalFilter = context.createBiquadFilter();
    const windGain = context.createGain();
    const coalGain = context.createGain();
    const solarOscillator = context.createOscillator();
    const solarGain = context.createGain();
    const gasOscillator = context.createOscillator();
    const gasGain = context.createGain();

    windFilter.type = "bandpass";
    windFilter.frequency.value = 900;
    windFilter.Q.value = 0.8;
    coalFilter.type = "lowpass";
    coalFilter.frequency.value = 180;
    coalFilter.Q.value = 0.7;
    windGain.gain.value = 0;
    coalGain.gain.value = 0;

    solarOscillator.type = "sine";
    solarOscillator.frequency.value = 220;
    solarGain.gain.value = 0;
    gasOscillator.type = "triangle";
    gasOscillator.frequency.value = 96;
    gasGain.gain.value = 0;

    windSource.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(destination);
    coalSource.connect(coalFilter);
    coalFilter.connect(coalGain);
    coalGain.connect(destination);
    solarOscillator.connect(solarGain);
    solarGain.connect(destination);
    gasOscillator.connect(gasGain);
    gasGain.connect(destination);

    windSource.start();
    coalSource.start();
    solarOscillator.start();
    gasOscillator.start();

    this.windSource = windSource;
    this.coalSource = coalSource;
    this.windFilter = windFilter;
    this.coalFilter = coalFilter;
    this.windGain = windGain;
    this.coalGain = coalGain;
    this.solarOscillator = solarOscillator;
    this.solarGain = solarGain;
    this.gasOscillator = gasOscillator;
    this.gasGain = gasGain;
  }

  update(signals: readonly ObservedSignal[], context: AudioContext): void {
    if (
      !this.windFilter ||
      !this.coalFilter ||
      !this.windGain ||
      !this.coalGain ||
      !this.solarOscillator ||
      !this.solarGain ||
      !this.gasOscillator ||
      !this.gasGain
    ) {
      return;
    }

    const params = calculateEnergyMixChoirParams(signals);

    if (params.windBandFrequency !== null) {
      safeParamRamp(
        this.windFilter.frequency,
        params.windBandFrequency,
        context.currentTime,
        900
      );
    }
    safeParamRamp(this.windGain.gain, params.windGain, context.currentTime, 900);
    safeParamRamp(this.coalGain.gain, params.coalNoiseGain, context.currentTime, 900);
    if (params.solarFrequency !== null) {
      safeParamRamp(this.solarOscillator.frequency, params.solarFrequency, context.currentTime, 900);
    }
    safeParamRamp(this.solarGain.gain, params.solarGain, context.currentTime, 900);
    if (params.gasFrequency !== null) {
      safeParamRamp(this.gasOscillator.frequency, params.gasFrequency, context.currentTime, 900);
    }
    safeParamRamp(this.gasGain.gain, params.gasGain, context.currentTime, 900);
    if (params.coalFilterFrequency !== null) {
      safeParamRamp(
        this.coalFilter.frequency,
        params.coalFilterFrequency,
        context.currentTime,
        900
      );
    }
  }

  stop(context: AudioContext): void {
    if (!this.windSource) {
      return;
    }

    if (this.windGain) {
      safeParamRamp(this.windGain.gain, 0, context.currentTime, 20);
    }
    if (this.coalGain) {
      safeParamRamp(this.coalGain.gain, 0, context.currentTime, 20);
    }
    if (this.solarGain) {
      safeParamRamp(this.solarGain.gain, 0, context.currentTime, 20);
    }
    if (this.gasGain) {
      safeParamRamp(this.gasGain.gain, 0, context.currentTime, 20);
    }

    this.windSource.stop(context.currentTime + 0.06);
    this.coalSource?.stop(context.currentTime + 0.06);
    this.solarOscillator?.stop(context.currentTime + 0.06);
    this.gasOscillator?.stop(context.currentTime + 0.06);
    this.disconnect();
  }

  private disconnect(): void {
    this.windSource?.disconnect();
    this.coalSource?.disconnect();
    this.windFilter?.disconnect();
    this.coalFilter?.disconnect();
    this.windGain?.disconnect();
    this.coalGain?.disconnect();
    this.solarOscillator?.disconnect();
    this.solarGain?.disconnect();
    this.gasOscillator?.disconnect();
    this.gasGain?.disconnect();
    this.windSource = null;
    this.coalSource = null;
    this.windFilter = null;
    this.coalFilter = null;
    this.windGain = null;
    this.coalGain = null;
    this.solarOscillator = null;
    this.solarGain = null;
    this.gasOscillator = null;
    this.gasGain = null;
  }
}
