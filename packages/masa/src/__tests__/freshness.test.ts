import { describe, expect, it } from "vitest";
import { buildGenerationFrame, buildModulationFrame, evaluateSignalFreshness, executeMapping, generationMappings, type ObservedSignal } from "@cosmoaudition/core";
import { buildSnapshotMatterRecord } from "../snapshotRecord";
const now = "2026-09-26T12:00:00.000Z";
function carbon(timestamp: string): ObservedSignal {
  return { id: "carbon_intensity_actual", label: "Carbon", layer: "earth", sourceId: "carbon_intensity_gb", unit: "gCO2/kWh", value: 250, normalized: .5, timestamp, confidence: "high", staleAfterSeconds: 1800, temporalCharacter: "aggregate", epistemicStatus: "reported", signalKind: "observation" };
}
export function freshnessCases() {
  return [
    { name: "expired", mode: "live", timestamp: "2026-07-01T00:00:00.000Z", status: "expired", allowed: false },
    { name: "fresh", mode: "live", timestamp: "2026-09-26T11:59:00.000Z", status: "current", allowed: true },
    { name: "expiry-boundary", mode: "live", timestamp: "2026-09-26T11:30:00.000Z", status: "expired", allowed: false },
    { name: "future", mode: "live", timestamp: "2026-09-26T12:01:00.000Z", status: "unknown", allowed: false },
    { name: "fixture", mode: "fixture", timestamp: "2026-07-01T00:00:00.000Z", status: "unknown", allowed: true },
    { name: "archive", mode: "archive", timestamp: "2026-09-26T11:59:00.000Z", status: "unknown", allowed: false }
  ];
}
describe("freshness across exported observations and mapping frames", () => {
  it.each(freshnessCases())("$name preserves clocks and enforces admission", async entry => {
    const signal = carbon(entry.timestamp);
    const snapshot = { generatedAt: now, mode: entry.mode, originMode: "live", signals: [signal], sources: [{ sourceId: signal.sourceId, status: "ready" as const, confidence: "high" as const, fetchedAt: now, staleAfterSeconds: 1800 }] };
    const before = structuredClone(snapshot);
    const record = await buildSnapshotMatterRecord(snapshot);
    const observation = record.observations.find(o => o.field === signal.id)!;
    expect(observation.observedAt).toBe(entry.timestamp);
    expect(observation.health.status).toBe("healthy");
    expect(observation.freshness.status).toBe(entry.status);
    const generation = buildGenerationFrame(snapshot);
    expect(generation.receipts[0]!.outputValue !== null).toBe(entry.allowed);
    expect(generation.receipts[0]!.sourceClock).toBe(entry.timestamp);
    expect(generation.signals[0]!.freshness.mappingAllowed).toBe(entry.allowed);
    const modulation = buildModulationFrame(snapshot);
    expect(modulation.controls.find(c => c.signalId === signal.id)!.outputValue !== null).toBe(entry.allowed);
    expect(snapshot).toEqual(before);
  });
  it("does not honor forged producer freshness or turn expiry into a held/uncertainty number", () => {
    const signal = carbon("2026-07-01T00:00:00.000Z");
    signal.freshness = evaluateSignalFreshness(carbon(now), {now});
    for (const missingData of ["hold-explicitly", "map-uncertainty", "skip"] as const) {
      const decision = executeMapping({...generationMappings[0]!, missingData, uncertaintyOutput: 5}, signal, {now, previousOutput: 4});
      expect(decision).toMatchObject({ status: "refused", outputValue: null, reason: "stale-input" });
    }
  });
  it.each(["2026-09-26T12:00:00", "garbage"])("refuses ambiguous source clock %s", timestamp => {
    expect(evaluateSignalFreshness(carbon(timestamp), {now}).mappingAllowed).toBe(false);
  });
  it("keeps forecast validity in the future and refuses source-declared stale fixture values", async () => {
    const signal = {...carbon("2026-09-26T13:00:00.000Z"), temporalCharacter: "forecast" as const};
    expect(evaluateSignalFreshness(signal, {now})).toMatchObject({reason: "future-source-time", mappingAllowed: false});
    expect(evaluateSignalFreshness({...signal, confidence: "stale"}, {now, mode: "fixture"})).toMatchObject({status: "stale", mappingAllowed: false});
  });
});
