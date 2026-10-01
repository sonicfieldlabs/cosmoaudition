import { parseAbsoluteTime } from "./time";
import type { ObservedSignal } from "./types";

export interface FreshnessContext { now?: string; mode?: string }
export interface SignalFreshness {
  status: "current" | "stale" | "expired" | "unknown";
  reason: "within-age-limit" | "source-stale" | "source-error" | "age-limit-exceeded" | "future-source-time" | "invalid-clock-or-age-limit" | "fixture" | "archive" | "unknown-mode";
  evaluatedAt: string;
  sourceTimestamp: string;
  expiresAt?: string;
  ageSeconds?: number;
  mappingAllowed: boolean;
}

/** A transport receipt is not an observation clock. Never refresh source time. */
export function evaluateSignalFreshness(signal: ObservedSignal, context: FreshnessContext = {}): SignalFreshness {
  const evaluatedAt = context.now ?? new Date().toISOString();
  const mode = context.mode ?? signal.acquisitionMode ?? "live";
  const base = { evaluatedAt, sourceTimestamp: signal.timestamp };
  const deny = (status: SignalFreshness["status"], reason: SignalFreshness["reason"]): SignalFreshness => ({ ...base, status, reason, mappingAllowed: false });
  if (mode === "archive") return deny("unknown", "archive");
  if (mode !== "live" && mode !== "fixture") return deny("unknown", "unknown-mode");
  if (signal.confidence === "error") return deny("unknown", "source-error");
  if (signal.confidence === "stale") return deny("stale", "source-stale");
  // Fixture clocks belong to the simulation, never to current provider evidence.
  if (mode === "fixture") return { ...base, status: "unknown", reason: "fixture", mappingAllowed: true };
  const now = parseAbsoluteTime(evaluatedAt);
  const observed = parseAbsoluteTime(signal.timestamp);
  const limit = signal.staleAfterSeconds;
  if (now === null || observed === null || !Number.isFinite(limit) || limit < 0) return deny("unknown", "invalid-clock-or-age-limit");
  if (observed > now) return deny("unknown", "future-source-time");
  const expiry = observed + limit * 1000;
  if (!Number.isFinite(expiry) || Math.abs(expiry) > 8.64e15) return deny("unknown", "invalid-clock-or-age-limit");
  const expired = now >= expiry;
  return { ...base, status: expired ? "expired" : "current", reason: expired ? "age-limit-exceeded" : "within-age-limit", ageSeconds: (now - observed) / 1000, expiresAt: new Date(expiry).toISOString(), mappingAllowed: !expired };
}
