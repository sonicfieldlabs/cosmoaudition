import { describe, expect, it } from "vitest";
import {
  importLocalObservation,
  type LocalObservation,
} from "./local-observation";

const packet: LocalObservation = {
  contract: "cosmo/local-observation/v1",
  sourceId: "fixture:forecast",
  kind: "grib-forecast",
  sourceSha256: "a".repeat(64),
  accountRef: null,
  attribution: "Generated fixture",
  license: "Fixture only",
  rightsRef: "fixture:rights",
  coverage: "One generated point",
  issuedAt: "2026-10-08T00:00:00Z",
  fetchedAt: "2026-10-08T00:00:10Z",
  ttlSeconds: 60,
  points: [
    {
      id: "temperature",
      unit: "K",
      validAt: "2026-10-09T00:00:00Z",
      value: 280,
    },
  ],
};

describe("local observation boundary", () => {
  it("keeps forecast, caller provenance and absence separate", () => {
    const result = importLocalObservation(packet, "2026-10-08T00:00:20Z");
    expect(result.signals[0]).toMatchObject({
      value: 280,
      normalized: null,
      temporalCharacter: "forecast",
      acquisitionMode: "local-import",
    });
    expect(result.provenance.independentVerification).toBe(false);
    expect(
      importLocalObservation(packet, "2026-10-08T00:02:00Z").signals[0],
    ).toMatchObject({ value: null, confidence: "stale" });
    expect(packet.points[0]!.value).toBe(280);
    expect(
      importLocalObservation(
        { ...packet, points: [{ ...packet.points[0], value: null }] },
        "2026-10-08T00:00:20Z",
      ).signals[0]!.value,
    ).toBeNull();
  });
  it.each([
    { ttlSeconds: 0 },
    { license: "" },
    { sourceSha256: "x" },
    { accountRef: "https://secret.example/token" },
    { fetchedAt: "2026-10-09T00:00:00Z" },
    { issuedAt: "2026-10-08" },
    { kind: "account-report", accountRef: null },
    { points: [{ ...packet.points[0], value: NaN }] },
    { points: [packet.points[0], packet.points[0]] },
    { authorization: "secret" },
  ])("refuses invalid imported evidence %j", (change) => {
    expect(() =>
      importLocalObservation({ ...packet, ...change }, "2026-10-08T00:00:20Z"),
    ).toThrow();
  });
});
