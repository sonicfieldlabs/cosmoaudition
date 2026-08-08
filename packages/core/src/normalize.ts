export function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

export function linearNormalize(
  value: number,
  inputRange: readonly [number, number]
): number {
  const [min, max] = inputRange;

  if (min === max) {
    return 0;
  }

  return clamp01((value - min) / (max - min));
}

export function nullableLinearNormalize(
  value: number | null,
  inputRange: readonly [number, number]
): number | null {
  return value === null ? null : linearNormalize(value, inputRange);
}

export function logNormalize(
  value: number,
  inputRange: readonly [number, number]
): number {
  const [min, max] = inputRange;

  if (min <= 0 || max <= 0 || min === max) {
    throw new RangeError("logNormalize requires a positive, non-zero range.");
  }

  const clampedValue = Math.min(Math.max(value, min), max);
  const logMin = Math.log(min);
  const logMax = Math.log(max);

  return clamp01((Math.log(clampedValue) - logMin) / (logMax - logMin));
}

export function nullableLogNormalize(
  value: number | null,
  inputRange: readonly [number, number]
): number | null {
  return value === null ? null : logNormalize(value, inputRange);
}

export function quantize(value: number, steps: number): number {
  if (!Number.isInteger(steps) || steps < 2) {
    throw new RangeError("quantize requires at least two integer steps.");
  }

  const clamped = clamp01(value);
  return Math.round(clamped * (steps - 1)) / (steps - 1);
}

export function smoothValue(
  previous: number,
  next: number,
  smoothing: number
): number {
  return previous + (next - previous) * clamp01(smoothing);
}

export interface WeightedMeanInput {
  value: number | null;
  weight?: number;
}

export function weightedMean(inputs: readonly WeightedMeanInput[]): number | null {
  let weightedTotal = 0;
  let weightTotal = 0;

  for (const input of inputs) {
    if (input.value === null || !Number.isFinite(input.value)) {
      continue;
    }

    const weight = input.weight ?? 1;
    if (weight <= 0 || !Number.isFinite(weight)) {
      continue;
    }

    weightedTotal += input.value * weight;
    weightTotal += weight;
  }

  if (weightTotal === 0) {
    return null;
  }

  return weightedTotal / weightTotal;
}
