/**
 * The Cosmoaudition System modulation contract, `cosmo/modulation/v0.2`.
 *
 * A ModulationFrame is what every transport carries — HTTP poll, SSE, OSC, MCP.
 * It is a projection of the same objects the instrument uses internally, so a
 * consuming project receives the authored relation rather than a bare number.
 *
 * Three rules hold across every transport:
 *
 * 1. A number never travels without its status. `controlFrame()` reduces
 *    decisions to a target/number map; that reduction is offered here only as
 *    an explicitly labelled convenience beside the decisions themselves.
 * 2. Absence is emitted, not implied. A skipped, refused, or unexecutable
 *    target appears in `absences` with its reason, so a consumer can react to
 *    missing evidence instead of inferring it from a key that failed to appear.
 * 3. Attribution travels with the signal, so a downstream work can credit and
 *    caveat its sources without reading this repository.
 */

import { evaluateSignalFreshness } from "./freshness";
import {
  executeMappings,
  isExecutableControlDecision,
  type ControlDecision
} from "./control";
import { mappingCatalog } from "./mappings";
import {
  getSignalDefinition,
  SIGNAL_CATALOG_CONTRACT,
  SIGNAL_CATALOG_VERSION
} from "./signal-catalog";
import { getSourceDefinition } from "./sources";
import type {
  CacheMetadata,
  ObservedSignal,
  SonicMapping,
  SourceHealth,
  StackLayer
} from "./types";

export const MODULATION_CONTRACT = "cosmo/modulation/v0.2";

export interface ModulationSignalView {
  id: string;
  label: string;
  layer: StackLayer;
  unit: string;
  /** The provider value in its declared unit, or null when not established. */
  value: number | null;
  /** 0..1 where the source declares a range, else null. Never a substitute. */
  normalized: number | null;
  timestamp: string;
  sourceId: string;
  confidence: ObservedSignal["confidence"];
  staleAfterSeconds: number;
  acquisitionMode: string;
  observedInterval?: ObservedSignal["observedInterval"];
  freshness: import("./freshness").SignalFreshness;
  sphere: NonNullable<ObservedSignal["sphere"]>;
  epistemicStatus: NonNullable<ObservedSignal["epistemicStatus"]>;
  temporalCharacter: NonNullable<ObservedSignal["temporalCharacter"]>;
  signalKind: NonNullable<ObservedSignal["signalKind"]>;
  normalization: NonNullable<ObservedSignal["normalization"]>;
  /** Present only for authored local generator signals. */
  generator?: ObservedSignal["generator"];
  error?: string;
}

export interface ModulationControlView {
  mappingId: string;
  signalId: string;
  target: string;
  layer: StackLayer;
  status: ControlDecision["status"];
  reason: ControlDecision["reason"];
  inputValue: number | null;
  normalizedInput: number | null;
  rawNormalizedInput: number | null;
  mappingAmount: number;
  outputValue: number | null;
  outputRange: readonly [number, number];
  curve: SonicMapping["scale"];
  smoothingMs: number;
  missingData: SonicMapping["missingData"];
  confidence: ControlDecision["confidence"];
  epistemicNote: string;
}

export interface ModulationAbsence {
  mappingId: string;
  target: string;
  status: ControlDecision["status"];
  reason: ControlDecision["reason"];
  /** Why no value is offered, in the mapping's own terms. */
  epistemicNote: string;
}

export interface ModulationAttribution {
  sourceId: string;
  label: string;
  provider: string | null;
  licenseNote: string;
  limitation: string;
  /**
   * The mode the values were *acquired* in, which for a replay is the original
   * acquisition rather than the replay itself. Named distinctly from the
   * frame's own `acquisitionMode` so one field name cannot mean two things.
   */
  originalAcquisitionMode: string;
}

export interface ModulationFrame {
  contract: typeof MODULATION_CONTRACT;
  frameId: string;
  generatedAt: string;
  /** How the underlying observation was acquired: live, fixture, or archive. */
  acquisitionMode: string;
  /** The mode the observation was originally acquired in, when replayed. */
  originMode?: string;
  signalCatalog: {
    contract: typeof SIGNAL_CATALOG_CONTRACT;
    version: typeof SIGNAL_CATALOG_VERSION;
    href: string;
  };
  signals: ModulationSignalView[];
  controls: ModulationControlView[];
  absences: ModulationAbsence[];
  attribution: ModulationAttribution[];
  sources: SourceHealth[];
  /** Bare target/value pairs for transports that carry only numbers. Using
   * this without the matching control status discards the frame's evidence. */
  values: Record<string, number>;
  /** Where the full MASA account of this moment can be retrieved. */
  masaRecordHref?: string;
}

export interface ModulationFrameInput {
  generatedAt: string;
  mode: string;
  originMode?: string;
  signals: readonly ObservedSignal[];
  sources: readonly SourceHealth[];
  cache?: readonly CacheMetadata[];
  /** Operator route settings, matching the instrument's own controls. */
  routes?: Readonly<Record<string, { enabled: boolean; amount: number }>>;
  /** Previous outputs so `hold-explicitly` policies can actually hold. */
  previousOutputs?: ReadonlyMap<string, number>;
  masaRecordHref?: string;
  frameId?: string;
  signalCatalogHref?: string;
}

function signalView(signal: ObservedSignal, input: ModulationFrameInput): ModulationSignalView {
  const definition = getSignalDefinition(signal.id, signal.sourceId);
  if (definition === undefined || definition.sourceId !== signal.sourceId) {
    throw new Error(`Modulation signal is absent from the catalog: ${signal.id}`);
  }
  return {
    id: signal.id,
    label: signal.label,
    layer: signal.layer,
    unit: signal.unit,
    value: signal.value,
    normalized: signal.normalized,
    timestamp: signal.timestamp,
    ...(signal.observedInterval ? { observedInterval: signal.observedInterval } : {}),
    sourceId: signal.sourceId,
    confidence: signal.confidence,
    staleAfterSeconds: signal.staleAfterSeconds,
    acquisitionMode: input.mode,
    freshness: evaluateSignalFreshness(signal, { now: input.generatedAt, mode: input.mode }),
    sphere: definition.sphere,
    epistemicStatus: definition.epistemicStatus,
    temporalCharacter: definition.temporalCharacter,
    signalKind: definition.signalKind,
    normalization: definition.normalization,
    ...(signal.generator === undefined ? {} : { generator: signal.generator }),
    ...(signal.error === undefined ? {} : { error: signal.error })
  };
}

function controlView(
  decision: ControlDecision,
  mapping: SonicMapping
): ModulationControlView {
  return {
    mappingId: decision.mappingId,
    signalId: decision.signalId,
    target: decision.target,
    layer: decision.layer,
    status: decision.status,
    reason: decision.reason,
    inputValue: decision.inputValue,
    normalizedInput: decision.normalizedInput,
    rawNormalizedInput: decision.rawNormalizedInput ?? decision.normalizedInput,
    mappingAmount: decision.mappingAmount ?? 1,
    outputValue: decision.outputValue,
    outputRange: mapping.outputRange,
    curve: mapping.scale,
    smoothingMs: decision.smoothingMs,
    missingData: mapping.missingData,
    confidence: decision.confidence,
    epistemicNote: decision.epistemicNote
  };
}

function attributionFor(
  sourceIds: readonly string[],
  originalAcquisitionMode: string
): ModulationAttribution[] {
  return sourceIds
    .map((sourceId) => {
      const definition = getSourceDefinition(sourceId);
      if (definition === undefined) return null;
      return {
        sourceId,
        label: definition.label,
        provider: definition.endpoint ?? definition.endpointPattern ?? null,
        licenseNote: definition.licenseNote,
        limitation: definition.limitation,
        originalAcquisitionMode
      };
    })
    .filter((entry): entry is ModulationAttribution => entry !== null)
    .sort((left, right) => (left.sourceId < right.sourceId ? -1 : 1));
}

/**
 * Build one frame from an accepted observation. Pure: the caller owns
 * acquisition, cadence, and any previous-output state.
 */
export function buildModulationFrame(
  input: ModulationFrameInput
): ModulationFrame {
  const disabledMappingIds = new Set<string>();
  const mappingAmounts = new Map<string, number>();
  for (const [mappingId, route] of Object.entries(input.routes ?? {})) {
    if (!route.enabled) disabledMappingIds.add(mappingId);
    if (Number.isFinite(route.amount)) mappingAmounts.set(mappingId, route.amount);
  }

  const decisions = executeMappings(mappingCatalog, input.signals, {
    now: input.generatedAt,
    mode: input.mode,
    disabledMappingIds,
    mappingAmounts,
    ...(input.previousOutputs === undefined
      ? {}
      : { previousOutputs: input.previousOutputs })
  });
  const mappingsById = new Map(mappingCatalog.map((mapping) => [mapping.id, mapping]));

  const controls: ModulationControlView[] = [];
  const absences: ModulationAbsence[] = [];
  const values: Record<string, number> = {};

  for (const decision of decisions) {
    const mapping = mappingsById.get(decision.mappingId);
    if (mapping === undefined) continue;
    controls.push(controlView(decision, mapping));
    if (isExecutableControlDecision(decision)) {
      values[decision.target] = decision.outputValue;
    } else {
      absences.push({
        mappingId: decision.mappingId,
        target: decision.target,
        status: decision.status,
        reason: decision.reason,
        epistemicNote: decision.epistemicNote
      });
    }
  }

  const contributingSourceIds = [
    ...new Set(input.signals.map((signal) => signal.sourceId))
  ];
  const originalAcquisitionMode = input.originMode ?? input.mode;

  return {
    contract: MODULATION_CONTRACT,
    frameId: input.frameId ?? `cosmo:frame:${input.generatedAt}`,
    generatedAt: input.generatedAt,
    acquisitionMode: input.mode,
    ...(input.originMode === undefined ? {} : { originMode: input.originMode }),
    signalCatalog: {
      contract: SIGNAL_CATALOG_CONTRACT,
      version: SIGNAL_CATALOG_VERSION,
      href: input.signalCatalogHref ?? "/api/signals"
    },
    signals: input.signals.map(signal => signalView(signal, input)),
    controls,
    absences,
    attribution: attributionFor(contributingSourceIds, originalAcquisitionMode),
    sources: [...input.sources],
    values,
    ...(input.masaRecordHref === undefined
      ? {}
      : { masaRecordHref: input.masaRecordHref })
  };
}
