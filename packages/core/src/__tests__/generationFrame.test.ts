import { describe, it, expect } from "vitest";
import { buildGenerationFrame, generationMappings } from "../generation-frame";
import { executeMapping } from "../control";
import type { ObservedSignal } from "../types";

const signal: ObservedSignal = {
 id: "carbon_intensity_actual", label: "Fixture carbon", layer: "earth", sourceId: "carbon_intensity_gb",
 unit: "gCO2/kWh", value: 250, normalized: .5, timestamp: "2026-09-01T00:00:00Z",
 confidence: "high", staleAfterSeconds: 1800
};
describe("generation frame", () => {
 it("reuses the mapping decision and retains original clocks and evidence", () => {
  const frame = buildGenerationFrame({mode:"fixture", generatedAt:"2026-09-07T00:00:00Z", signals:[signal, {...signal, id:"unrelated-counter", value:1e22}], sources:[]});
  const receipt = frame.receipts[0]!;
  expect(receipt.outputValue).toBe(executeMapping(generationMappings[0]!, signal, { mode: "fixture" }).outputValue);
  expect(receipt.sourceClock).toBe(signal.timestamp);
  expect(frame.signals.map(s => s.id)).toEqual([signal.id]);
  expect(frame.originMode).toBe("fixture");
  expect(frame.execution).toBe("not_requested");
  expect(frame.relation.of).toBe("signal");
 });
 it("retains held, skipped and refused decisions without inventing observations", () => {
  const frame = buildGenerationFrame({mode:"fixture",generatedAt:"2026-09-07T00:00:00Z",signals:[],sources:[],previousOutputs:new Map([["germ-carbon-duration",4]]),routes:{"germ-coal-guidance":{enabled:true,amount:-1}}});
  expect(frame.receipts[0]!.status).toBe("held");
  expect(frame.receipts[0]!.sourceClock).toBeNull();
  expect(frame.receipts[1]!.outputValue).toBeNull();
  expect(frame.receipts[2]!.status).toBe("refused");
 });
});
