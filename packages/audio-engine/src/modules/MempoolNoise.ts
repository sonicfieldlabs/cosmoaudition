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

export interface MempoolNoiseParams {
  densityGain: number;
  filterFrequency: number | null;
  filterQ: number | null;
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

export function calculateMempoolNoiseParams(
  signals: readonly ObservedSignal[]
): MempoolNoiseParams {
  const vsize = getSignal(signals, "bitcoin_mempool_vsize");
  const density = getSignalNormalized(signals, "bitcoin_mempool_vsize");
  const emphasis = getSignalNormalized(signals, "bitcoin_mempool_count");
  const confidence = activeConfidence(vsize);
  const filterLevel = emphasis ?? density;

  return {
    densityGain:
      density === null
        ? 0
        : normalizedToRange(density, [0, 0.04]) * confidence,
    filterFrequency:
      filterLevel === null
        ? null
        : normalizedToRange(filterLevel, [700, 4600]),
    filterQ: density === null ? null : normalizedToRange(density, [0.4, 4.6])
  };
}

export class MempoolNoise implements AudioModule {
  readonly id = "mempoolNoise";
  readonly layer = "cloud" as const;
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

    filter.type = "bandpass";
    filter.frequency.value = 900;
    filter.Q.value = 0.7;
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
    if (!this.filter || !this.gain) {
      return;
    }

    const params = calculateMempoolNoiseParams(signals);

    safeParamRamp(this.gain.gain, params.densityGain, context.currentTime, 800);
    if (params.filterFrequency !== null) {
      safeParamRamp(this.filter.frequency, params.filterFrequency, context.currentTime, 800);
    }
    if (params.filterQ !== null) {
      safeParamRamp(this.filter.Q, params.filterQ, context.currentTime, 800);
    }
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
