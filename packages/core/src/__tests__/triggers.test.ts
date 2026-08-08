import { describe, expect, it } from "vitest";
import { projectSignalTriggers } from "../triggers";
import type { ObservedSignal } from "../types";

function signal(overrides: Partial<ObservedSignal> = {}): ObservedSignal {
  return {
    id: "event-signal",
    label: "Event signal",
    layer: "address",
    unit: "unit",
    value: 12,
    normalized: 0.75,
    timestamp: "2026-07-29T00:00:00.000Z",
    sourceId: "test-source",
    confidence: "high",
    staleAfterSeconds: 60,
    temporalCharacter: "event",
    ...overrides
  };
}

describe("stable event trigger projection", () => {
  it("projects a stable event once and preserves bounded evidence", () => {
    const first = projectSignalTriggers(
      [signal({ eventKey: "provider:event:1" })],
      new Set(),
      new Date("2026-07-29T00:00:01.000Z")
    );
    const repeated = projectSignalTriggers(
      [signal({ eventKey: "provider:event:1" })],
      first.seenEventKeys,
      new Date("2026-07-29T00:00:02.000Z")
    );

    expect(first.triggers).toHaveLength(1);
    expect(first.triggers[0]).toMatchObject({
      eventKey: "provider:event:1",
      normalized: 0.75,
      signalId: "event-signal",
      sourceId: "test-source"
    });
    expect(repeated.triggers).toEqual([]);
  });

  it("never promotes an unkeyed aggregate, source error, or stale event into a trigger", () => {
    const projected = projectSignalTriggers([
      signal({ id: "aggregate", temporalCharacter: "aggregate", value: 300 }),
      signal({ id: "error", eventKey: "provider:event:2", confidence: "error" }),
      signal({ id: "stale", eventKey: "provider:event:3", confidence: "stale" })
    ]);

    expect(projected.triggers).toEqual([]);
  });

  it("bounds trigger history deterministically", () => {
    const projected = projectSignalTriggers(
      [signal({ eventKey: "event:3" })],
      new Set(["event:1", "event:2"]),
      new Date("2026-07-29T00:00:01.000Z"),
      2
    );

    expect([...projected.seenEventKeys]).toEqual(["event:2", "event:3"]);
  });

  it("does not let a fast event family evict another family's history", () => {
    // A local generator can emit thousands of keys an hour. Under plain
    // oldest-first eviction it would push out a still-current earthquake key,
    // and that earthquake would re-trigger as though it were new.
    let history = new Set<string>(["usgs-earthquake:quake-a"]);
    for (let cycle = 0; cycle < 40; cycle += 1) {
      history = projectSignalTriggers(
        [
          signal({
            id: "local_pulse_gate",
            sourceId: "local_modulation_bank",
            eventKey: `local_pulse_gate:origin:1:cycle:${cycle}`
          })
        ],
        history,
        new Date("2026-07-29T00:00:00.000Z"),
        8
      ).seenEventKeys;
    }

    expect(history.size).toBeLessThanOrEqual(8);
    expect(history.has("usgs-earthquake:quake-a")).toBe(true);

    // And the earthquake therefore still deduplicates rather than re-firing.
    const replay = projectSignalTriggers(
      [signal({ eventKey: "usgs-earthquake:quake-a" })],
      history,
      new Date("2026-07-29T00:00:00.000Z"),
      8
    );
    expect(replay.triggers).toHaveLength(0);
  });
});
