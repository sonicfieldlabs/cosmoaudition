import { clamp01, type Confidence, type ObservedSignal } from "@cosmoaudition/core";

export interface AudioParamLike {
  cancelScheduledValues(cancelTime: number): AudioParamLike;
  setValueAtTime(value: number, startTime: number): AudioParamLike;
  setTargetAtTime(
    target: number,
    startTime: number,
    timeConstant: number
  ): AudioParamLike;
}

export function normalizedToRange(
  normalized: number,
  outputRange: readonly [number, number]
): number {
  const [min, max] = outputRange;
  if (
    !Number.isFinite(normalized) ||
    !Number.isFinite(min) ||
    !Number.isFinite(max)
  ) {
    throw new RangeError("Audio parameter mapping requires finite values.");
  }
  return min + (max - min) * clamp01(normalized);
}

// Global rhythmic density derived from the Stack Pulse Index. 0 -> sparser
// (longer intervals), 0.5 -> unchanged, 1 -> denser (shorter intervals). This
// only ever scales event timing, never gain, per the SPI design rule.
export function densityIntervalScale(density: number): number {
  return 1 + (0.5 - clamp01(density)) * 0.9;
}

export function confidenceGain(confidence: Confidence | undefined): number {
  switch (confidence) {
    case "high":
      return 1;
    case "medium":
      return 0.78;
    case "low":
      return 0.5;
    case "stale":
      return 0.28;
    case "error":
      return 0;
    default:
      return 0;
  }
}

export function getSignal(
  signals: readonly ObservedSignal[],
  signalId: string
): ObservedSignal | undefined {
  return signals.find((signal) => signal.id === signalId);
}

export function getSignalNormalized(
  signals: readonly ObservedSignal[],
  signalId: string
): number | null {
  const signal = getSignal(signals, signalId);
  if (
    !signal ||
    signal.value === null ||
    signal.normalized === null ||
    !Number.isFinite(signal.value) ||
    !Number.isFinite(signal.normalized) ||
    signal.confidence === "error"
  ) {
    return null;
  }
  return clamp01(signal.normalized);
}

export function getSignalValue(
  signals: readonly ObservedSignal[],
  signalId: string
): number | null {
  const value = getSignal(signals, signalId)?.value;
  return value !== undefined && value !== null && Number.isFinite(value)
    ? value
    : null;
}

export function safeParamRamp(
  param: AudioParamLike,
  value: number,
  currentTime: number,
  smoothingMs: number
): boolean {
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(currentTime) ||
    currentTime < 0 ||
    !Number.isFinite(smoothingMs) ||
    smoothingMs < 0
  ) {
    return false;
  }

  param.cancelScheduledValues(currentTime);

  if (smoothingMs <= 0) {
    param.setValueAtTime(value, currentTime);
    return true;
  }

  param.setTargetAtTime(value, currentTime, Math.max(0.005, smoothingMs / 3000));
  return true;
}
