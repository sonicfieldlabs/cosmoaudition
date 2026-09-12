/** Bounded provider observations, never an implied uniformly sampled waveform. */
export interface ObservationSeries {
  contract: "cosmo/observation-series/v1";
  sourceId: string;
  seriesId: string;
  unit: string;
  fetchedAt: string;
  sourceUrl: string;
  mode: "live" | "fixture";
  status: "available" | "stale" | "unavailable";
  cadence: "monthly" | "latest-point";
  normalizationVersion: "0.3.0";
  provenanceHash: string;
  attribution: string;
  coverage: string;
  points: {
    timestamp: string;
    intervalEnd: string | null;
    value: number | null;
    status: "reported" | "missing";
    quality: string;
  }[];
}
