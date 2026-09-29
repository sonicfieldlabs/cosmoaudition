import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateSnapshotMatterRecord } from "./snapshotRecord";
const cases = JSON.parse(readFileSync(new URL("../../../tests/fixtures/masa-lineage-cases.json", import.meta.url), "utf8")) as Array<{
  name: string; valid: boolean; codes: string[]; record: unknown;
}>;
describe("canonical MASA lineage matrix through the Cosmo boundary", () => {
  for (const scenario of cases) {
    it(scenario.name, () => {
      const result = validateSnapshotMatterRecord(scenario.record);
      expect(result.valid, JSON.stringify(result.diagnostics)).toBe(scenario.valid);
      for (const code of scenario.codes) expect(result.diagnostics.map(d => d.code)).toContain(code);
    });
  }
});
