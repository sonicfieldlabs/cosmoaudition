import { afterEach, describe, expect, it } from "vitest";
import { fetchJson } from "../adapters/http";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe.sequential("bounded provider HTTP", () => {
  it("rejects non-JSON responses, oversized bodies, and invalid UTF-8", async () => {
    globalThis.fetch = (async () =>
      new Response("plain", { headers: { "content-type": "text/plain" } })) as typeof fetch;
    await expect(fetchJson("https://provider.invalid/plain", { timeoutMs: 1000 }))
      .rejects.toThrow(/content type/);

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ value: "too-large" }), {
        headers: { "content-type": "application/json", "content-length": "100" }
      })) as typeof fetch;
    await expect(
      fetchJson("https://provider.invalid/large", { timeoutMs: 1000, maxBytes: 16 })
    ).rejects.toThrow(/16-byte limit/);

    globalThis.fetch = (async () =>
      new Response(new Uint8Array([0xff]), {
        headers: { "content-type": "application/json" }
      })) as typeof fetch;
    await expect(fetchJson("https://provider.invalid/utf8", { timeoutMs: 1000 }))
      .rejects.toThrow(/UTF-8/);
  });

  it("serializes requests that share a provider concurrency key", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    let active = 0;
    let maximumActive = 0;
    globalThis.fetch = (async () => {
      const call = ++calls;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (call === 1) await firstGate;
      active -= 1;
      return new Response(JSON.stringify({ call }), {
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch;

    const first = fetchJson("https://provider.invalid/one", {
      timeoutMs: 1000,
      concurrencyKey: "shared-provider"
    });
    const second = fetchJson("https://provider.invalid/two", {
      timeoutMs: 1000,
      concurrencyKey: "shared-provider"
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(calls).toBe(1);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { call: 1 },
      { call: 2 }
    ]);
    expect(maximumActive).toBe(1);
  });
});
