import type { MatterRecord } from "@sonicfield/masa";
import { describe, expect, it } from "vitest";
import {
  buildSnapshotMatterRecord,
  evaluateMappingDecision,
  validateSnapshotMatterRecord,
  type SnapshotLike
} from "../snapshotRecord";
import { mappingCatalog, type ObservedSignal } from "@cosmoaudition/core";

const generatedAt = "2026-07-28T12:00:00.000Z";

function signal(
  overrides: Partial<ObservedSignal> & Pick<ObservedSignal, "id" | "sourceId">
): ObservedSignal {
  const { id, sourceId, ...values } = overrides;
  return {
    id,
    sourceId,
    label: id,
    layer: "earth",
    unit: "count",
    value: 5,
    normalized: 0.5,
    timestamp: generatedAt,
    confidence: "low",
    staleAfterSeconds: 300,
    ...values
  };
}

function fixtureSnapshot(): SnapshotLike {
  return {
    generatedAt,
    mode: "fixture",
    coordinates: { latitude: 4.711, longitude: -74.0721 },
    sources: [
      {
        sourceId: "usgs_earthquakes",
        status: "ready",
        confidence: "low",
        fetchedAt: generatedAt,
        staleAfterSeconds: 300
      },
      {
        sourceId: "open_meteo_local",
        status: "ready",
        confidence: "low",
        fetchedAt: generatedAt,
        staleAfterSeconds: 600
      },
      {
        sourceId: "mempool_stats",
        status: "ready",
        confidence: "stale",
        fetchedAt: "2026-07-27T12:00:00.000Z",
        staleAfterSeconds: 60
      },
      {
        sourceId: "carbon_intensity_gb",
        status: "ready",
        confidence: "error",
        fetchedAt: null,
        staleAfterSeconds: 1800,
        error: "Fixture source intentionally has no signals."
      }
    ],
    cache: [],
    signals: [
      signal({
        id: "earthquake_count_1h",
        sourceId: "usgs_earthquakes",
        value: 6,
        normalized: 0.2
      }),
      signal({
        id: "local_temperature_2m",
        sourceId: "open_meteo_local",
        value: null,
        normalized: null,
        unit: "degC"
      }),
      signal({
        id: "bitcoin_mempool_vsize",
        sourceId: "mempool_stats",
        value: 80_000_000,
        normalized: 0.7,
        unit: "vbytes",
        confidence: "stale",
        timestamp: "2026-07-27T12:00:00.000Z"
      })
    ]
  };
}

describe("COSMOAUDITION MASA snapshot adapter", () => {
  it("builds one valid fixture-attributed record with the complete mapping chain", async () => {
    const record = await buildSnapshotMatterRecord(fixtureSnapshot());
    const validation = validateSnapshotMatterRecord(record);

    expect(validation.valid).toBe(true);
    expect(record.type).toBe("masa:MatterRecord");
    expect(record.profiles).toEqual(["core", "mapping"]);
    expect(record.agentRuns).toEqual([]);
    expect(record.extensions["cosmo:snapshot"]).toMatchObject({
      mode: "fixture",
      recordCardinality: "one-record-per-snapshot"
    });
    expect(record.sources).toHaveLength(4);
    expect(record.sources.every((source) => source.sourceKind === "local-fixture")).toBe(
      true
    );
    expect(
      record.sources.every(
        (source) =>
          (source.identification as { state: string; value: { fixture: boolean } })
            .value.fixture
      )
    ).toBe(true);

    const canonical = record.representations.find(
      (representation) =>
        representation.extensions["cosmo:canonicalPayload"] !== undefined
    );
    expect(
      record.sources.some(
        (source) =>
          source.health.status === "error" && source.freshness.status === "unknown"
      )
    ).toBe(true);
    const appliedReceipt = embeddedEvents(record).find(
      (event) =>
        event.effectClass === "map" && event.finalStatus === "completed"
    );
    const control = record.representations.find(
      (representation) =>
        representation.extensions["cosmo:controlFrame"] !== undefined
    );

    expect(canonical?.integrity.state).toBe("known");
    expect(appliedReceipt?.outputs).toHaveLength(1);
    expect(control?.extensions["cosmo:controlFrame"]).toMatchObject({
      scheduledOnly: true,
      completionSemantics: "scheduled-not-heard"
    });
    expect(embeddedEvents(record).map((event) => event.effectClass)).toEqual(
      [...embeddedEvents(record).map((event) => event.effectClass)].sort((left, right) => eventRank(left) - eventRank(right))
    );
    expect(
      record.relations.some(
        (relation) =>
          relation.predicate === "masa:mapped-from" &&
          relation.subject === control?.id
      )
    ).toBe(true);
  });

  it("has full local reference closure and reports a deliberately broken reference", async () => {
    const record = await buildSnapshotMatterRecord(fixtureSnapshot());
    expect(
      validateSnapshotMatterRecord(record).diagnostics.filter(
        (diagnostic) => diagnostic.code === "MASA_UNRESOLVED_REF"
      )
    ).toEqual([]);

    const broken = structuredClone(record);
    const removed = broken.observations.shift();
    expect(removed).toBeDefined();
    const validation = validateSnapshotMatterRecord(broken);

    expect(validation.valid).toBe(false);
    expect(
      validation.diagnostics.some(
        (diagnostic) => diagnostic.code === "MASA_UNRESOLVED_REF"
      )
    ).toBe(true);
  });

  it("makes missing, held, and stale-uncertainty decisions explicit", async () => {
    const snapshot = fixtureSnapshot();
    const quakeMapping = mappingCatalog.find(
      (mapping) => mapping.signalId === "earthquake_count_1h"
    );
    const weatherMapping = mappingCatalog.find(
      (mapping) => mapping.signalId === "local_temperature_2m"
    );
    const mempoolMapping = mappingCatalog.find(
      (mapping) => mapping.signalId === "bitcoin_mempool_vsize"
    );
    expect(quakeMapping).toBeDefined();
    expect(weatherMapping).toBeDefined();
    expect(mempoolMapping).toBeDefined();

    const uncertainFixture = evaluateMappingDecision(
      snapshot.signals[0]!,
      quakeMapping!
    );
    const missing = evaluateMappingDecision(snapshot.signals[1]!, weatherMapping!);
    const stale = evaluateMappingDecision(snapshot.signals[2]!, mempoolMapping!);
    const held = evaluateMappingDecision(
      snapshot.signals[1]!,
      weatherMapping!,
      1800
    );

    expect(uncertainFixture).toMatchObject({
      status: "uncertainty",
      reason: "low-confidence",
      outputValue: 2
    });
    expect(missing).toEqual(
      expect.objectContaining({
        status: "skipped",
        reason: "missing-value",
        outputValue: null
      })
    );
    expect(stale).toEqual(
      expect.objectContaining({
        status: "uncertainty",
        reason: "stale-input",
        confidence: "stale"
      })
    );
    expect(stale.outputValue).toBeTypeOf("number");
    expect(held).toMatchObject({
      status: "held",
      reason: "missing-value",
      outputValue: 1800,
      previousOutput: 1800
    });

    const record = await buildSnapshotMatterRecord(snapshot);
    const skipped = embeddedEvents(record).filter(
      (event) =>
        event.effectClass === "map" && event.finalStatus === "not_performed"
    );
    expect(skipped).toHaveLength(1);
    expect(skipped.every((event) => event.outputs.length === 0)).toBe(true);
    expect(skipped[0]?.parameters).toMatchObject({
      decision: "skipped",
      reason: "missing-value",
      missingData: "hold-explicitly"
    });

    const staleControl = record.representations.find((representation) => {
      const frame = representation.extensions["cosmo:controlFrame"] as
        | Record<string, unknown>
        | undefined;
      return frame?.decisionReason === "stale-input";
    });
    expect(staleControl?.extensions["cosmo:controlFrame"]).toMatchObject({
      decisionStatus: "uncertainty",
      decisionReason: "stale-input",
      confidence: "stale",
      scheduledOnly: true,
      completionSemantics: "scheduled-not-heard"
    });
    expect(
      record.observations.some(
        (observation) =>
          observation.freshness.status === "stale" &&
          observation.extensions["cosmo:controlDecision"] !== undefined
      )
    ).toBe(true);
  });

  it("keeps future forecast validity separate from MASA observation time", async () => {
    const snapshot: SnapshotLike = {
      generatedAt,
      mode: "fixture",
      sources: [],
      cache: [],
      signals: [
        signal({
          id: "closest_approach_velocity_km_s",
          sourceId: "nasa_jpl_close_approaches",
          value: 18.75,
          normalized: 0.375,
          unit: "km/s",
          timestamp: "2026-07-30T06:00:00.000Z",
          temporalCharacter: "forecast",
          epistemicStatus: "reported"
        })
      ]
    };

    const record = await buildSnapshotMatterRecord(snapshot);
    const raw = record.observations.find(
      (observation) => observation.field === "closest_approach_velocity_km_s"
    );
    const temporalDiagnostics = validateSnapshotMatterRecord(record).diagnostics.filter(
      (diagnostic) => diagnostic.code === "MASA_TEMPORAL_ORDER"
    );

    expect(temporalDiagnostics).toEqual([]);
    expect(raw?.observedAt).toBe(generatedAt);
    expect(raw?.freshness).toMatchObject({
      observedAt: generatedAt,
      retrievedAt: generatedAt,
      ageSeconds: 0
    });
    expect(raw?.extensions).toMatchObject({
      "cosmo:sourceTimestamp": "2026-07-30T06:00:00.000Z",
      "cosmo:sourceTimestampRole": "forecast-valid-at",
      "cosmo:timestampDecision":
        "used-snapshot-generatedAt-as-observedAt-because-source-timestamp-is-a-future-validity-or-event-time"
    });
  });

  it("keeps fixture attribution when an archived fixture observation is replayed", async () => {
    const replayed: SnapshotLike = {
      ...fixtureSnapshot(),
      mode: "archive",
      originMode: "fixture"
    };
    const record = await buildSnapshotMatterRecord(replayed);
    expect(validateSnapshotMatterRecord(record).valid).toBe(true);

    const sources = record.sources as unknown as Array<Record<string, unknown>>;
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source.sourceKind).not.toBe("public-api");
      const extensions = source.extensions as Record<string, { fixture?: boolean }>;
      expect(extensions["cosmo:source"]?.fixture).toBe(true);
    }
    expect(
      embeddedEvents(record).some((event) =>
        (event.warnings as string[]).some((warning) => warning.includes("local fixture"))
      )
    ).toBe(true);
  });

  it("does not report a source with no evidence as healthy", async () => {
    const withoutSignals: SnapshotLike = {
      ...fixtureSnapshot(),
      cache: [
        {
          sourceId: "ghost_source",
          cacheKey: "cache:ghost_source:default",
          hit: true,
          fetchedAt: generatedAt,
          expiresAt: generatedAt,
          staleAt: generatedAt,
          ageSeconds: 0
        }
      ]
    };
    const record = await buildSnapshotMatterRecord(withoutSignals);
    const sources = record.sources as unknown as Array<Record<string, unknown>>;
    const ghost = sources.find((source) => {
      const identification = source.identification as { value?: { sourceId?: string } };
      return identification.value?.sourceId === "ghost_source";
    });

    expect(ghost).toBeDefined();
    expect((ghost?.health as { status: string }).status).not.toBe("healthy");
  });

  it("does not mislabel an equivalent explicit offset as a fallback timestamp", async () => {
    const snapshot: SnapshotLike = {
      generatedAt,
      mode: "fixture",
      sources: [],
      cache: [],
      signals: [
        signal({
          id: "earthquake_count_1h",
          sourceId: "usgs_earthquakes",
          timestamp: "2026-07-28T07:00:00-05:00"
        })
      ]
    };

    const record = await buildSnapshotMatterRecord(snapshot);
    const observation = record.observations.find(
      (candidate) => candidate.field === "earthquake_count_1h"
    );

    expect(observation?.observedAt).toBe(generatedAt);
    expect(observation?.extensions).not.toHaveProperty("cosmo:sourceTimestamp");
    expect(observation?.extensions).not.toHaveProperty("cosmo:timestampDecision");
  });
});

function embeddedEvents(record: MatterRecord) {
  if (record.history.mode !== "embedded") {
    throw new Error("Fixture record must use embedded history.");
  }
  return record.history.events;
}

function eventRank(effectClass: string): number {
  if (effectClass === "read") return 0;
  if (effectClass === "derive") return 1;
  if (effectClass === "map") return 2;
  return 3;
}
