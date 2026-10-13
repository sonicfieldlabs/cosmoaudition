/** Bounded monotonic transport schedule; receipts describe dispatch, never audibility. */
export interface TimingProfile {
  contract: "cosmo/transport-timing/v1";
  transport: "web-midi" | "osc" | "cv-audio-rate";
  deviceRef: string;
  clock: "monotonic-ms";
  lateAfterMs: number;
  horizonMs: number;
  capacity: number;
  physicalQualification: "not-run" | "operator-qualified";
}
export interface TimedEvent {
  id: string;
  atMs: number;
  payload: readonly number[];
}
export interface TimingReceipt {
  id: string;
  status: "dispatched" | "late-dropped" | "cancelled" | "failed";
  scheduledMs: number;
  observedMs: number;
  latenessMs: number;
  claim: "software-dispatch-only";
}

export class TransportSchedule {
  readonly #profile: TimingProfile;
  readonly #queue = new Map<string, TimedEvent>();
  #lastClock = -Infinity;
  constructor(profile: TimingProfile) {
    if (
      profile.contract !== "cosmo/transport-timing/v1" ||
      profile.clock !== "monotonic-ms" ||
      !["web-midi", "osc", "cv-audio-rate"].includes(profile.transport) ||
      !/^[A-Za-z0-9:_-]{1,128}$/.test(profile.deviceRef) ||
      !Number.isInteger(profile.capacity) ||
      profile.capacity < 1 ||
      profile.capacity > 256 ||
      !Number.isFinite(profile.lateAfterMs) ||
      profile.lateAfterMs < 0 ||
      profile.lateAfterMs > 1000 ||
      !Number.isFinite(profile.horizonMs) ||
      profile.horizonMs < 1 ||
      profile.horizonMs > 10000 ||
      !["not-run", "operator-qualified"].includes(profile.physicalQualification)
    )
      throw new RangeError("Invalid timing profile.");
    this.#profile = { ...profile };
  }
  #clock(nowMs: number): void {
    if (!Number.isFinite(nowMs) || nowMs < 0 || nowMs < this.#lastClock)
      throw new RangeError("Monotonic clock moved backwards.");
    this.#lastClock = nowMs;
  }
  enqueue(event: TimedEvent, nowMs: number): void {
    this.#clock(nowMs);
    if (this.#profile.transport === "cv-audio-rate")
      throw new RangeError(
        "CV requires a separately qualified sample clock, DAC and voltage calibration; this control scheduler cannot emit it.",
      );
    if (
      !/^[A-Za-z0-9:_-]{1,128}$/.test(event.id) ||
      this.#queue.has(event.id) ||
      this.#queue.size >= this.#profile.capacity ||
      !Number.isFinite(event.atMs) ||
      event.atMs < nowMs ||
      event.atMs > nowMs + this.#profile.horizonMs ||
      !Array.isArray(event.payload) ||
      event.payload.length < 1 ||
      event.payload.length > 1024 ||
      event.payload.some((b) => !Number.isInteger(b) || b < 0 || b > 255)
    )
      throw new RangeError("Event admission refused.");
    this.#queue.set(event.id, { ...event, payload: [...event.payload] });
  }
  drain(nowMs: number, send: (event: TimedEvent) => void): TimingReceipt[] {
    this.#clock(nowMs);
    const receipts: TimingReceipt[] = [];
    for (const event of [...this.#queue.values()].sort(
      (a, b) => a.atMs - b.atMs || a.id.localeCompare(b.id),
    )) {
      if (event.atMs > nowMs) continue;
      this.#queue.delete(event.id);
      let status: TimingReceipt["status"] = "late-dropped";
      if (nowMs - event.atMs <= this.#profile.lateAfterMs) {
        try {
          send(event);
          status = "dispatched";
        } catch {
          status = "failed";
        }
      }
      receipts.push({
        id: event.id,
        status,
        scheduledMs: event.atMs,
        observedMs: nowMs,
        latenessMs: nowMs - event.atMs,
        claim: "software-dispatch-only",
      });
    }
    return receipts;
  }
  cancel(nowMs: number): TimingReceipt[] {
    this.#clock(nowMs);
    const result = [...this.#queue.values()].map((event) => ({
      id: event.id,
      status: "cancelled" as const,
      scheduledMs: event.atMs,
      observedMs: nowMs,
      latenessMs: Math.max(0, nowMs - event.atMs),
      claim: "software-dispatch-only" as const,
    }));
    this.#queue.clear();
    return result;
  }
}
