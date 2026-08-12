import { describe, expect, it } from "vitest";
import {
  assertSignalCatalog,
  buildSignalCatalog,
  getSignalDefinition,
  normalizeSignalValue,
  SIGNAL_CATALOG_CONTRACT,
  SIGNAL_CATALOG_VERSION,
  signalDefinitions
} from "../signal-catalog";
import { mappingCatalog } from "../mappings";

describe("signal catalog", () => {
  it("has unique, valid definitions and an explicit versioned contract", () => {
    expect(() => assertSignalCatalog()).not.toThrow();
    const catalog = buildSignalCatalog();
    expect(catalog.contract).toBe(SIGNAL_CATALOG_CONTRACT);
    expect(catalog.version).toBe(SIGNAL_CATALOG_VERSION);
    expect(catalog.signals).toHaveLength(signalDefinitions.length);
    expect(new Set(catalog.signals.map((signal) => signal.id)).size).toBe(
      catalog.signals.length
    );
  });

  it("normalizes through declared envelopes without converting null to data", () => {
    const pm25 = getSignalDefinition("air_quality_pm2_5")!;
    const distance = getSignalDefinition("closest_approach_distance_au")!;
    expect(normalizeSignalValue(null, pm25.normalization)).toBeNull();
    expect(normalizeSignalValue(37.5, pm25.normalization)).toBe(0.5);
    expect(normalizeSignalValue(0.0001, distance.normalization)).toBe(0);
    expect(normalizeSignalValue(0.2, distance.normalization)).toBe(1);
  });

  it("describes the new atmospheric, hydrospheric, and Earth-event sources", () => {
    expect(getSignalDefinition("air_quality_us_aqi")?.sphere).toBe("atmosphere");
    expect(getSignalDefinition("marine_wave_height")?.sphere).toBe("hydrosphere");
    expect(getSignalDefinition("eonet_open_event_count_bounded")).toMatchObject({
      sphere: "geosphere",
      epistemicStatus: "derived",
      temporalCharacter: "aggregate",
      signalKind: "derived"
    });
  });

  it("keeps stale-source normalization aligned with its mapping", () => {
    const definition = getSignalDefinition("source_stale_count")!;
    const mapping = mappingCatalog.find(
      (candidate) => candidate.signalId === "source_stale_count"
    );
    expect(mapping?.inputRange).toEqual(definition.normalization.inputRange);
  });
});
