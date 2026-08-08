import type { Confidence, EpistemicStatus, ObservedSignal, TemporalCharacter } from "./types";

export interface SignalTrigger {
  id: string;
  eventKey: string;
  signalId: string;
  sourceId: string;
  occurredAt: string;
  projectedAt: string;
  value: number;
  normalized: number | null;
  unit: string;
  confidence: Confidence;
  epistemicStatus?: EpistemicStatus;
  temporalCharacter?: TemporalCharacter;
  claimBoundary: string;
}

export interface TriggerProjection {
  triggers: SignalTrigger[];
  seenEventKeys: Set<string>;
}

export const MAX_TRIGGER_HISTORY = 4096;

/**
 * The family an event key belongs to, taken from its stable prefix.
 * `local_pulse_gate:…` and `usgs-earthquake:…` are different families.
 */
function eventFamily(key: string): string {
  const separator = key.indexOf(":");
  return separator < 0 ? key : key.slice(0, separator);
}

/**
 * Bound the deduplication history without letting one fast event family push
 * out another's keys.
 *
 * Plain oldest-first eviction is unfair here: the local pulse generator can
 * emit thousands of keys an hour, so it would evict a still-current
 * earthquake or close-approach key, and that event would then re-trigger as
 * though it were new — exactly the duplicate this history exists to prevent.
 * Evicting from the largest family instead makes a noisy family consume its
 * own budget.
 */
function evictFairly(keys: Set<string>, maxHistory: number): void {
  if (keys.size <= maxHistory) return;

  const counts = new Map<string, number>();
  for (const key of keys) {
    const family = eventFamily(key);
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }

  while (keys.size > maxHistory) {
    let largestFamily: string | undefined;
    let largestCount = 0;
    for (const [family, count] of counts) {
      if (count > largestCount) {
        largestFamily = family;
        largestCount = count;
      }
    }
    if (largestFamily === undefined) return;

    // Sets preserve insertion order, so the first match is that family's oldest.
    let removed = false;
    for (const key of keys) {
      if (eventFamily(key) === largestFamily) {
        keys.delete(key);
        counts.set(largestFamily, largestCount - 1);
        removed = true;
        break;
      }
    }
    if (!removed) return;
  }
}

/**
 * Project only stable, explicitly keyed events. Aggregate counts and changing
 * values never become event triggers merely because they are non-zero.
 */
export function projectSignalTriggers(
  signals: readonly ObservedSignal[],
  previouslySeen: ReadonlySet<string> = new Set(),
  projectedAt: Date = new Date(),
  maxHistory = MAX_TRIGGER_HISTORY
): TriggerProjection {
  if (!Number.isFinite(projectedAt.getTime())) {
    throw new RangeError("Trigger projection time must be valid.");
  }
  if (!Number.isInteger(maxHistory) || maxHistory < 1 || maxHistory > 65_536) {
    throw new RangeError("Trigger history boundary must be an integer inside 1..65536.");
  }
  // Copying the whole history every call is wasteful at interactive rates, and
  // this runs many times per second. Only materialize an array when the
  // history actually exceeds its bound and needs trimming.
  const seenEventKeys =
    previouslySeen.size > maxHistory
      ? new Set([...previouslySeen].slice(-maxHistory))
      : new Set(previouslySeen);
  const triggers: SignalTrigger[] = [];

  for (const signal of signals) {
    const eventKey = signal.eventKey?.trim();
    if (
      !eventKey ||
      seenEventKeys.has(eventKey) ||
      signal.value === null ||
      !Number.isFinite(signal.value) ||
      signal.confidence === "error" ||
      signal.confidence === "stale"
    ) {
      continue;
    }
    seenEventKeys.add(eventKey);
    evictFairly(seenEventKeys, maxHistory);
    triggers.push({
      id: `cosmo-trigger:${encodeURIComponent(eventKey)}`,
      eventKey,
      signalId: signal.id,
      sourceId: signal.sourceId,
      occurredAt: signal.timestamp,
      projectedAt: projectedAt.toISOString(),
      value: signal.value,
      normalized:
        signal.normalized !== null && Number.isFinite(signal.normalized)
          ? Math.min(1, Math.max(0, signal.normalized))
          : null,
      unit: signal.unit,
      confidence: signal.confidence,
      ...(signal.epistemicStatus
        ? { epistemicStatus: signal.epistemicStatus }
        : {}),
      ...(signal.temporalCharacter
        ? { temporalCharacter: signal.temporalCharacter }
        : {}),
      claimBoundary:
        "This is a deduplicated control trigger projected from a stable event key; it is not the event itself and does not prove that an external receiver acted or sounded."
    });
  }

  return { triggers, seenEventKeys };
}
