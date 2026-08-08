import type { Confidence } from "@cosmoaudition/core";
import { createHealthFromLoad, createSignal, loadPayload, missingDeclaredFieldsError, normalizeLog, numberOrNull, requireSource } from "./helpers";
import type { AdapterContext, AdapterResult, SourceAdapter } from "./types";

interface MempoolStatsPayload {
  count?: unknown;
  vsize?: unknown;
  total_fee?: unknown;
}

interface MempoolHashratePayload {
  currentHashrate?: unknown;
  currentDifficulty?: unknown;
}

export const mempoolStatsAdapter: SourceAdapter = {
  sourceId: "mempool_stats",
  async read(context: AdapterContext): Promise<AdapterResult> {
    const source = requireSource("mempool_stats");
    const loaded = await loadPayload<MempoolStatsPayload>({
      source,
      context,
      url: source.endpoint!,
      fixturePath: "mempool-stats.json"
    });
    const count = numberOrNull(loaded.payload.count);
    const vsize = numberOrNull(loaded.payload.vsize);
    const totalFee = numberOrNull(loaded.payload.total_fee);
    const parseError = missingDeclaredFieldsError(
      [count, vsize, totalFee],
      "mempool.space mempool payload has no valid declared numeric fields."
    );
    const confidence = parseError ? "error" : loaded.confidence;

    return {
      source,
      signals: [
        createSignal({
          id: "bitcoin_mempool_count",
          label: "Bitcoin mempool count",
          layer: "cloud",
          unit: "transactions",
          value: count,
          normalized: normalizeLog(count, [1_000, 300_000]),
          timestamp: loaded.fetchedAt,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence,
          ...(parseError ? { error: parseError } : {})
        }),
        createSignal({
          id: "bitcoin_mempool_vsize",
          label: "Bitcoin mempool virtual size",
          layer: "cloud",
          unit: "vbytes",
          value: vsize,
          normalized: normalizeLog(vsize, [1_000_000, 250_000_000]),
          timestamp: loaded.fetchedAt,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence,
          ...(parseError ? { error: parseError } : {})
        }),
        createSignal({
          id: "bitcoin_mempool_total_fee",
          label: "Bitcoin mempool total fee",
          layer: "cloud",
          unit: "sats",
          value: totalFee,
          normalized: normalizeLog(totalFee, [100_000, 100_000_000]),
          timestamp: loaded.fetchedAt,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence,
          ...(parseError ? { error: parseError } : {})
        })
      ],
      health: parseError
        ? { ...createHealthFromLoad(source, loaded, context.now), confidence: "error" as Confidence, error: parseError }
        : createHealthFromLoad(source, loaded, context.now),
      cache: loaded.metadata
    };
  }
};

export const mempoolHashrateAdapter: SourceAdapter = {
  sourceId: "mempool_hashrate",
  async read(context: AdapterContext): Promise<AdapterResult> {
    const source = requireSource("mempool_hashrate");
    const loaded = await loadPayload<MempoolHashratePayload>({
      source,
      context,
      url: source.endpoint!,
      fixturePath: "mempool-hashrate.json"
    });
    const hashrate = numberOrNull(loaded.payload.currentHashrate);
    const difficulty = numberOrNull(loaded.payload.currentDifficulty);
    const parseError = missingDeclaredFieldsError(
      [hashrate, difficulty],
      "mempool.space hashrate payload has no valid declared numeric fields."
    );
    const confidence = parseError ? "error" : loaded.confidence;

    return {
      source,
      signals: [
        createSignal({
          id: "bitcoin_current_hashrate",
          label: "Bitcoin current hashrate",
          layer: "cloud",
          unit: "hashes/second",
          value: hashrate,
          normalized: normalizeLog(hashrate, [
            100_000_000_000_000_000_000,
            1_500_000_000_000_000_000_000
          ]),
          timestamp: loaded.fetchedAt,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence,
          ...(parseError ? { error: parseError } : {})
        }),
        createSignal({
          id: "bitcoin_current_difficulty",
          label: "Bitcoin current difficulty",
          layer: "cloud",
          unit: "difficulty",
          value: difficulty,
          normalized: normalizeLog(difficulty, [1_000_000_000_000, 200_000_000_000_000]),
          timestamp: loaded.fetchedAt,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence,
          ...(parseError ? { error: parseError } : {})
        })
      ],
      health: parseError
        ? { ...createHealthFromLoad(source, loaded, context.now), confidence: "error" as Confidence, error: parseError }
        : createHealthFromLoad(source, loaded, context.now),
      cache: loaded.metadata
    };
  }
};
