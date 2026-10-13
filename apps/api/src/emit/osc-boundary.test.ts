import { expect, it } from "vitest";
import { encodeOscMessage } from "./osc";

it("never turns absence or invalid floats into a control zero", () => {
  for (const number of [NaN, Infinity, -Infinity, 1e39])
    expect(() => encodeOscMessage("/test", [number])).toThrow();
  expect(() => encodeOscMessage("/test\0injected", [0])).toThrow();
  expect(() => encodeOscMessage("/test", ["x\0y"])).toThrow();
  expect(encodeOscMessage("/test", [0]).length).toBeGreaterThan(0);
});
