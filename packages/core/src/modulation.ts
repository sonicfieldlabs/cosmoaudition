import { isAbsoluteTime } from "./time";
import type { GeneratorProvenance, ObservedSignal } from "./types";

export type ModulatorAlgorithm = GeneratorProvenance["algorithm"];

export interface ModulatorDefinition {
  id: string;
  label: string;
  algorithm: ModulatorAlgorithm;
  rateHz: number;
  outputRange: readonly [number, number];
  seed: number;
  phaseOrigin: string;
  phaseOffset?: number;
  dutyCycle?: number;
  smoothingMs: number;
}

export interface ModulatorFrame {
  id: string;
  value: number;
  normalized: number;
  phase: number;
  cycle: number;
  generatedAt: string;
  eventKey?: string;
}

const MAX_MODULATOR_RATE_HZ = 40;

function fract(value: number): number {
  return value - Math.floor(value);
}

function assertDefinition(definition: ModulatorDefinition): void {
  const [start, end] = definition.outputRange;
  if (!definition.id.trim() || !definition.label.trim()) {
    throw new RangeError("Modulator id and label must be non-empty.");
  }
  if (
    !Number.isFinite(definition.rateHz) ||
    definition.rateHz <= 0 ||
    definition.rateHz > MAX_MODULATOR_RATE_HZ
  ) {
    throw new RangeError("Modulator rate must be finite and inside 0..40 Hz.");
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) {
    throw new RangeError("Modulator output range must contain two finite values.");
  }
  if (!Number.isInteger(definition.seed)) {
    throw new RangeError("Modulator seed must be an integer.");
  }
  // A zoneless origin would be read as host-local time, making phase, cycle
  // number, event keys, and every emitted value differ by timezone while the
  // bank is documented and recorded as deterministic.
  if (!isAbsoluteTime(definition.phaseOrigin)) {
    throw new RangeError(
      "Modulator phase origin must be a date-time with an explicit UTC offset."
    );
  }
  if (!Number.isFinite(definition.smoothingMs) || definition.smoothingMs < 0) {
    throw new RangeError("Modulator smoothing must be a non-negative duration.");
  }
  if (
    definition.dutyCycle !== undefined &&
    (!Number.isFinite(definition.dutyCycle) ||
      definition.dutyCycle <= 0 ||
      definition.dutyCycle >= 1)
  ) {
    throw new RangeError("Pulse duty cycle must be inside 0..1.");
  }
}

/** Deterministic 32-bit integer hash, converted to a stable 0..1 value. */
function seededUnit(seed: number, cycle: number): number {
  let value = (seed ^ Math.imul(cycle + 1, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b) >>> 0;
  value ^= value >>> 16;
  return value / 0xffffffff;
}

function evaluateShape(
  definition: ModulatorDefinition,
  phase: number,
  cycle: number
): number {
  switch (definition.algorithm) {
    case "sine":
      return (Math.sin(phase * Math.PI * 2 - Math.PI / 2) + 1) / 2;
    case "triangle":
      return 1 - Math.abs(phase * 2 - 1);
    case "saw":
      return phase;
    case "pulse":
      return phase < (definition.dutyCycle ?? 0.1) ? 1 : 0;
    case "envelope": {
      const attack = 0.15;
      return phase < attack
        ? phase / attack
        : Math.max(0, 1 - (phase - attack) / (1 - attack));
    }
    case "sample-and-hold":
      return seededUnit(definition.seed, cycle);
  }
}

export function evaluateModulator(
  definition: ModulatorDefinition,
  at: Date
): ModulatorFrame {
  assertDefinition(definition);
  if (!Number.isFinite(at.getTime())) {
    throw new RangeError("Modulator evaluation time must be valid.");
  }
  const elapsedSeconds = Math.max(
    0,
    (at.getTime() - Date.parse(definition.phaseOrigin)) / 1000
  );
  const position =
    elapsedSeconds * definition.rateHz + (definition.phaseOffset ?? 0);
  const cycle = Math.floor(position);
  const phase = fract(position);
  const normalized = evaluateShape(definition, phase, cycle);
  const [start, end] = definition.outputRange;
  const value = start + (end - start) * normalized;

  return {
    id: definition.id,
    value,
    normalized,
    phase,
    cycle,
    generatedAt: at.toISOString(),
    // The cycle counter restarts its numbering whenever the rate or phase
    // origin changes, so a key built from the cycle alone would collide with
    // cycles already emitted under a previous configuration and the gate would
    // fall silent until it counted past them. The configuration is part of the
    // event's identity.
    ...(definition.algorithm === "pulse" && normalized === 1
      ? {
          eventKey: `${definition.id}:${definition.phaseOrigin}:${definition.rateHz}:cycle:${cycle}`
        }
      : {})
  };
}

export function createDefaultModulatorBank(
  phaseOrigin: string,
  seed = 0x534d4f,
  rateMultiplier = 1
): readonly ModulatorDefinition[] {
  if (!Number.isFinite(rateMultiplier) || rateMultiplier < 0.05 || rateMultiplier > 8) {
    throw new RangeError("Modulator rate multiplier must be inside 0.05..8.");
  }
  return [
    {
      id: "local_clock_phase",
      label: "Local modulation clock",
      algorithm: "saw",
      rateHz: 0.5 * rateMultiplier,
      outputRange: [0, 1],
      seed,
      phaseOrigin,
      smoothingMs: 20
    },
    {
      id: "local_pulse_gate",
      label: "Local pulse gate",
      algorithm: "pulse",
      rateHz: 1 * rateMultiplier,
      outputRange: [0, 1],
      seed: seed + 1,
      phaseOrigin,
      dutyCycle: 0.5,
      smoothingMs: 5
    },
    {
      id: "local_lfo_bipolar",
      label: "Local bipolar LFO",
      algorithm: "sine",
      rateHz: 0.05 * rateMultiplier,
      outputRange: [-1, 1],
      seed: seed + 2,
      phaseOrigin,
      smoothingMs: 120
    },
    {
      id: "local_decay_envelope",
      label: "Local cyclic envelope",
      algorithm: "envelope",
      rateHz: 0.125 * rateMultiplier,
      outputRange: [0, 1],
      seed: seed + 3,
      phaseOrigin,
      smoothingMs: 80
    },
    {
      id: "local_sample_and_hold",
      label: "Local deterministic sample and hold",
      algorithm: "sample-and-hold",
      rateHz: 0.25 * rateMultiplier,
      outputRange: [0, 1],
      seed: seed + 4,
      phaseOrigin,
      smoothingMs: 160
    }
  ];
}

export function createModulatorSignals(
  definitions: readonly ModulatorDefinition[],
  at: Date
): ObservedSignal[] {
  return definitions.map((definition) => {
    const frame = evaluateModulator(definition, at);
    return {
      id: definition.id,
      label: definition.label,
      layer: "interface",
      unit: definition.outputRange[0] < 0 ? "bipolar" : "normalized",
      value: frame.value,
      normalized: frame.normalized,
      timestamp: frame.generatedAt,
      sourceId: "local_modulation_bank",
      sphere: "machine",
      epistemicStatus: "interpreted",
      temporalCharacter: "local",
      signalKind: "generator",
      ...(frame.eventKey ? { eventKey: frame.eventKey } : {}),
      generator: {
        algorithm: definition.algorithm,
        seed: definition.seed,
        rateHz: definition.rateHz,
        phaseOrigin: definition.phaseOrigin
      },
      confidence: "high",
      staleAfterSeconds: Math.max(1, 2 / definition.rateHz),
      notes:
        `Authored deterministic ${definition.algorithm} generator; this value is computed locally from phase, rate, and seed and is not provider data. Smoothing ${definition.smoothingMs} ms.`
    };
  });
}
