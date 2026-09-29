/** Rebuild owner-boundary fixtures with the real MASA and generation builders.
 * pnpm --filter @cosmoaudition/api exec tsx ../../scripts/build-freshness-fixtures.ts OUTPUT.json
 */
import { writeFileSync } from "node:fs";
import { buildGenerationFrame } from "../packages/core/src/generation-frame";
import { buildSnapshotMatterRecord } from "../packages/masa/src/snapshotRecord";
import type { ObservedSignal } from "../packages/core/src/types";
const now = "2026-09-26T12:00:00.000Z";
const cases = [];
for (const [name, mode, timestamp] of [
  ["expired", "live", "2026-07-01T00:00:00.000Z"],
  ["fresh", "live", "2026-09-26T11:59:00.000Z"],
  ["future", "live", "2026-09-26T12:01:00.000Z"],
  ["archive", "archive", "2026-09-26T11:59:00.000Z"],
  ["fixture", "fixture", "2026-07-01T00:00:00.000Z"]
] as const) {
  const signal: ObservedSignal = {id: "carbon_intensity_actual", label: "Carbon", sourceId: "carbon_intensity_gb", layer: "earth", unit: "gCO2/kWh", value: 250, normalized: .5, timestamp, staleAfterSeconds: 1800, confidence: "high", temporalCharacter: "aggregate", epistemicStatus: "reported", signalKind: "observation"};
  const snapshot = {generatedAt: now, mode, signals: [signal], sources: []};
  const record = await buildSnapshotMatterRecord(snapshot);
  cases.push({name, snapshot, record, observationRef: record.observations.find(o => o.field === signal.id)!.id, generation: buildGenerationFrame(snapshot)});
}
writeFileSync(process.argv[2]!, JSON.stringify({contract: "cosmo/freshness-fixtures/v1", evaluatedAt: now, cases}, null, 2) + "\n");
