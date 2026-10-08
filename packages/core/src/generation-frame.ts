/** Owner-side prompt parameter intentions, never an audio or perceptual receipt. */
import { executeMapping } from "./control";
import { buildModulationFrame, type ModulationFrameInput } from "./modulation-frame";
import { mappingCatalog } from "./mappings";
import type { SonicMapping } from "./types";

export const GENERATION_FRAME_CONTRACT = "cosmo/generation-frame/v1";
export const generationMappings: readonly SonicMapping[] = [
  { ...mappingCatalog.find(m => m.id === "carbon-intensity-filter")!, id: "germ-carbon-duration", target: "duration", outputRange: [0.1, 30], smoothingMs: 0 },
  { ...mappingCatalog.find(m => m.id === "quake-resonator-density")!, id: "germ-quake-steps", target: "steps", outputRange: [1, 250], smoothingMs: 0 },
  { ...mappingCatalog.find(m => m.id === "coal-noise-gain")!, id: "germ-coal-guidance", target: "cfg_scale", outputRange: [0, 25], smoothingMs: 0 }
];

export function buildGenerationFrame(input: ModulationFrameInput) {
  // A prompt frame carries only the signals used by its declared assignments.
  // Preserve their values verbatim; unrelated catalog counters are not inputs.
  const signalIds = new Set(generationMappings.map(mapping => mapping.signalId));
  const signals = input.signals.filter(signal => signalIds.has(signal.id));
  const sourceIds = new Set(signals.map(signal => signal.sourceId));
  const source = buildModulationFrame({...input, signals, sources: input.sources.filter(health => sourceIds.has(health.sourceId))});
  const receipts = generationMappings.map(mapping => {
    const signal = input.signals.find(s => s.id === mapping.signalId);
    const decision = executeMapping(mapping, signal, {
      now: input.generatedAt, mode: input.mode,
      previousOutput: input.previousOutputs?.get(mapping.id) ?? null,
      enabled: input.routes?.[mapping.id]?.enabled ?? true,
      amount: input.routes?.[mapping.id]?.amount ?? 1
    });
    const outputValue = decision.outputValue === null ? null : mapping.target === "steps" ? Math.round(decision.outputValue) : decision.outputValue;
    return {
      ...decision, outputValue,
      receiptId: `${source.frameId}:${mapping.id}`,
      sourceClock: signal?.timestamp ?? null,
      captureClock: source.generatedAt,
      evidenceClass: signal?.epistemicStatus ?? null,
      inputRange: mapping.inputRange,
      outputRange: mapping.outputRange,
      curve: mapping.scale,
      operation: "generation.parameter.propose",
      effect: "intention-only",
      attribution: source.attribution.filter(a => a.sourceId === signal?.sourceId)
    };
  });
  return {
    contract: GENERATION_FRAME_CONTRACT,
    frameId: source.frameId, generatedAt: source.generatedAt,
    acquisitionMode: source.acquisitionMode, originMode: source.originMode ?? source.acquisitionMode,
    relation: { of: "signal" }, sourceRegister: "non-acoustic",
    signals: source.signals, receipts,
    execution: "not_requested", perceptualAccess: "not_established"
  };
}
