import {
  executeMapping,
  getSourceDefinition,
  isExecutableControlDecision,
  mappingCatalog,
  parseAbsoluteTime,
  type CacheMetadata,
  type ControlDecision,
  type ObservedSignal,
  type SonicMapping,
  type SourceHealth
} from "@cosmoaudition/core";
import {
  stableStringify,
  type Diagnostic,
  type MatterRecord,
  type ValidationResult
} from "@sonicfield/masa";
import { validateMatterRecord } from "@sonicfield/masa-validator";

export const MASA_RECORD_MEDIA_TYPE =
  "application/vnd.sonicfield.masa.record+json";
export const MAX_MASA_SNAPSHOT_SIGNALS = 256;
export const MAX_MASA_SNAPSHOT_SOURCES = 64;

const SCHEMA_URI =
  "https://masa.sonicfield.org/schemas/0.1.0/matter-record.schema.json";
const CONTEXT_URI =
  "https://masa.sonicfield.org/contexts/0.1.0/masa.jsonld";
const ADAPTER_VERSION = "0.1.1";

export interface SnapshotLike {
  generatedAt: string;
  mode: string;
  /**
   * The acquisition mode the snapshot was originally taken in, carried when the
   * current `mode` describes a replay rather than an acquisition. A replayed
   * fixture must stay attributed to its fixture, never to a live provider.
   */
  originMode?: string;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  signals: readonly ObservedSignal[];
  sources: readonly SourceHealth[];
  cache?: readonly CacheMetadata[];
  mappingRoutes?: Readonly<
    Record<string, { enabled: boolean; amount: number }>
  >;
  /**
   * The last bounded control value per mapping id, so a `hold-explicitly`
   * policy can actually hold in the record. Without it every such mapping
   * degrades to `skipped`, and the account understates what the instrument
   * emitted. A held value is not a new observation: it is recorded with its
   * own status and an explicit warning.
   */
  previousOutputs?: Readonly<Record<string, number>>;
}

export interface MasaSnapshotSummary {
  masaVersion: "0.1.0";
  recordId: string;
  profiles: MatterRecord["profiles"];
  valid: true;
  mediaType: typeof MASA_RECORD_MEDIA_TYPE;
  href: string;
}

export type MappingDecision = ControlDecision;

export class MasaSnapshotValidationError extends Error {
  readonly diagnostics: readonly Diagnostic[];

  constructor(diagnostics: readonly Diagnostic[]) {
    const detail = diagnostics
      .filter((item) => item.severity === "error")
      .slice(0, 4)
      .map(
        (item) =>
          `${item.code}${item.instancePath ? ` at ${item.instancePath}` : ""}`
      )
      .join(", ");
    super(
      `COSMOAUDITION snapshot failed MASA validation${detail ? `: ${detail}` : ""}`
    );
    this.name = "MasaSnapshotValidationError";
    this.diagnostics = diagnostics;
  }
}

export class MasaSnapshotInputError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "MasaSnapshotInputError";
  }
}

export function validateSnapshotMatterRecord(
  value: unknown
): ValidationResult<MatterRecord> {
  return validateMatterRecord(value);
}

export function serializeSnapshotMatterRecord(record: MatterRecord): string {
  return `${stableStringify(record, 2)}\n`;
}

export function createMasaSnapshotSummary(
  record: MatterRecord,
  href: string
): MasaSnapshotSummary {
  return {
    masaVersion: record.masaVersion,
    recordId: record.id,
    profiles: record.profiles,
    valid: true,
    mediaType: MASA_RECORD_MEDIA_TYPE,
    href
  };
}

export function evaluateMappingDecision(
  signal: ObservedSignal,
  mapping: SonicMapping,
  previousOutput?: number
): MappingDecision {
  return executeMapping(
    mapping,
    signal,
    previousOutput === undefined ? {} : { previousOutput }
  );
}

export async function buildSnapshotMatterRecord(
  snapshot: SnapshotLike
): Promise<MatterRecord> {
  assertBoundedSnapshot(snapshot);

  const snapshotPayload = normalizeJsonValue(snapshot);
  const snapshotText = stableStringify(snapshotPayload);
  const snapshotDigest = await sha256(snapshotText);
  const snapshotByteLength = new TextEncoder().encode(snapshotText).byteLength;
  const nextId = createIdFactory(snapshotDigest);
  const createdAt = snapshot.generatedAt;
  // Attribution follows the mode the observation was acquired in. A replay
  // (`mode: "archive"`) reports how the record is being read, not where the
  // values came from, so fixture provenance survives archive round trips.
  const acquisitionMode = snapshot.originMode ?? snapshot.mode;

  const recordId = nextId("record");
  const humanActorId = nextId("operator");
  const softwareActorId = nextId("adapter");
  const policyId = nextId("policy");
  const policyRuleId = nextId("policy-rule");
  const toolId = nextId("tool");

  const policyEvaluation = (
    action: string,
    targets: readonly string[]
  ) => ({
    action,
    targets: [...targets],
    policyRefs: [policyId],
    result: "permitted" as const,
    evaluatedAt: createdAt,
    evaluator: humanActorId,
    authorityRefs: [policyRuleId],
    reasons: [
      "The active private COSMOAUDITION policy permits this bounded local operation."
    ]
  });

  const tool = {
    state: "known" as const,
    value: {
      id: toolId,
      name: "COSMOAUDITION MASA snapshot adapter",
      version: { state: "known" as const, value: ADAPTER_VERSION },
      kind: "software" as const,
      provider: {
        state: "known" as const,
        value: "Sonic Matter Framework"
      },
      adapter: {
        state: "known" as const,
        value: "@cosmoaudition/masa"
      }
    }
  };

  const actors = [
    {
      id: humanActorId,
      type: "masa:Actor",
      actorKind: "human",
      roles: ["local-operator", "record-creator"],
      name: {
        state: "unknown",
        reason: "The snapshot request did not include an operator name.",
        reasonCode: "not_provided"
      },
      disclosure: "private",
      extensions: {}
    },
    {
      id: softwareActorId,
      type: "masa:Actor",
      actorKind: "software",
      roles: [
        "canonical-parser",
        "observation-deriver",
        "mapping-engine"
      ],
      name: {
        state: "known",
        value: "COSMOAUDITION MASA snapshot adapter"
      },
      attribution: "Sonic Matter Framework / Cosmoaudition System",
      disclosure: "private",
      extensions: {}
    }
  ];

  const sources: Array<Record<string, unknown>> = [];
  const representations: Array<Record<string, unknown>> = [];
  const observations: Array<Record<string, unknown>> = [];
  const mappings: Array<Record<string, unknown>> = [];
  const relations: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];

  const groups = groupSnapshotBySource(snapshot);
  let sequence = 0;

  for (const group of groups) {
    const definition = getSourceDefinition(group.sourceId);
    const sourceId = nextId("source");
    const representationId = nextId("canonical-representation");
    const observeReceiptId = nextId("observe-receipt");
    const sourceHealth = toMasaHealth(
      group.health?.confidence ?? aggregateConfidence(group.signals),
      createdAt,
      group.health?.error
    );
    const sourceObservedAt = group.health?.fetchedAt ?? firstSignalTimestamp(group.signals);
    const sourceFreshness = toMasaFreshness(
      group.health?.confidence ?? aggregateConfidence(group.signals),
      sourceObservedAt === null
        ? null
        : toMasaTimestamp(sourceObservedAt, createdAt),
      createdAt
    );
    const isFixture = acquisitionMode === "fixture";
    const isSystem = group.sourceId === "system";

    sources.push({
      id: sourceId,
      type: "masa:Source",
      sourceKind: isFixture
        ? "local-fixture"
        : isSystem
          ? "local-system-state"
          : definition?.route === "browser-only"
            ? "local-browser-signal"
            : "public-api",
      identification: {
        state: "known",
        value: {
          sourceId: group.sourceId,
          label: definition?.label ?? group.sourceId,
          acquisitionMode,
          fixture: isFixture,
          ...(isFixture && (definition?.endpoint ?? definition?.endpointPattern)
            ? {
                intendedProviderLocator:
                  definition?.endpoint ?? definition?.endpointPattern
              }
            : {})
        }
      },
      locator: isFixture
        ? {
            state: "known",
            value: `cosmoaudition-fixture:${group.sourceId}`
          }
        : isSystem
          ? { state: "not_applicable" }
          : providerLocator(definition, group.signals),
      authority: isSystem
        ? {
            state: "known",
            value: "COSMOAUDITION local runtime"
          }
        : {
            state: "unknown",
            reason: isFixture
              ? "Fixture data does not assert live provider authority."
              : "The source definition does not by itself establish provider authority.",
            reasonCode: isFixture ? "fixture_only" : "not_verified"
          },
      rights: definition
        ? {
            state: "known",
            value: {
              note: definition.licenseNote,
              verification: isFixture
                ? "applies to the intended provider; no live retrieval occurred"
                : "source declaration; provider terms require review before publication"
            }
          }
        : {
            state: "unknown",
            reason: "No external rights statement applies to this local system signal.",
            reasonCode: "not_applicable_local"
          },
      coverage: {
        state: "known",
        value: {
          layers: definition?.layers ?? unique(group.signals.map((signal) => signal.layer)),
          limitation:
            definition?.limitation ??
            "Local system state within the current snapshot only."
        }
      },
      health: sourceHealth,
      freshness: sourceFreshness,
      policyRefs: [policyId],
      disclosure: "private",
      extensions: {
        "cosmo:source": {
          originalSourceId: group.sourceId,
          fixture: isFixture,
          route: definition?.route ?? "internal"
        }
      }
    });

    const canonicalPayload = normalizeJsonValue({
      schema: "cosmoaudition:canonical-source-snapshot:0.1.0",
      generatedAt: snapshot.generatedAt,
      mode: snapshot.mode,
      sourceId: group.sourceId,
      definition: definition ?? null,
      health: group.health ?? null,
      cache: group.cache ?? null,
      signals: group.signals
    });
    const canonicalText = stableStringify(canonicalPayload);
    const canonicalDigest = await sha256(canonicalText);
    const canonicalByteLength = new TextEncoder().encode(canonicalText).byteLength;

    representations.push({
      id: representationId,
      type: "masa:Representation",
      role: "data",
      mediaType: "application/json",
      format: {
        state: "known",
        value: "COSMOAUDITION canonical parsed source snapshot 0.1.0"
      },
      availability: "available",
      locator: {
        state: "known",
        value: `urn:sha256:${canonicalDigest}`
      },
      extent: {
        state: "known",
        value: { byteLength: canonicalByteLength }
      },
      integrity: {
        state: "known",
        value: {
          algorithm: "sha-256",
          digest: canonicalDigest,
          byteLength: canonicalByteLength,
          status: "verified"
        }
      },
      policyRefs: [policyId],
      disclosure: "private",
      extensions: {
        "cosmo:canonicalPayload": canonicalPayload,
        "cosmo:fixture": isFixture
      }
    });

    const rawObservationIds: string[] = [];
    for (const signal of group.signals) {
      const rawObservationId = nextId("observation");
      const observedAt = toMasaTimestamp(signal.timestamp, createdAt);
      const observationHealth = toMasaHealth(
        signal.confidence,
        createdAt,
        signal.error
      );
      const observationFreshness = toMasaFreshness(
        signal.confidence,
        observedAt,
        createdAt
      );
      rawObservationIds.push(rawObservationId);

      observations.push({
        id: rawObservationId,
        type: "masa:Observation",
        sourceRef: sourceId,
        field: signal.id,
        observedAt,
        scope: {
          state: "known",
          value: {
            label: signal.label,
            layer: signal.layer,
            acquisitionMode
          }
        },
        value:
          signal.value === null
            ? {
                state: "unknown",
                reason: signal.error ?? "The source emitted no numeric value.",
                reasonCode: "missing_source_value"
              }
            : { state: "known", value: signal.value },
        unit: { state: "known", value: signal.unit },
        method: {
          name: "COSMOAUDITION canonical source parsing",
          version: { state: "known", value: ADAPTER_VERSION },
          parameters: {
            parser: definition?.parser ?? "local snapshot field",
            canonicalRepresentationRef: representationId,
            fixture: isFixture
          },
          apparatusRefs: [softwareActorId]
        },
        health: observationHealth,
        freshness: observationFreshness,
        disclosure: "private",
        extensions: {
          "cosmo:signal": {
            originalSignalId: signal.id,
            confidence: signal.confidence,
            ...(signal.sphere ? { sphere: signal.sphere } : {}),
            ...(signal.epistemicStatus
              ? { epistemicStatus: signal.epistemicStatus }
              : {}),
            ...(signal.temporalCharacter
              ? { temporalCharacter: signal.temporalCharacter }
              : {}),
            ...(signal.signalKind ? { signalKind: signal.signalKind } : {}),
            ...(signal.eventKey ? { eventKey: signal.eventKey } : {}),
            ...(signal.generator ? { generator: signal.generator } : {}),
            ...(signal.notes ? { notes: signal.notes } : {})
          },
          ...sourceTimestampContext(signal, observedAt, createdAt),
          "cosmo:representationRef": representationId
        }
      });

      relations.push({
        id: nextId("relation"),
        type: "masa:Relation",
        subject: rawObservationId,
        predicate: "masa:derived-from",
        object: representationId,
        assertedBy: softwareActorId,
        createdAt,
        basis: [{ ref: observeReceiptId, role: "operation" }],
        operationRef: observeReceiptId,
        extensions: {
          "cosmo:relationRole": "canonical-representation-to-observation"
        }
      });

      for (const catalogMapping of mappingCatalog.filter(
        (candidate) => candidate.signalId === signal.id
      )) {
        const derivedObservationId = nextId("derived-observation");
        const deriveReceiptId = nextId("derive-receipt");
        const mappingId = nextId("mapping");
        const mappingReceiptId = nextId("mapping-receipt");
        const route = snapshot.mappingRoutes?.[catalogMapping.id];
        const previousOutput = snapshot.previousOutputs?.[catalogMapping.id];
        const decision = executeMapping(catalogMapping, signal, {
          ...(route === undefined
            ? {}
            : { enabled: route.enabled, amount: route.amount }),
          ...(previousOutput === undefined || !Number.isFinite(previousOutput)
            ? {}
            : { previousOutput })
        });

        observations.push({
          id: derivedObservationId,
          type: "masa:Observation",
          sourceRef: sourceId,
          field: `${signal.id}.normalized.${catalogMapping.id}`,
          observedAt,
          scope: {
            state: "known",
            value: {
              sourceObservationRef: rawObservationId,
              mappingCatalogId: catalogMapping.id,
              normalizationDomain: [0, 1]
            }
          },
          value:
            decision.normalizedInput === null
              ? {
                  state: "unknown",
                  reason: `The core mapping decision produced no normalized value: ${decision.reason}.`,
                  reasonCode: "mapping_input_not_executable"
                }
              : { state: "known", value: decision.normalizedInput },
          unit: { state: "known", value: "normalized-ratio" },
          method: {
            name: "COSMOAUDITION core mapping normalization",
            version: { state: "known", value: ADAPTER_VERSION },
            parameters: {
              implementation: "@cosmoaudition/core.executeMapping",
              sourceField: signal.id,
              scale: catalogMapping.scale,
              inputRange: catalogMapping.inputRange ?? null,
              clipping: "clamp"
            },
            apparatusRefs: [softwareActorId]
          },
          health: observationHealth,
          freshness: observationFreshness,
          disclosure: "private",
          extensions: {
            "cosmo:epistemicStatus": "derived",
            "cosmo:sourceObservationRef": rawObservationId,
            "cosmo:controlDecision": {
              status: decision.status,
              reason: decision.reason
            }
          }
        });

        relations.push({
          id: nextId("relation"),
          type: "masa:Relation",
          subject: derivedObservationId,
          predicate: "masa:derived-from",
          object: rawObservationId,
          assertedBy: softwareActorId,
          createdAt,
          basis: [{ ref: deriveReceiptId, role: "operation" }],
          operationRef: deriveReceiptId,
          extensions: {
            "cosmo:relationRole": "raw-to-mapping-normalized-observation"
          }
        });

        events.push({
          id: deriveReceiptId,
          type: "masa:OperationReceipt",
          recordId,
          sequence: sequence++,
          operationType: "matter.derive-observation",
          effectClass: "derive",
          finalStatus: "completed",
          startedAt: createdAt,
          endedAt: createdAt,
          actors: [softwareActorId],
          inputs: [rawObservationId, representationId],
          outputs: [derivedObservationId],
          tool,
          parameters: {
            implementation: "@cosmoaudition/core.executeMapping",
            mappingCatalogId: catalogMapping.id,
            sourceField: signal.id,
            outputField: `${signal.id}.normalized.${catalogMapping.id}`,
            decision: decision.status,
            reason: decision.reason
          },
          policyEvaluation: policyEvaluation("derive", [recordId]),
          reversibility: "reversible",
          determinism: { state: "deterministic" },
          warnings:
            decision.normalizedInput === null
              ? [
                  "The derived observation preserves an explicit unknown value; no numeric substitute was created."
                ]
              : decision.status === "uncertainty"
                ? [
                    "The normalized value preserves stale or low-confidence source status; it is not labelled fresh or measured."
                  ]
                : [],
          errors: [],
          claimRefs: [],
          extensions: {}
        });

        mappings.push({
          id: mappingId,
          type: "masa:Mapping",
          sourceObservationRefs: [derivedObservationId],
          sourceField: `${signal.id}.normalized.${catalogMapping.id}`,
          sourceUnit: "normalized-ratio",
          inputRange: [0, 1],
          normalization: {
            method: "linear",
            clipping: "clamp",
            parameters: {
              sourceMappingScale: catalogMapping.scale,
              sourceInputRange: catalogMapping.inputRange ?? null,
              normalizedObservationAlreadyDerived: true
            }
          },
          target: catalogMapping.target,
          outputRange: [...catalogMapping.outputRange],
          // Report the authored curve rather than flattening it. Recording a
          // categorical lookup as "linear" would describe interpolation that
          // never happens; the MASA curve vocabulary already covers each form.
          curve: masaCurve(catalogMapping.scale),
          smoothingMs: catalogMapping.smoothingMs,
          cadence: "once per accepted snapshot",
          missingData: catalogMapping.missingData,
          epistemicNote: `${catalogMapping.epistemicNote} This control relation is authored; it is not the source's voice or an identity claim.`,
          actors: [softwareActorId],
          createdAt,
          extensions: {
            "cosmo:mappingCatalogId": catalogMapping.id,
            "cosmo:description": catalogMapping.description,
            "cosmo:layer": catalogMapping.layer,
            "cosmo:decisionImplementation": "@cosmoaudition/core.executeMapping",
            // A categorical mapping is a lookup, so the table itself is the
            // relation. Without it the record could not be replayed.
            ...(catalogMapping.categories === undefined
              ? {}
              : {
                  "cosmo:categoryTable": catalogMapping.categories.map((entry) => ({
                    value: entry.value,
                    output: entry.output
                  }))
                }),
            ...(catalogMapping.uncertaintyOutput === undefined
              ? {}
              : { "cosmo:uncertaintyOutput": catalogMapping.uncertaintyOutput })
          }
        });

        const outputs: string[] = [];
        if (isExecutableControlDecision(decision)) {
          const controlRepresentationId = nextId("control-frame");
          const controlFrame = {
            type: "cosmo:ControlFrame",
            version: ADAPTER_VERSION,
            mappingRef: mappingId,
            catalogMappingId: catalogMapping.id,
            sourceObservationRef: derivedObservationId,
            target: catalogMapping.target,
            rawNormalizedValue:
              decision.rawNormalizedInput ?? decision.normalizedInput,
            normalizedValue: decision.normalizedInput,
            mappingAmount: decision.mappingAmount ?? 1,
            outputValue: decision.outputValue,
            decisionStatus: decision.status,
            decisionReason: decision.reason,
            confidence: decision.confidence,
            smoothingMs: catalogMapping.smoothingMs,
            generatedAt: createdAt,
            scheduledOnly: true,
            completionSemantics: "scheduled-not-heard"
          };
          const controlText = stableStringify(controlFrame);
          const controlDigest = await sha256(controlText);
          const controlByteLength = new TextEncoder().encode(controlText).byteLength;
          outputs.push(controlRepresentationId);

          representations.push({
            id: controlRepresentationId,
            type: "masa:Representation",
            role: "data",
            mediaType: "application/vnd.cosmoaudition.control-frame+json",
            format: {
              state: "known",
              value: "COSMOAUDITION ControlFrame 0.1.0"
            },
            availability: "available",
            locator: {
              state: "known",
              value: `urn:sha256:${controlDigest}`
            },
            extent: {
              state: "known",
              value: { byteLength: controlByteLength }
            },
            integrity: {
              state: "known",
              value: {
                algorithm: "sha-256",
                digest: controlDigest,
                byteLength: controlByteLength,
                status: "verified"
              }
            },
            policyRefs: [policyId],
            disclosure: "private",
            extensions: {
              "cosmo:controlFrame": controlFrame
            }
          });

          relations.push({
            id: nextId("relation"),
            type: "masa:Relation",
            subject: controlRepresentationId,
            predicate: "masa:mapped-from",
            object: derivedObservationId,
            assertedBy: softwareActorId,
            createdAt,
            basis: [{ ref: mappingReceiptId, role: "operation" }],
            operationRef: mappingReceiptId,
            extensions: {
              "cosmo:mappingRef": mappingId
            }
          });
        }

        events.push({
          id: mappingReceiptId,
          type: "masa:OperationReceipt",
          recordId,
          sequence: sequence++,
          operationType: "matter.map",
          effectClass: "map",
          finalStatus:
            isExecutableControlDecision(decision)
              ? "completed"
              : decision.status === "refused"
                ? "refused"
                : "not_performed",
          startedAt: createdAt,
          endedAt: createdAt,
          actors: [softwareActorId],
          inputs: [derivedObservationId],
          outputs,
          tool,
          parameters: {
            mappingRef: mappingId,
            target: catalogMapping.target,
            missingData: catalogMapping.missingData,
            decision: decision.status,
            reason: decision.reason,
            ...(isExecutableControlDecision(decision)
              ? {
                  normalizedValue: decision.normalizedInput,
                  outputValue: decision.outputValue,
                  scheduledOnly: true,
                  completionSemantics: "scheduled-not-heard"
                }
              : {})
          },
          policyEvaluation: policyEvaluation("map", [mappingId]),
          reversibility: "interface_reversible",
          determinism: { state: "deterministic" },
          warnings: mappingWarnings(decision),
          errors: [],
          claimRefs: [],
          extensions: {}
        });
      }
    }

    events.push({
      id: observeReceiptId,
      type: "masa:OperationReceipt",
      recordId,
      sequence: sequence++,
      operationType: "matter.observe-source-snapshot",
      effectClass: "read",
      finalStatus: "completed",
      startedAt: createdAt,
      endedAt: createdAt,
      actors: [softwareActorId],
      inputs: [sourceId],
      outputs: [representationId, ...rawObservationIds],
      tool,
      parameters: {
        sourceId: group.sourceId,
        acquisitionMode,
        fixture: isFixture,
        canonicalSha256: canonicalDigest
      },
      policyEvaluation: policyEvaluation("read", [recordId]),
      reversibility: "reversible",
      determinism: { state: "deterministic" },
      warnings: isFixture
        ? [
            "The source and observations are attributed to a local fixture; no live provider retrieval is claimed."
          ]
        : [],
      errors: [],
      claimRefs: [],
      extensions: {}
    });

    relations.push({
      id: nextId("relation"),
      type: "masa:Relation",
      subject: representationId,
      predicate: "masa:captured-from",
      object: sourceId,
      assertedBy: softwareActorId,
      createdAt,
      basis: [{ ref: observeReceiptId, role: "operation" }],
      operationRef: observeReceiptId,
      extensions: {}
    });
  }

  if (mappings.length === 0) {
    throw new MasaSnapshotInputError(
      "The snapshot contains no signal with an authored COSMOAUDITION mapping."
    );
  }

  const eventRank = (event: Record<string, unknown>): number => {
    if (event.effectClass === "read") return 0;
    if (event.effectClass === "derive") return 1;
    if (event.effectClass === "map") return 2;
    return 3;
  };
  events.sort((left, right) => {
    const rank = eventRank(left) - eventRank(right);
    return rank !== 0
      ? rank
      : Number(left.sequence) - Number(right.sequence);
  });
  events.forEach((event, index) => {
    event.sequence = index;
  });

  const contexts = snapshot.coordinates
    ? [
        {
          id: nextId("context"),
          type: "masa:Context",
          contextKind: "territorial",
          content: {
            coordinates: snapshot.coordinates,
            precision: "request-supplied or application default",
            disclosureBoundary: "private record only"
          },
          provenance: {
            state: "known",
            value: "COSMOAUDITION snapshot request"
          },
          applicability:
            "Applies only to source adapters whose contracts use the current manual coordinates.",
          position: {
            state: "known",
            value:
              "Coordinates locate a request aperture; they do not make the snapshot planetary-total."
          },
          claimStatus: "not_a_claim",
          disclosure: "private",
          extensions: {}
        }
      ]
    : [];

  const rawRecord = {
    $schema: SCHEMA_URI,
    "@context": CONTEXT_URI,
    masaVersion: "0.1.0",
    id: recordId,
    type: "masa:MatterRecord",
    revision: 1,
    profiles: ["core", "mapping"],
    createdAt,
    createdBy: humanActorId,
    title: `COSMOAUDITION snapshot ${createdAt}`,
    description:
      "One bounded MASA account of a COSMOAUDITION snapshot. Sources, canonical parsed representations, raw observations, derived normalized observations, authored mappings, and control-frame representations remain distinct and traceable.",
    disclosure: "private",
    registers: [
      "digital-technical",
      "compositional-transformational",
      "ecological-territorial"
    ],
    scales: ["object-event", "environmental", "infrastructural", "planetary"],
    actors,
    sources,
    representations,
    encounters: [],
    apertures: [],
    listeningPasses: [],
    claims: [],
    measurements: [],
    regions: [],
    observations,
    mappings,
    relations,
    policies: [
      {
        id: policyId,
        type: "masa:Policy",
        policyKind: "composite",
        issuer: humanActorId,
        status: "active",
        validFrom: createdAt,
        disclosure: "private",
        rules: [
          {
            id: policyRuleId,
            effect: "permission",
            actions: ["read", "validate", "derive", "map", "export"],
            targets: [recordId],
            subjects: [humanActorId, softwareActorId],
            authorityBasis: {
              state: "known",
              value:
                "Local operator request for a private COSMOAUDITION snapshot record."
            },
            constraints: {
              recordCountPerSnapshot: 1,
              maximumSignals: MAX_MASA_SNAPSHOT_SIGNALS,
              maximumSources: MAX_MASA_SNAPSHOT_SOURCES,
              disclosure: "private",
              publicProjectionRequiresReview: true
            },
            duties: [
              "Preserve source attribution, fixture status, unknown values, staleness, mapping decisions, and lineage.",
              "Do not interpret a completed mapping receipt as evidence that sound was heard."
            ]
          }
        ],
        review: {
          contact: {
            state: "unknown",
            reason: "No external review contact is configured for this local record.",
            reasonCode: "not_configured"
          },
          route: {
            state: "known",
            value:
              "Review the private MASA record before any publication or external bundle export."
          }
        },
        extensions: {}
      }
    ],
    contexts,
    agentRuns: [],
    capabilities: [],
    integrity: {
      state: "known",
      value: {
        algorithm: "sha-256",
        digest: snapshotDigest,
        byteLength: snapshotByteLength,
        scope: "canonical input snapshot before MASA projection"
      }
    },
    history: { mode: "embedded", events },
    extensions: {
      "cosmo:snapshot": {
        generatedAt: snapshot.generatedAt,
        mode: snapshot.mode,
        signalCount: snapshot.signals.length,
        sourceCount: groups.length,
        recordCardinality: "one-record-per-snapshot",
        ...(snapshot.coordinates ? { coordinates: snapshot.coordinates } : {})
      },
      "cosmo:adapter": {
        package: "@cosmoaudition/masa",
        version: ADAPTER_VERSION,
        completionSemantics: "scheduled-not-heard"
      }
    }
  };

  const validation = validateMatterRecord(rawRecord);
  if (!validation.valid || validation.value === undefined) {
    throw new MasaSnapshotValidationError(validation.diagnostics);
  }
  return validation.value;
}

interface SourceGroup {
  sourceId: string;
  signals: ObservedSignal[];
  health?: SourceHealth;
  cache?: CacheMetadata;
}

function groupSnapshotBySource(snapshot: SnapshotLike): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  const ensure = (sourceId: string): SourceGroup => {
    const existing = groups.get(sourceId);
    if (existing) return existing;
    const created: SourceGroup = { sourceId, signals: [] };
    groups.set(sourceId, created);
    return created;
  };

  for (const health of snapshot.sources) {
    ensure(health.sourceId).health = health;
  }
  for (const cache of snapshot.cache ?? []) {
    ensure(cache.sourceId).cache = cache;
  }
  for (const signal of snapshot.signals) {
    ensure(signal.sourceId).signals.push(signal);
  }

  return [...groups.values()];
}

function assertBoundedSnapshot(snapshot: SnapshotLike): void {
  if (!Number.isFinite(Date.parse(snapshot.generatedAt))) {
    throw new MasaSnapshotInputError("Snapshot generatedAt must be a date-time.");
  }
  if (snapshot.mode.trim().length === 0) {
    throw new MasaSnapshotInputError("Snapshot mode must be explicit.");
  }
  if (snapshot.signals.length === 0) {
    throw new MasaSnapshotInputError("A MASA snapshot requires at least one signal.");
  }
  if (snapshot.signals.length > MAX_MASA_SNAPSHOT_SIGNALS) {
    throw new MasaSnapshotInputError(
      `Snapshot exceeds the ${MAX_MASA_SNAPSHOT_SIGNALS}-signal MASA boundary.`
    );
  }
  if (snapshot.mappingRoutes !== undefined) {
    const catalogIds = new Set(mappingCatalog.map((mapping) => mapping.id));
    for (const [mappingId, route] of Object.entries(snapshot.mappingRoutes)) {
      if (!catalogIds.has(mappingId)) {
        throw new MasaSnapshotInputError(`Unknown mapping route: ${mappingId}.`);
      }
      if (
        typeof route.enabled !== "boolean" ||
        !Number.isFinite(route.amount) ||
        route.amount < 0 ||
        route.amount > 1
      ) {
        throw new MasaSnapshotInputError(`Mapping route ${mappingId} is invalid.`);
      }
    }
  }
  const uniqueSourceIds = new Set([
    ...snapshot.sources.map((source) => source.sourceId),
    ...(snapshot.cache ?? []).map((cache) => cache.sourceId),
    ...snapshot.signals.map((signal) => signal.sourceId)
  ]);
  if (uniqueSourceIds.size > MAX_MASA_SNAPSHOT_SOURCES) {
    throw new MasaSnapshotInputError(
      `Snapshot exceeds the ${MAX_MASA_SNAPSHOT_SOURCES}-unique-source MASA boundary.`
    );
  }

  for (const signal of snapshot.signals) {
    if (!Number.isFinite(Date.parse(signal.timestamp))) {
      throw new MasaSnapshotInputError(
        `Signal ${signal.id} has an invalid timestamp.`
      );
    }
    if (signal.value !== null && !Number.isFinite(signal.value)) {
      throw new MasaSnapshotInputError(
        `Signal ${signal.id} has a non-finite value.`
      );
    }
    if (signal.normalized !== null && !Number.isFinite(signal.normalized)) {
      throw new MasaSnapshotInputError(
        `Signal ${signal.id} has a non-finite normalized value.`
      );
    }
  }
}

/** Translate a catalog scale into the MASA Mapping curve vocabulary. */
function masaCurve(scale: SonicMapping["scale"]): string {
  switch (scale) {
    case "exp":
      return "exponential";
    case "log":
      return "log";
    case "quantized":
      return "quantized";
    case "categorical":
      return "categorical";
    default:
      return "linear";
  }
}

function providerLocator(
  definition: ReturnType<typeof getSourceDefinition>,
  signals: readonly ObservedSignal[]
): Record<string, unknown> {
  const locator =
    signals.find((signal) => signal.sourceUrl)?.sourceUrl ??
    definition?.endpoint ??
    definition?.endpointPattern;
  return locator
    ? { state: "known", value: locator }
    : {
        state: "unavailable",
        reason: "No provider locator is attached to this snapshot source.",
        reasonCode: "not_attached"
      };
}

function mappingWarnings(decision: MappingDecision): string[] {
  const completionBoundary =
    "Completion records a produced control frame scheduled for the interface; it does not claim that sound was rendered, heard, or verified.";

  if (decision.status === "uncertainty") {
    return [
      `The control value carries explicit ${decision.reason} status and is not labelled fresh or measured.`,
      completionBoundary
    ];
  }
  if (decision.status === "held") {
    return [
      `The control frame explicitly holds a prior bounded value because of ${decision.reason}; it is not a new source measurement.`,
      completionBoundary
    ];
  }
  if (decision.status === "applied") return [completionBoundary];
  if (decision.status === "refused") {
    return [`The core mapping decision refused output: ${decision.reason}.`];
  }
  return [`The core mapping decision produced no control value: ${decision.reason}.`];
}

function toMasaHealth(
  confidence: ObservedSignal["confidence"],
  checkedAt: string,
  error?: string
): Record<string, unknown> {
  if (confidence === "error") {
    return {
      status: "error",
      checkedAt,
      reason: error ?? "The source reported an error."
    };
  }
  if (confidence === "stale") {
    return {
      status: "degraded",
      checkedAt,
      reason: error ?? "The source value is stale."
    };
  }
  return { status: "healthy", checkedAt };
}

function toMasaFreshness(
  confidence: ObservedSignal["confidence"],
  observedAt: string | null,
  generatedAt: string
): Record<string, unknown> {
  if (observedAt === null || !Number.isFinite(Date.parse(observedAt))) {
    return { status: "unknown" };
  }
  const ageSeconds = Math.max(
    0,
    (Date.parse(generatedAt) - Date.parse(observedAt)) / 1000
  );
  return {
    status:
      confidence === "stale" || confidence === "error" ? "stale" : "current",
    observedAt,
    retrievedAt: generatedAt,
    ageSeconds
  };
}

function aggregateConfidence(
  signals: readonly ObservedSignal[]
): ObservedSignal["confidence"] {
  // No signal is no evidence. Reporting "high" here would let a source group
  // built from a cache entry alone be recorded as a healthy source.
  if (signals.length === 0) return "error";
  if (signals.some((signal) => signal.confidence === "error")) return "error";
  if (signals.some((signal) => signal.confidence === "stale")) return "stale";
  if (signals.some((signal) => signal.confidence === "low")) return "low";
  if (signals.some((signal) => signal.confidence === "medium")) return "medium";
  return "high";
}

function firstSignalTimestamp(
  signals: readonly ObservedSignal[]
): string | null {
  return signals[0]?.timestamp ?? null;
}

function toMasaTimestamp(value: string, fallback: string): string {
  const parsed = parseAbsoluteTime(value);
  const fallbackTime = Date.parse(fallback);
  if (
    parsed === null ||
    (Number.isFinite(fallbackTime) && parsed > fallbackTime)
  ) {
    return fallback;
  }
  return new Date(parsed).toISOString();
}

function sourceTimestampContext(
  signal: ObservedSignal,
  observedAt: string,
  snapshotGeneratedAt: string
): Record<string, unknown> {
  if (observedAt === signal.timestamp) return {};
  // A zoneless source timestamp has no absolute instant, so it can only be
  // reported as unusable. Parsing it as host-local would make the recorded
  // reason (and therefore the record bytes) depend on the machine's timezone
  // while every receipt still claims determinism.
  const sourceTime = parseAbsoluteTime(signal.timestamp);
  const observedTime = Date.parse(observedAt);
  if (
    sourceTime !== null &&
    Number.isFinite(observedTime) &&
    sourceTime === observedTime
  ) {
    return {};
  }
  const snapshotTime = Date.parse(snapshotGeneratedAt);
  const sourceIsFuture =
    sourceTime !== null && Number.isFinite(snapshotTime) && sourceTime > snapshotTime;

  if (sourceIsFuture) {
    return {
      "cosmo:sourceTimestamp": signal.timestamp,
      "cosmo:sourceTimestampRole":
        signal.temporalCharacter === "forecast"
          ? "forecast-valid-at"
          : "future-source-time",
      "cosmo:timestampDecision":
        "used-snapshot-generatedAt-as-observedAt-because-source-timestamp-is-a-future-validity-or-event-time"
    };
  }

  return {
    "cosmo:sourceTimestamp": signal.timestamp,
    "cosmo:sourceTimestampRole": "source-reported-time",
    "cosmo:timestampDecision":
      "used-snapshot-generatedAt-as-observedAt-because-source-time-lacked-a-usable-explicit-zone"
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function createIdFactory(snapshotDigest: string): (kind: string) => string {
  let counter = 0;
  return (kind: string) => {
    const current = counter++;
    return `urn:cosmoaudition:masa:${kind}:${snapshotDigest.slice(0, 24)}:${current.toString(36)}`;
  };
}

async function sha256(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new MasaSnapshotInputError(
      "Web Crypto SHA-256 support is required to build a MASA snapshot record."
    );
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeJsonValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new MasaSnapshotInputError("Snapshot JSON contains a non-finite number.");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeJsonValue);
  }
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (child !== undefined) output[key] = normalizeJsonValue(child);
    }
    return output;
  }
  throw new MasaSnapshotInputError(
    `Snapshot JSON contains unsupported ${typeof value} data.`
  );
}
