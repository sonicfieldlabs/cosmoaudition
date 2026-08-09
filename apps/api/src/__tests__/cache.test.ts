import { readdir, readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getSourceDefinition } from "@cosmoaudition/core";
import { loadPayload } from "../adapters/helpers";
import { readCache, writeCache } from "../cache/fsCache";

const originalCacheDir = process.env.COSMOAUDITION_CACHE_DIR;
const originalFetch = globalThis.fetch;
const createdDirectories: string[] = [];

afterEach(async () => {
  globalThis.fetch = originalFetch;
  if (originalCacheDir === undefined) {
    delete process.env.COSMOAUDITION_CACHE_DIR;
  } else {
    process.env.COSMOAUDITION_CACHE_DIR = originalCacheDir;
  }

  await Promise.all(
    createdDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe.sequential("filesystem cache envelopes", () => {
  it("keeps coordinate variants isolated and leaves no partial write", async () => {
    const cacheDir = await createCacheDir();
    const source = getSourceDefinition("open_meteo_local")!;
    const fetchedAt = "2026-07-28T17:10:00.000Z";

    await writeCache(source, { temperature: 20 }, fetchedAt, "lat=4.7110&lon=-74.0721");
    await writeCache(source, { temperature: 8 }, fetchedAt, "lat=51.5072&lon=-0.1276");

    const bogota = await readCache<{ temperature: number }>(
      source,
      new Date(fetchedAt),
      "lat=4.7110&lon=-74.0721"
    );
    const london = await readCache<{ temperature: number }>(
      source,
      new Date(fetchedAt),
      "lat=51.5072&lon=-0.1276"
    );
    const files = await readdir(cacheDir);

    expect(bogota?.payload.temperature).toBe(20);
    expect(london?.payload.temperature).toBe(8);
    expect(files.filter((name) => name.endsWith(".json"))).toHaveLength(2);
    expect(files.some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  it("rejects an envelope whose source id does not match its path", async () => {
    const cacheDir = await createCacheDir();
    const source = getSourceDefinition("carbon_intensity_gb")!;
    const file = join(cacheDir, `${source.id}.json`);
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        sourceId: "different_source",
        variant: "default",
        fetchedAt: "2026-07-28T17:10:00.000Z",
        payload: { actual: 123 }
      })
    );

    const cached = await readCache(source, new Date("2026-07-28T17:10:00.000Z"));
    expect(cached).toBeNull();
    expect((await readFile(file, "utf8")).length).toBeGreaterThan(0);
  });

  it("coalesces identical live loads and serves a fresh cache before refetching", async () => {
    await createCacheDir();
    const source = getSourceDefinition("carbon_intensity_gb")!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    let fetchCount = 0;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      markFetchStarted();
      await gate;
      return new Response(JSON.stringify({ data: [{ intensity: { actual: 123 } }] }), {
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch;
    const options = {
      source,
      context: {
        mode: "live" as const,
        now: new Date("2026-07-29T00:00:00.000Z"),
        latitude: 4.711,
        longitude: -74.0721
      },
      url: "https://api.carbonintensity.org.uk/intensity",
      fixturePath: "carbon-intensity.json"
    };

    const first = loadPayload<Record<string, unknown>>(options);
    const second = loadPayload<Record<string, unknown>>(options);
    await fetchStarted;
    expect(fetchCount).toBe(1);
    release();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.payload).toEqual(secondResult.payload);

    globalThis.fetch = (async () => {
      fetchCount += 1;
      throw new Error("fresh cache should prevent this fetch");
    }) as typeof fetch;
    const cached = await loadPayload<Record<string, unknown>>({
      ...options,
      context: { ...options.context, now: new Date("2026-07-29T00:00:01.000Z") }
    });
    expect(cached.confidence).toBe("medium");
    expect(cached.metadata.hit).toBe(true);
    expect(fetchCount).toBe(1);
  });
});

async function createCacheDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "cosmoaudition-cache-test-"));
  createdDirectories.push(directory);
  process.env.COSMOAUDITION_CACHE_DIR = directory;
  return directory;
}
