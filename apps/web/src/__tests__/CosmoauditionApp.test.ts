import { describe, expect, it } from "vitest";
import { shouldEmitAudibleTriggers } from "../CosmoauditionApp";

describe("Cosmoaudition output arming", () => {
  it("requires both continuous audio and event-trigger outputs for audible pulses", () => {
    expect(shouldEmitAudibleTriggers(true, true)).toBe(true);
    expect(shouldEmitAudibleTriggers(true, false)).toBe(false);
    expect(shouldEmitAudibleTriggers(false, true)).toBe(false);
    expect(shouldEmitAudibleTriggers(false, false)).toBe(false);
  });
});
