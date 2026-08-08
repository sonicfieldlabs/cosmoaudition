import {
  nullableLinearNormalize,
  nullableLogNormalize,
  type ObservedSignal,
  type SourceHealth
} from "@cosmoaudition/core";

export type SnapshotMode = "fixture" | "live" | "archive";

export interface ApiSnapshot {
  generatedAt: string;
  mode: SnapshotMode;
  /**
   * The acquisition mode of a replayed observation. Present when `mode`
   * describes a replay (`archive`) rather than an acquisition, so fixture
   * provenance survives into exported MASA records.
   */
  originMode?: SnapshotMode;
  selectedSourceIds?: string[];
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  signals: ObservedSignal[];
  sources: SourceHealth[];
  cache?: unknown[];
  indices?: unknown[];
  masaRecord?: unknown;
  masa?: {
    masaVersion: string;
    recordId: string;
    profiles: string[];
    valid: true;
    mediaType: string;
    href: string;
  };
  masaValidation?: {
    valid: boolean;
    errors?: string[];
  };
}

function createBrowserLatencySignal(latencyMs: number): ObservedSignal {
  return {
    id: "browser_fetch_latency",
    label: "Browser fetch latency",
    layer: "interface",
    unit: "ms",
    value: latencyMs,
    normalized: nullableLogNormalize(latencyMs, [10, 3000]),
    timestamp: new Date().toISOString(),
    sourceId: "browser_fetch_latency",
    confidence: "high",
    staleAfterSeconds: 30,
    notes: "Measured locally in the browser; not sent to the server."
  };
}

export function createBrowserSessionSignals(
  latencyMs: number,
  sampleRate: number | null
): ObservedSignal[] {
  const now = new Date();
  const minuteOfDay = now.getHours() * 60 + now.getMinutes();
  const viewportArea =
    typeof window === "undefined" ? null : window.innerWidth * window.innerHeight;

  return [
    createBrowserLatencySignal(latencyMs),
    {
      id: "browser_local_time",
      label: "Browser local time",
      layer: "interface",
      unit: "minute-of-day",
      value: minuteOfDay,
      normalized: nullableLinearNormalize(minuteOfDay, [0, 1439]),
      timestamp: now.toISOString(),
      sourceId: "browser_local_time",
      confidence: "high",
      staleAfterSeconds: 60,
      notes: "Derived locally from the browser clock; not sent to the server."
    },
    {
      id: "browser_window_size",
      label: "Browser viewport area",
      layer: "interface",
      unit: "CSS-pixels²",
      value: viewportArea,
      normalized: nullableLogNormalize(viewportArea, [102_400, 8_294_400]),
      timestamp: now.toISOString(),
      sourceId: "browser_window_size",
      confidence: viewportArea === null ? "error" : "high",
      staleAfterSeconds: 5,
      notes: "Measured locally for responsive instrument state; never persisted in public records."
    },
    {
      id: "browser_audio_context",
      label: "Browser audio sample rate",
      layer: "interface",
      unit: "Hz",
      value: sampleRate,
      normalized: nullableLinearNormalize(sampleRate, [22_050, 96_000]),
      timestamp: now.toISOString(),
      sourceId: "browser_audio_context",
      confidence: sampleRate === null ? "low" : "high",
      staleAfterSeconds: 60,
      notes:
        sampleRate === null
          ? "Unknown until the listening engine starts after a user gesture."
          : "Reported by the local Web Audio context."
    }
  ];
}
