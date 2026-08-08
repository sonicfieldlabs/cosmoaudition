import { linearNormalize, logNormalize } from "./normalize";
import type {
  Confidence,
  MissingDataPolicy,
  ObservedSignal,
  SonicMapping,
  StackLayer
} from "./types";

export type ControlDecisionStatus =
  | "applied"
  | "held"
  | "skipped"
  | "uncertainty"
  | "refused";

export type ControlDecisionReason =
  | "mapped"
  | "low-confidence"
  | "stale-input"
  | "missing-signal"
  | "missing-value"
  | "source-error"
  | "invalid-input"
  | "invalid-previous-output"
  | "invalid-mapping"
  | "unsupported-scale"
  | "interpolation-history-unavailable"
  | "route-disabled"
  | "policy-refusal";

/**
 * An executable mapping receipt. A null output is intentionally not an audio
 * value: it means that no control value may be sent to the target.
 */
export interface ControlDecision {
  mappingId: string;
  signalId: string;
  layer: StackLayer;
  target: string;
  status: ControlDecisionStatus;
  reason: ControlDecisionReason;
  inputValue: number | null;
  normalizedInput: number | null;
  /** Normalized observation before the operator's bounded route amount. */
  rawNormalizedInput?: number | null;
  /** Operator-authored traversal of the declared output range, in 0..1. */
  mappingAmount?: number;
  outputValue: number | null;
  previousOutput: number | null;
  confidence: Confidence | null;
  smoothingMs: number;
  epistemicNote: string;
}

export interface ExecuteMappingOptions {
  previousOutput?: number | null;
  /** Override the mapping's declared MASA missing-data policy for one call. */
  missingData?: MissingDataPolicy;
  enabled?: boolean;
  amount?: number;
}

export interface ExecuteMappingsOptions {
  /** Prior values are keyed by mapping id, not by target. */
  previousOutputs?: ReadonlyMap<string, number>;
  missingData?: MissingDataPolicy;
  disabledMappingIds?: ReadonlySet<string>;
  mappingAmounts?: ReadonlyMap<string, number>;
}

const executableStatuses = new Set<ControlDecisionStatus>([
  "applied",
  "held",
  "uncertainty"
]);

function baseDecision(
  mapping: SonicMapping,
  signal: ObservedSignal | undefined,
  previousOutput: number | null
): Omit<ControlDecision, "status" | "reason" | "normalizedInput" | "outputValue"> {
  return {
    mappingId: mapping.id,
    signalId: mapping.signalId,
    layer: mapping.layer,
    target: mapping.target,
    inputValue: signal?.value ?? null,
    previousOutput,
    confidence: signal?.confidence ?? null,
    smoothingMs: mapping.smoothingMs,
    epistemicNote: mapping.epistemicNote
  };
}

function decisionWithoutOutput(
  mapping: SonicMapping,
  signal: ObservedSignal | undefined,
  previousOutput: number | null,
  status: "skipped" | "refused",
  reason: ControlDecisionReason
): ControlDecision {
  return {
    ...baseDecision(mapping, signal, previousOutput),
    status,
    reason,
    normalizedInput: null,
    outputValue: null
  };
}

function orderedRange(range: readonly [number, number]): readonly [number, number] {
  return range[0] <= range[1] ? range : [range[1], range[0]];
}

function outputIsValid(value: number, range: readonly [number, number]): boolean {
  const [min, max] = orderedRange(range);
  return Number.isFinite(value) && value >= min && value <= max;
}

/**
 * Every reason one mapping cannot be executed, in the executor's own terms.
 *
 * This is the single authority for mapping validity: `mappingIsValid` is this
 * function returning nothing, and the catalog validator reports these same
 * reasons. Keeping them separate previously let a catalog entry pass its
 * validation test and then refuse on every execution.
 */
export function mappingValidationErrors(mapping: SonicMapping): string[] {
  const errors: string[] = [];
  const [outputStart, outputEnd] = mapping.outputRange;

  if (mapping.target.trim().length === 0) {
    errors.push("target is empty");
  }
  if (!Number.isFinite(outputStart) || !Number.isFinite(outputEnd)) {
    errors.push("output range is not finite");
  } else if (outputStart === outputEnd) {
    errors.push("output range is empty");
  }
  if (!Number.isFinite(mapping.smoothingMs) || mapping.smoothingMs < 0) {
    errors.push("smoothingMs must be a non-negative duration");
  }
  if (
    mapping.missingData === "map-uncertainty" &&
    (mapping.uncertaintyOutput === undefined ||
      !outputIsValid(mapping.uncertaintyOutput, mapping.outputRange))
  ) {
    errors.push("map-uncertainty needs an uncertaintyOutput inside the output range");
  }

  if (mapping.scale === "categorical") {
    const categories = mapping.categories;
    if (!categories || categories.length === 0) {
      errors.push("categorical scale needs category entries");
      return errors;
    }
    const values = new Set<number>();
    for (const category of categories) {
      if (!Number.isFinite(category.value) || !Number.isFinite(category.output)) {
        errors.push("a category entry is not finite");
      } else if (!outputIsValid(category.output, mapping.outputRange)) {
        errors.push("a category output falls outside the output range");
      } else if (values.has(category.value)) {
        errors.push("a category value is repeated");
      }
      values.add(category.value);
    }
    return errors;
  }

  if (!mapping.inputRange) {
    errors.push("a non-categorical scale needs an input range");
    return errors;
  }

  const [inputStart, inputEnd] = mapping.inputRange;
  if (!Number.isFinite(inputStart) || !Number.isFinite(inputEnd)) {
    errors.push("input range is not finite");
  } else if (inputStart >= inputEnd) {
    errors.push("input range is empty or inverted");
  } else if (mapping.scale === "log" && (inputStart <= 0 || inputEnd <= 0)) {
    errors.push("log scale needs a strictly positive input range");
  }

  if (
    mapping.scale === "quantized" &&
    (!Number.isInteger(outputStart) || !Number.isInteger(outputEnd))
  ) {
    errors.push("quantized scale needs integer output bounds");
  }

  return errors;
}

function mappingIsValid(mapping: SonicMapping): boolean {
  return mappingValidationErrors(mapping).length === 0;
}

function mapCategorical(
  mapping: SonicMapping,
  value: number,
  amount: number
): { rawNormalized: number; normalized: number; output: number } | null {
  const categories = mapping.categories ?? [];
  const index = categories.findIndex((entry) => entry.value === value);
  if (index < 0) return null;
  const category = categories[index]!;
  const rawNormalized = categories.length === 1 ? 1 : index / (categories.length - 1);
  const normalized = rawNormalized * amount;
  const output = mapping.outputRange[0] +
    (category.output - mapping.outputRange[0]) * amount;
  return { rawNormalized, normalized, output };
}

function normalizeInput(mapping: SonicMapping, value: number): number | null {
  if (!mapping.inputRange || mapping.scale === "categorical") {
    return null;
  }

  if (mapping.scale === "log") {
    return logNormalize(value, mapping.inputRange);
  }

  const linear = linearNormalize(value, mapping.inputRange);
  if (mapping.scale === "exp") {
    return Math.expm1(linear) / Math.expm1(1);
  }

  return linear;
}

function mapOutput(mapping: SonicMapping, normalized: number): number {
  const [start, end] = mapping.outputRange;
  const mapped = start + (end - start) * normalized;
  return mapping.scale === "quantized" ? Math.round(mapped) : mapped;
}

function decideMissing(
  mapping: SonicMapping,
  signal: ObservedSignal | undefined,
  previousOutput: number | null,
  policy: MissingDataPolicy,
  reason: "missing-signal" | "missing-value" | "source-error"
): ControlDecision {
  if (policy === "refuse") {
    return decisionWithoutOutput(
      mapping,
      signal,
      previousOutput,
      "refused",
      "policy-refusal"
    );
  }

  if (policy === "interpolate-explicitly") {
    // Interpolation requires two attributed observations and a declared method.
    // A previous scalar alone is not enough evidence to invent a new value.
    return decisionWithoutOutput(
      mapping,
      signal,
      previousOutput,
      "refused",
      "interpolation-history-unavailable"
    );
  }

  if (
    policy === "hold-explicitly" &&
    previousOutput !== null &&
    outputIsValid(previousOutput, mapping.outputRange)
  ) {
    return {
      ...baseDecision(mapping, signal, previousOutput),
      status: "held",
      reason,
      normalizedInput: null,
      outputValue: previousOutput
    };
  }

  if (
    policy === "hold-explicitly" &&
    previousOutput !== null &&
    !outputIsValid(previousOutput, mapping.outputRange)
  ) {
    return decisionWithoutOutput(
      mapping,
      signal,
      previousOutput,
      "refused",
      "invalid-previous-output"
    );
  }

  if (policy === "map-uncertainty" && mapping.uncertaintyOutput !== undefined) {
    // Sounding uncertainty means emitting the declared value that stands for
    // "not known", under an `uncertainty` status so it is never read as a
    // measurement. A mapping that declares this policy without such a value is
    // rejected earlier, by mappingValidationErrors, as a malformed mapping.
    return {
      ...baseDecision(mapping, signal, previousOutput),
      status: "uncertainty",
      reason,
      normalizedInput: null,
      outputValue: mapping.uncertaintyOutput
    };
  }

  return decisionWithoutOutput(
    mapping,
    signal,
    previousOutput,
    "skipped",
    reason
  );
}

/**
 * Execute one documented sonic mapping without inventing a value for absent
 * data. The decision itself is suitable for an audit trail or MASA receipt.
 */
export function executeMapping(
  mapping: SonicMapping,
  signal: ObservedSignal | undefined,
  options: ExecuteMappingOptions = {}
): ControlDecision {
  const previousOutput = options.previousOutput ?? null;
  const amount = options.amount ?? 1;

  if (!mappingIsValid(mapping)) {
    return decisionWithoutOutput(
      mapping,
      signal,
      previousOutput,
      "refused",
      "invalid-mapping"
    );
  }

  if (!Number.isFinite(amount) || amount < 0 || amount > 1) {
    return decisionWithoutOutput(
      mapping,
      signal,
      previousOutput,
      "refused",
      "invalid-mapping"
    );
  }

  // A zero amount is the operator turning this route off. Scaling the
  // normalized value instead would emit outputRange[0], which on a reversed
  // range (for example [1, 0] or [760, 180]) is the strongest value the
  // mapping can produce — the opposite of the gesture.
  if (amount === 0) {
    return decisionWithoutOutput(
      mapping,
      signal,
      previousOutput,
      "skipped",
      "route-disabled"
    );
  }

  if (options.enabled === false) {
    return decisionWithoutOutput(
      mapping,
      signal,
      previousOutput,
      "skipped",
      "route-disabled"
    );
  }

  const missingData = options.missingData ?? mapping.missingData;
  if (!signal) {
    return decideMissing(
      mapping,
      signal,
      previousOutput,
      missingData,
      "missing-signal"
    );
  }

  if (signal.confidence === "error") {
    return decideMissing(
      mapping,
      signal,
      previousOutput,
      missingData,
      "source-error"
    );
  }

  if (signal.value === null) {
    return decideMissing(
      mapping,
      signal,
      previousOutput,
      missingData,
      "missing-value"
    );
  }

  if (!Number.isFinite(signal.value)) {
    return decisionWithoutOutput(
      mapping,
      signal,
      previousOutput,
      "refused",
      "invalid-input"
    );
  }

  if (mapping.scale === "categorical") {
    const categorical = mapCategorical(mapping, signal.value, amount);
    if (categorical === null || !outputIsValid(categorical.output, mapping.outputRange)) {
      return decisionWithoutOutput(
        mapping,
        signal,
        previousOutput,
        "refused",
        "invalid-input"
      );
    }
    const uncertain = signal.confidence === "low" || signal.confidence === "stale";
    return {
      ...baseDecision(mapping, signal, previousOutput),
      status: uncertain ? "uncertainty" : "applied",
      reason:
        signal.confidence === "low"
          ? "low-confidence"
          : signal.confidence === "stale"
            ? "stale-input"
            : "mapped",
      rawNormalizedInput: categorical.rawNormalized,
      normalizedInput: categorical.normalized,
      mappingAmount: amount,
      outputValue: categorical.output
    };
  }

  const rawNormalizedInput = normalizeInput(mapping, signal.value);
  const normalizedInput = rawNormalizedInput === null
    ? null
    : rawNormalizedInput * amount;
  if (normalizedInput === null || !Number.isFinite(normalizedInput)) {
    return decisionWithoutOutput(
      mapping,
      signal,
      previousOutput,
      "refused",
      "invalid-input"
    );
  }

  const outputValue = mapOutput(mapping, normalizedInput);
  if (!outputIsValid(outputValue, mapping.outputRange)) {
    return decisionWithoutOutput(
      mapping,
      signal,
      previousOutput,
      "refused",
      "invalid-mapping"
    );
  }

  const uncertain = signal.confidence === "low" || signal.confidence === "stale";
  return {
    ...baseDecision(mapping, signal, previousOutput),
    status: uncertain ? "uncertainty" : "applied",
    reason:
      signal.confidence === "low"
        ? "low-confidence"
        : signal.confidence === "stale"
          ? "stale-input"
          : "mapped",
    rawNormalizedInput,
    normalizedInput,
    mappingAmount: amount,
    outputValue
  };
}

export function executeMappings(
  mappings: readonly SonicMapping[],
  signals: readonly ObservedSignal[],
  options: ExecuteMappingsOptions = {}
): ControlDecision[] {
  const signalsById = new Map(signals.map((signal) => [signal.id, signal]));

  return mappings.map((mapping) => {
    const previousOutput = options.previousOutputs?.get(mapping.id);
    const amount = options.mappingAmounts?.get(mapping.id);
    return executeMapping(mapping, signalsById.get(mapping.signalId), {
      ...(previousOutput === undefined ? {} : { previousOutput }),
      ...(options.missingData ? { missingData: options.missingData } : {}),
      enabled: !options.disabledMappingIds?.has(mapping.id),
      ...(amount === undefined ? {} : { amount })
    });
  });
}

export function isExecutableControlDecision(
  decision: ControlDecision
): decision is ControlDecision & {
  status: "applied" | "held" | "uncertainty";
  outputValue: number;
} {
  return (
    executableStatuses.has(decision.status) &&
    decision.outputValue !== null &&
    Number.isFinite(decision.outputValue)
  );
}

/** Create the next explicit mapping state. Skips and refusals never write. */
export function updateControlState(
  previous: ReadonlyMap<string, number>,
  decisions: readonly ControlDecision[]
): Map<string, number> {
  const next = new Map(previous);
  for (const decision of decisions) {
    if (isExecutableControlDecision(decision)) {
      next.set(decision.mappingId, decision.outputValue);
    }
  }
  return next;
}

/** Resolve the latest executable value for each target. */
export function controlFrame(
  decisions: readonly ControlDecision[]
): Map<string, number> {
  const frame = new Map<string, number>();
  for (const decision of decisions) {
    if (isExecutableControlDecision(decision)) {
      frame.set(decision.target, decision.outputValue);
    }
  }
  return frame;
}
