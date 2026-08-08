import { describe, expect, it } from "vitest";
import { MODULATION_CONTRACT } from "@cosmoaudition/core";
import { app } from "../app";
import { encodeOscMessage, oscInteger } from "../emit/osc";
import { oscAddressSegment } from "../emit/frameEmitter";

describe("modulation framework surface", () => {
  it("describes the contract and its mapping catalog", async () => {
    const response = await app.request("/api/modulation");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      contract: string;
      mappings: Array<{ target: string; epistemicNote: string }>;
    };

    expect(body.contract).toBe(MODULATION_CONTRACT);
    expect(body.mappings.length).toBeGreaterThan(0);
    expect(body.mappings.every((mapping) => mapping.epistemicNote.length > 0)).toBe(true);
  });

  it("serves one fixture frame whose values all carry a control status", async () => {
    const response = await app.request("/api/frame?mode=fixture");
    expect(response.status).toBe(200);
    const frame = (await response.json()) as {
      contract: string;
      controls: Array<{ target: string; status: string; outputValue: number | null }>;
      absences: Array<{ target: string; reason: string }>;
      values: Record<string, number>;
      attribution: Array<{ licenseNote: string }>;
    };

    expect(frame.contract).toBe(MODULATION_CONTRACT);
    for (const [target, value] of Object.entries(frame.values)) {
      const control = frame.controls.find((item) => item.target === target);
      expect(control?.outputValue).toBe(value);
      expect(control?.status).toBeDefined();
    }
    for (const absence of frame.absences) {
      expect(frame.values[absence.target]).toBeUndefined();
    }
    expect(frame.attribution.every((item) => item.licenseNote.length > 0)).toBe(true);
  });

  it("refuses a stream cadence faster than provider acquisition", async () => {
    const tooFast = await app.request("/api/stream?mode=fixture&intervalMs=100");
    expect(tooFast.status).toBe(400);

    const malformed = await app.request("/api/stream?mode=fixture&intervalMs=abc");
    expect(malformed.status).toBe(400);
  });

  it("streams a frame event over SSE and stops when the consumer aborts", async () => {
    const controller = new AbortController();
    const response = await app.request(
      "/api/stream?mode=fixture&intervalMs=600000",
      { signal: controller.signal }
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let received = "";
    while (!received.includes("event: frame")) {
      const { done, value } = await reader.read();
      if (done) break;
      received += decoder.decode(value, { stream: true });
    }

    expect(received).toContain("event: frame");
    expect(received).toContain(MODULATION_CONTRACT);
    await reader.cancel();
    controller.abort();
  });
});

describe("OSC encoding", () => {
  it("encodes an address, type tags, and a float on four-byte boundaries", () => {
    const message = encodeOscMessage("/cosmo/control/test", [0.5]);

    // Every OSC element is null-terminated and padded to a 4-byte boundary.
    expect(message.length % 4).toBe(0);
    expect(message.subarray(0, 19).toString("utf8")).toBe("/cosmo/control/test");
    expect(message.readFloatBE(message.length - 4)).toBeCloseTo(0.5, 6);
    // "/cosmo/control/test" is 19 bytes, so it pads to 20; ",f" pads to 4.
    expect(message.subarray(20, 24).toString("utf8").replace(/\0+$/, "")).toBe(",f");
  });

  it("pads a string whose length is already a multiple of four", () => {
    // OSC requires a terminating null even when the length already aligns, so
    // an 8-character address must occupy 12 bytes, not 8.
    const message = encodeOscMessage("/abcdefg");
    expect(message.subarray(0, 12).length).toBe(12);
    expect(message[8]).toBe(0);
    expect(message.length % 4).toBe(0);
  });

  it("keeps a control address at one argument type across frames", () => {
    // Choosing int-vs-float from whether a value happens to be integral would
    // make one address change type between frames and break fixed-type
    // receivers, so plain numbers are always float32.
    const integral = encodeOscMessage("/cosmo/control/x", [3]);
    const fractional = encodeOscMessage("/cosmo/control/x", [3.5]);
    expect(integral.length).toBe(fractional.length);
    expect(integral.toString("utf8")).toContain(",f");
    expect(integral.readFloatBE(integral.length - 4)).toBeCloseTo(3, 6);
  });

  it("encodes strings and explicit integers with their own type tags", () => {
    const message = encodeOscMessage("/cosmo/status/x", ["applied", oscInteger(3)]);
    const text = message.toString("utf8");
    expect(text).toContain(",si");
    expect(text).toContain("applied");
    expect(message.readInt32BE(message.length - 4)).toBe(3);
    expect(() => oscInteger(1.5)).toThrow(/32-bit signed integer/);
  });

  it("refuses an address that is not an OSC path", () => {
    expect(() => encodeOscMessage("cosmo/control")).toThrow(/must begin with/);
  });

  it("maps a dotted target onto an OSC path without collapsing distinct targets", () => {
    expect(oscAddressSegment("synth.filter.cutoff")).toBe("synth/filter/cutoff");
    // Distinct unsafe characters must not merge two controls onto one address.
    expect(oscAddressSegment("a.b*c")).not.toBe(oscAddressSegment("a.b?c"));
    expect(oscAddressSegment("a.b_c")).not.toBe(oscAddressSegment("a.b c"));
    // Every emitted address is legal OSC: no reserved pattern characters.
    for (const target of ["synth.filter.cutoff", "a.b*c", "material.delay time"]) {
      expect(oscAddressSegment(target)).toMatch(/^[A-Za-z0-9_/-]+$/);
    }
  });
});
