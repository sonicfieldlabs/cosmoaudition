export type Confidence = "high" | "medium" | "low" | "stale" | "error";

export type StackLayer =
  | "earth"
  | "cloud"
  | "city"
  | "address"
  | "interface"
  | "user";

export type ObservationSphere =
  | "cosmos"
  | "atmosphere"
  | "geosphere"
  | "biosphere"
  | "human"
  | "machine";

export type EpistemicStatus =
  | "measured"
  | "reported"
  | "derived"
  | "interpreted"
  | "speculative";

export type TemporalCharacter =
  | "event"
  | "stream"
  | "forecast"
  | "aggregate"
  | "context"
  | "local";

export type SignalKind = "observation" | "derived" | "generator";

export interface GeneratorProvenance {
  algorithm:
    | "sine"
    | "triangle"
    | "saw"
    | "pulse"
    | "envelope"
    | "sample-and-hold";
  seed: number;
  rateHz: number;
  phaseOrigin: string;
}

export type SourceStatus =
  | "ready"
  | "cache-only"
  | "fixture-only"
  | "blocked"
  | "deferred";

/**
 * Where a source's values come from. `local-runtime` describes the system's
 * own account of itself, which is neither fetched through the gateway nor
 * observed in the browser.
 */
export type SourceRoute = "api-proxy" | "browser-only" | "local-runtime";

export type IndexId = "SPI" | "EPI" | "CEI" | "CTI" | "LPI" | "BNI" | "LMI";

export type MissingDataPolicy =
  | "skip"
  | "hold-explicitly"
  | "interpolate-explicitly"
  | "map-uncertainty"
  | "refuse";

/**
 * Project-neutral signal envelope used throughout the control pipeline.
 *
 * A signal can come from a cosmic observation, an infrastructure aggregate,
 * a local sensor, or an explicitly authored deterministic generator.
 */
export interface ObservedSignal {
  id: string;
  label: string;
  layer: StackLayer;
  unit: string;
  value: number | null;
  normalized: number | null;
  timestamp: string;
  sourceId: string;
  sourceUrl?: string;
  sphere?: ObservationSphere;
  epistemicStatus?: EpistemicStatus;
  temporalCharacter?: TemporalCharacter;
  signalKind?: SignalKind;
  /** Stable provider/local event key used for deduplicated trigger projection. */
  eventKey?: string;
  /** Present only for authored local generator signals. */
  generator?: GeneratorProvenance;
  confidence: Confidence;
  staleAfterSeconds: number;
  error?: string;
  notes?: string;
}

export interface CategoricalMappingEntry {
  value: number;
  output: number;
  label?: string;
}

export interface SonicMapping {
  id: string;
  signalId: string;
  layer: StackLayer;
  target: string;
  scale: "linear" | "log" | "exp" | "quantized" | "categorical";
  inputRange?: [number, number];
  /** Required when `scale` is categorical; values are matched exactly. */
  categories?: readonly CategoricalMappingEntry[];
  outputRange: [number, number];
  smoothingMs: number;
  missingData: MissingDataPolicy;
  /**
   * Required when `missingData` is `map-uncertainty`: the bounded value that
   * represents *not knowing*, emitted with an `uncertainty` status so it is
   * never mistaken for a measurement. Without it the policy has no declared
   * way to sound uncertainty, and the mapping refuses instead.
   */
  uncertaintyOutput?: number;
  description: string;
  epistemicNote: string;
}

export interface SourceDefinition {
  id: string;
  label: string;
  status: SourceStatus;
  layers: StackLayer[];
  sphere?: ObservationSphere;
  temporalCharacter?: TemporalCharacter;
  route: SourceRoute;
  ttlSeconds: number;
  unit: string;
  parser: string;
  endpoint?: string;
  endpointPattern?: string;
  limitation: string;
  fallback: string;
  licenseNote: string;
  requestPolicy?: {
    maxResponseBytes?: number;
    /** Requests sharing a key are serialized to honor provider fair-use rules. */
    concurrencyKey?: string;
  };
}

export interface SourceHealth {
  sourceId: string;
  status: SourceStatus;
  confidence: Confidence;
  fetchedAt: string | null;
  staleAfterSeconds: number;
  latencyMs?: number;
  error?: string;
}

export interface CacheMetadata {
  sourceId: string;
  cacheKey: string;
  hit: boolean;
  fetchedAt: string;
  expiresAt: string;
  staleAt: string;
  ageSeconds: number;
}

export interface SignalSnapshot {
  generatedAt: string;
  signals: ObservedSignal[];
  sources: SourceHealth[];
  cache: CacheMetadata[];
}

export interface WeightedValue {
  id: string;
  value: number | null;
  weight?: number;
  confidence?: Confidence;
}

export interface DerivedIndex {
  id: IndexId;
  label: string;
  value: number | null;
  normalized: number | null;
  confidence: Confidence;
  components: string[];
  skippedComponents: string[];
  notes: string;
}
