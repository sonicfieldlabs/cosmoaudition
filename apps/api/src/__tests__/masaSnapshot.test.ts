import {
  validateSnapshotMatterRecord,
  type MatterRecord
} from "@cosmoaudition/masa";
import { describe, expect, it } from "vitest";
import { app } from "../app";

describe("MASA snapshot API", () => {
  it("exports one validated fixture record as MASA JSON", async () => {
    const response = await app.request("/api/snapshot/masa?mode=fixture");
    const record = (await response.json()) as MatterRecord;

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(
      "application/vnd.sonicfield.masa.record+json"
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(record.type).toBe("masa:MatterRecord");
    expect(record.extensions["cosmo:snapshot"]).toMatchObject({
      mode: "fixture",
      recordCardinality: "one-record-per-snapshot"
    });
    expect(validateSnapshotMatterRecord(record).valid).toBe(true);
  });

  it("keeps the default snapshot contract stable and adds MASA only on request", async () => {
    const plainResponse = await app.request("/api/snapshot?mode=fixture");
    const plain = (await plainResponse.json()) as Record<string, unknown>;
    const summaryResponse = await app.request(
      "/api/snapshot?mode=fixture&masa=summary"
    );
    const summary = (await summaryResponse.json()) as {
      signals: unknown[];
      masa: {
        masaVersion: string;
        recordId: string;
        valid: boolean;
        mediaType: string;
        href: string;
      };
    };

    expect(plainResponse.status).toBe(200);
    expect(plain).not.toHaveProperty("masa");
    expect(summaryResponse.status).toBe(200);
    expect(summary.signals.length).toBeGreaterThan(0);
    expect(summary.masa).toMatchObject({
      masaVersion: "0.2.0",
      valid: true,
      mediaType: "application/vnd.sonicfield.masa.record+json",
      href: "/api/snapshot/masa?mode=fixture"
    });
    expect(summary.masa.recordId).toMatch(/^urn:cosmoaudition:masa:record:/);
  });
});
