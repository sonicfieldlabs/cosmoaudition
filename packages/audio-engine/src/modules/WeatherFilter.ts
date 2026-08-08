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

export interface WeatherFilterParams {
  cutoff: number | null;
  toneFrequency: number | null;
  toneGain: number;
  windQ: number | null;
  precipitationGain: number;
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

export function calculateWeatherFilterParams(
  signals: readonly ObservedSignal[]
): WeatherFilterParams {
  const temperature = getSignal(signals, "local_temperature_2m");
  const wind = getSignal(signals, "local_wind_speed_10m");
  const precipitation = getSignal(signals, "local_precipitation");
  const temperatureLevel = getSignalNormalized(signals, "local_temperature_2m");
  const windLevel = getSignalNormalized(signals, "local_wind_speed_10m");
  const precipitationLevel = getSignalNormalized(signals, "local_precipitation");
  const temperatureConfidence = activeConfidence(temperature);

  return {
    cutoff:
      temperatureLevel === null
        ? null
        : normalizedToRange(temperatureLevel, [500, 4200]),
    toneFrequency:
      temperatureLevel === null
        ? null
        : normalizedToRange(temperatureLevel, [96, 210]),
    toneGain:
      temperatureLevel === null
        ? 0
        : normalizedToRange(temperatureLevel, [0.004, 0.02]) *
          temperatureConfidence,
    windQ: windLevel === null ? null : normalizedToRange(windLevel, [0.45, 7]),
    precipitationGain:
      precipitationLevel === null
        ? 0
        : normalizedToRange(precipitationLevel, [0, 0.032]) *
          activeConfidence(precipitation)
  };
}

export class WeatherFilter implements AudioModule {
  readonly id = "weatherFilter";
  readonly layer = "user" as const;
  private oscillator: OscillatorNode | null = null;
  private rainSource: AudioBufferSourceNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private toneGain: GainNode | null = null;
  private rainGain: GainNode | null = null;

  start(context: AudioContext, destination: AudioNode): void {
    if (this.oscillator) {
      return;
    }

    const oscillator = context.createOscillator();
    const rainSource = createNoiseSource(context);
    const filter = context.createBiquadFilter();
    const toneGain = context.createGain();
    const rainGain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = 120;
    filter.type = "lowpass";
    filter.frequency.value = 900;
    filter.Q.value = 0.7;
    toneGain.gain.value = 0;
    rainGain.gain.value = 0;

    oscillator.connect(toneGain);
    toneGain.connect(filter);
    rainSource.connect(rainGain);
    rainGain.connect(filter);
    filter.connect(destination);
    oscillator.start();
    rainSource.start();

    this.oscillator = oscillator;
    this.rainSource = rainSource;
    this.filter = filter;
    this.toneGain = toneGain;
    this.rainGain = rainGain;
  }

  update(signals: readonly ObservedSignal[], context: AudioContext): void {
    if (!this.oscillator || !this.filter || !this.toneGain || !this.rainGain) {
      return;
    }

    const params = calculateWeatherFilterParams(signals);

    if (params.cutoff !== null) {
      safeParamRamp(this.filter.frequency, params.cutoff, context.currentTime, 1500);
    }
    if (params.windQ !== null) {
      safeParamRamp(this.filter.Q, params.windQ, context.currentTime, 900);
    }
    if (params.toneFrequency !== null) {
      safeParamRamp(this.oscillator.frequency, params.toneFrequency, context.currentTime, 1200);
    }
    safeParamRamp(this.toneGain.gain, params.toneGain, context.currentTime, 900);
    safeParamRamp(this.rainGain.gain, params.precipitationGain, context.currentTime, 900);
  }

  stop(context: AudioContext): void {
    if (!this.oscillator || !this.toneGain || !this.rainGain) {
      return;
    }

    safeParamRamp(this.toneGain.gain, 0, context.currentTime, 20);
    safeParamRamp(this.rainGain.gain, 0, context.currentTime, 20);
    this.oscillator.stop(context.currentTime + 0.06);
    this.rainSource?.stop(context.currentTime + 0.06);
    this.oscillator.disconnect();
    this.rainSource?.disconnect();
    this.filter?.disconnect();
    this.toneGain.disconnect();
    this.rainGain.disconnect();
    this.oscillator = null;
    this.rainSource = null;
    this.filter = null;
    this.toneGain = null;
    this.rainGain = null;
  }
}
