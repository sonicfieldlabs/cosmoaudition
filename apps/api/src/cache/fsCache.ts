import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import type { CacheMetadata, SourceDefinition } from "@cosmoaudition/core";

interface CacheEntry<T> {
  version: 1;
  sourceId: string;
  variant: string;
  fetchedAt: string;
  payload: T;
}

export interface CachedPayload<T> {
  payload: T;
  metadata: CacheMetadata;
  stale: boolean;
}

function findWorkspaceRoot(): string {
  const candidates = [
    process.env.INIT_CWD,
    process.cwd(),
    path.resolve(process.cwd(), "../..")
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    let current = candidate;

    for (let depth = 0; depth < 6; depth += 1) {
      if (existsSync(path.join(current, "pnpm-workspace.yaml"))) {
        return current;
      }

      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }

  return process.cwd();
}

const workspaceRoot = findWorkspaceRoot();

function getCacheDir(): string {
  return (
    process.env.COSMOAUDITION_CACHE_DIR ??
    path.join(workspaceRoot, "data/cache")
  );
}

function getMockDir(): string {
  return (
    process.env.COSMOAUDITION_MOCK_DIR ??
    path.join(workspaceRoot, "data/mock")
  );
}

const DEFAULT_VARIANT = "default";
const MAX_CACHE_FILE_BYTES = 16 * 1024 * 1024;
/**
 * Parameterized variants (per-coordinate weather, for example) each get their
 * own file, so the directory needs its own ceiling. Beyond this count the
 * oldest variant files are evicted before a new one is written.
 */
const MAX_CACHE_FILES = 256;

function assertSafeSourceId(sourceId: string): void {
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(sourceId)) {
    throw new Error("Cache source id contains unsupported path characters.");
  }
}

function normalizeVariant(variant: string | undefined): string {
  const normalized = variant?.trim();
  return normalized ? normalized : DEFAULT_VARIANT;
}

function variantDigest(variant: string): string {
  return createHash("sha256").update(variant).digest("hex").slice(0, 16);
}

function sourceCachePath(sourceId: string, variant: string): string {
  assertSafeSourceId(sourceId);
  if (variant === DEFAULT_VARIANT) {
    return path.join(getCacheDir(), `${sourceId}.json`);
  }

  return path.join(getCacheDir(), `${sourceId}--${variantDigest(variant)}.json`);
}

/**
 * Clock skew tolerated before a cache entry stamped in the future is treated
 * as unusable rather than eternally fresh.
 */
const MAX_FUTURE_CACHE_SKEW_SECONDS = 120;

function createMetadata(
  source: SourceDefinition,
  cacheKey: string,
  hit: boolean,
  fetchedAt: string,
  now: Date
): CacheMetadata {
  const fetchedTime = Date.parse(fetchedAt);
  const rawAgeSeconds = Number.isNaN(fetchedTime)
    ? 0
    : Math.floor((now.getTime() - fetchedTime) / 1000);
  const ageSeconds = Math.max(0, rawAgeSeconds);
  const staleAt = new Date(fetchedTime + source.ttlSeconds * 1000).toISOString();

  return {
    sourceId: source.id,
    cacheKey,
    hit,
    fetchedAt,
    expiresAt: staleAt,
    staleAt,
    ageSeconds
  };
}

export async function readCache<T>(
  source: SourceDefinition,
  now: Date,
  variant?: string
): Promise<CachedPayload<T> | null> {
  try {
    const normalizedVariant = normalizeVariant(variant);
    const cachePath = sourceCachePath(source.id, normalizedVariant);
    const file = await stat(cachePath);
    if (!file.isFile() || file.size > MAX_CACHE_FILE_BYTES) return null;
    const raw = await readFile(cachePath, "utf8");
    const entry = parseCacheEntry<T>(
      JSON.parse(raw),
      source.id,
      normalizedVariant
    );
    if (entry === null) {
      return null;
    }

    const metadata = createMetadata(
      source,
      `cache:${source.id}:${normalizedVariant}`,
      true,
      entry.fetchedAt,
      now
    );

    // An entry stamped in the future (clock jump, hand-edited or pre-seeded
    // file) would otherwise clamp to age zero and stay fresh forever, so the
    // provider would never be contacted again. Treat it as stale instead.
    const futureStamped =
      Math.floor((now.getTime() - Date.parse(entry.fetchedAt)) / 1000) <
      -MAX_FUTURE_CACHE_SKEW_SECONDS;

    return {
      payload: entry.payload,
      metadata,
      stale: futureStamped || metadata.ageSeconds > source.ttlSeconds
    };
  } catch {
    return null;
  }
}

export async function writeCache<T>(
  source: SourceDefinition,
  payload: T,
  fetchedAt: string,
  variant?: string
): Promise<CacheMetadata> {
  const normalizedVariant = normalizeVariant(variant);
  if (Number.isNaN(Date.parse(fetchedAt))) {
    throw new Error(`Cannot cache ${source.id}: fetchedAt is not a valid timestamp.`);
  }

  await mkdir(getCacheDir(), { recursive: true });
  await evictExcessCacheFiles();
  const entry: CacheEntry<T> = {
    version: 1,
    sourceId: source.id,
    variant: normalizedVariant,
    fetchedAt,
    payload
  };
  const finalPath = sourceCachePath(source.id, normalizedVariant);
  const temporaryPath = `${finalPath}.${process.pid}.${randomUUID()}.tmp`;
  const serialized = JSON.stringify(entry, null, 2);
  if (Buffer.byteLength(serialized, "utf8") > MAX_CACHE_FILE_BYTES) {
    throw new Error(`Cannot cache ${source.id}: serialized payload exceeds the local cache limit.`);
  }

  try {
    await writeFile(temporaryPath, serialized, {
      encoding: "utf8",
      flag: "wx"
    });
    await rename(temporaryPath, finalPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }

  return createMetadata(
    source,
    `live:${source.id}:${normalizedVariant}`,
    false,
    fetchedAt,
    new Date(fetchedAt)
  );
}

/**
 * Keep the cache directory bounded. Variant files are keyed by request
 * parameters, so without eviction a loop over coordinates could fill the disk
 * one bounded file at a time. Oldest modification times go first.
 */
async function evictExcessCacheFiles(): Promise<void> {
  try {
    const directory = getCacheDir();
    const names = (await readdir(directory)).filter((name) => name.endsWith(".json"));
    if (names.length < MAX_CACHE_FILES) {
      return;
    }
    const described = await Promise.all(
      names.map(async (name) => {
        const filePath = path.join(directory, name);
        try {
          const info = await stat(filePath);
          return { filePath, modifiedAt: info.mtimeMs };
        } catch {
          return null;
        }
      })
    );
    const present = described.filter(
      (item): item is { filePath: string; modifiedAt: number } => item !== null
    );
    present.sort((left, right) => left.modifiedAt - right.modifiedAt);
    const removeCount = present.length - MAX_CACHE_FILES + 1;
    for (const item of present.slice(0, Math.max(0, removeCount))) {
      await unlink(item.filePath).catch(() => undefined);
    }
  } catch {
    // A cache directory that cannot be listed is not a reason to refuse a
    // provider write; the per-file and per-entry bounds still apply.
  }
}

export async function readFixture<T>(
  source: SourceDefinition,
  fixtureRelativePath: string,
  now: Date,
  variant?: string
): Promise<CachedPayload<T>> {
  const mockRoot = path.resolve(getMockDir());
  const fixturePath = path.resolve(mockRoot, fixtureRelativePath);
  if (!fixturePath.startsWith(`${mockRoot}${path.sep}`)) {
    throw new Error("Fixture path escapes the configured mock directory.");
  }
  const file = await stat(fixturePath);
  if (!file.isFile() || file.size > MAX_CACHE_FILE_BYTES) {
    throw new Error("Fixture is not a bounded regular file.");
  }
  const raw = await readFile(fixturePath, "utf8");
  const payload = JSON.parse(raw) as T;
  const fetchedAt = now.toISOString();
  const normalizedVariant = normalizeVariant(variant);

  return {
    payload,
    metadata: createMetadata(
      source,
      `fixture:${fixtureRelativePath}:${normalizedVariant}`,
      true,
      fetchedAt,
      now
    ),
    stale: false
  };
}

function parseCacheEntry<T>(
  value: unknown,
  expectedSourceId: string,
  expectedVariant: string
): CacheEntry<T> | null {
  if (!isRecord(value)) {
    return null;
  }

  const version = value.version;
  const sourceId = value.sourceId;
  const variant = value.variant;
  const fetchedAt = value.fetchedAt;

  // Versionless entries are accepted only for the default variant so existing
  // local caches remain usable. Every new write uses the versioned envelope.
  const isLegacyDefault =
    version === undefined &&
    variant === undefined &&
    expectedVariant === DEFAULT_VARIANT;
  const isVersionedMatch = version === 1 && variant === expectedVariant;

  if (
    sourceId !== expectedSourceId ||
    typeof fetchedAt !== "string" ||
    Number.isNaN(Date.parse(fetchedAt)) ||
    !("payload" in value) ||
    (!isLegacyDefault && !isVersionedMatch)
  ) {
    return null;
  }

  return {
    version: 1,
    sourceId: expectedSourceId,
    variant: expectedVariant,
    fetchedAt,
    payload: value.payload as T
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
