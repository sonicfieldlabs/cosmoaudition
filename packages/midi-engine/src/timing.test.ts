import { expect, it } from "vitest";
import { TransportSchedule, type TimingProfile } from "./timing";

const profile: TimingProfile = {
  contract: "cosmo/transport-timing/v1",
  transport: "web-midi",
  deviceRef: "fixture:device",
  clock: "monotonic-ms",
  lateAfterMs: 5,
  horizonMs: 100,
  capacity: 2,
  physicalQualification: "not-run",
};
it("dispatches in order, drops late events and records failure without claiming playback", () => {
  const queue = new TransportSchedule(profile),
    sent: string[] = [];
  queue.enqueue({ id: "late", atMs: 10, payload: [176, 1, 64] }, 0);
  queue.enqueue({ id: "now", atMs: 20, payload: [176, 1, 64] }, 0);
  expect(queue.drain(20, (e) => sent.push(e.id)).map((r) => r.status)).toEqual([
    "late-dropped",
    "dispatched",
  ]);
  expect(sent).toEqual(["now"]);
  queue.enqueue({ id: "broken", atMs: 21, payload: [1] }, 20);
  expect(
    queue.drain(21, () => {
      throw Error("disconnected");
    })[0],
  ).toMatchObject({ status: "failed", claim: "software-dispatch-only" });
});
it("bounds admission and cancellation and rejects a backwards clock", () => {
  const queue = new TransportSchedule(profile);
  queue.enqueue({ id: "one", atMs: 30, payload: [1] }, 10);
  expect(() =>
    queue.enqueue({ id: "one", atMs: 30, payload: [1] }, 10),
  ).toThrow();
  expect(() =>
    queue.enqueue({ id: "two", atMs: 300, payload: [1] }, 10),
  ).toThrow();
  expect(() =>
    queue.enqueue({ id: "two", atMs: 30, payload: [NaN] }, 10),
  ).toThrow();
  expect(queue.cancel(11)[0]!.status).toBe("cancelled");
  expect(
    queue.drain(12, () => {
      throw Error();
    }),
  ).toEqual([]);
  expect(() => queue.drain(1, () => undefined)).toThrow();
});
it("cannot reinterpret the control queue as calibrated audio-rate CV", () => {
  const queue = new TransportSchedule({
    ...profile,
    transport: "cv-audio-rate",
  });
  expect(() => queue.enqueue({ id: "cv", atMs: 1, payload: [1] }, 0)).toThrow(
    /calibration/,
  );
});
