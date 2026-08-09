import { afterEach, describe, expect, it } from "vitest";
import { fetchJson } from "../adapters/http";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe.sequential("bounded provider HTTP", () => {
  it("refuses non-HTTPS and non-public provider targets before fetching", async () => {
    let fetchCount = 0;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      return new Response("{}", {
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch;

    const blocked = [
      "http://provider.invalid/data",
      "https://./data",
      "https://localhost./data",
      "https://127.0.0.1/data",
      "https://192.88.99.2/data",
      "https://[::127.0.0.1]/data",
      "https://[::192.168.1.1]/data",
      "https://[::ffff:127.0.0.1]/data",
      "https://[100:0:0:1::1]/data",
      "https://[3fff::1]/data",
      "https://[5f00::1]/data",
      "https://[fe90::1]/data",
      "https://[fec0::1]/data",
      "https://provider.invalid/data",
      "https://user:password@api.open-meteo.com/data"
    ];

    for (const url of blocked) {
      await expect(fetchJson(url, { timeoutMs: 1000 })).rejects.toThrow();
    }
    expect(fetchCount).toBe(0);
  });

  it("revalidates every redirect before following it", async () => {
    let fetchCount = 0;
    let redirectBodyCancelled = false;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      return new Response(
        new ReadableStream({
          cancel() {
            redirectBodyCancelled = true;
          }
        }),
        {
          status: 302,
          headers: { location: "https://[::ffff:127.0.0.1]/private" }
        }
      );
    }) as typeof fetch;

    await expect(
      fetchJson("https://api.open-meteo.com/start", { timeoutMs: 1000 })
    ).rejects.toThrow(/non-public/);
    expect(fetchCount).toBe(1);
    expect(redirectBodyCancelled).toBe(true);
  });

  it("rejects invalid timeout and response-size boundaries", async () => {
    await expect(
      fetchJson("https://api.open-meteo.com/data", { timeoutMs: 0 })
    ).rejects.toThrow(/timeout/);
    await expect(
      fetchJson("https://api.open-meteo.com/data", {
        timeoutMs: 1000,
        maxBytes: 0
      })
    ).rejects.toThrow(/response limit/);
  });

  it("rejects non-JSON responses, oversized bodies, and invalid UTF-8", async () => {
    globalThis.fetch = (async () =>
      new Response("plain", { headers: { "content-type": "text/plain" } })) as typeof fetch;
    await expect(fetchJson("https://api.open-meteo.com/plain", { timeoutMs: 1000 }))
      .rejects.toThrow(/content type/);

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ value: "too-large" }), {
        headers: { "content-type": "application/json", "content-length": "100" }
      })) as typeof fetch;
    await expect(
      fetchJson("https://api.open-meteo.com/large", { timeoutMs: 1000, maxBytes: 16 })
    ).rejects.toThrow(/16-byte limit/);

    globalThis.fetch = (async () =>
      new Response(new Uint8Array([0xff]), {
        headers: { "content-type": "application/json" }
      })) as typeof fetch;
    await expect(fetchJson("https://api.open-meteo.com/utf8", { timeoutMs: 1000 }))
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

    const first = fetchJson("https://api.open-meteo.com/one", {
      timeoutMs: 1000,
      concurrencyKey: "shared-provider"
    });
    const second = fetchJson("https://api.open-meteo.com/two", {
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
