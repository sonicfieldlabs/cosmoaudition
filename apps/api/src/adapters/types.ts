import type {
  ObservationSeries,
  CacheMetadata,
  Confidence,
  ObservedSignal,
  SourceDefinition,
  SourceHealth
} from "@cosmoaudition/core";

export type FetchMode = "live" | "fixture";

export interface AdapterContext {
  mode: FetchMode;
  now: Date;
  latitude: number;
  longitude: number;
}

export interface LoadedPayload<T> {
  payload: T;
  confidence: Confidence;
  fetchedAt: string;
  sourceUrl?: string;
  metadata: CacheMetadata;
  error?: string;
}

export interface AdapterResult {
  series?: ObservationSeries[];
  source: SourceDefinition;
  signals: ObservedSignal[];
  health: SourceHealth;
  cache: CacheMetadata;
}

export interface SourceAdapter {
  sourceId: string;
  read(context: AdapterContext): Promise<AdapterResult>;
}
