import type { Confidence } from "@cosmoaudition/core";
import {
  createHealthFromLoad,
  createSignal,
  loadPayload,
  normalizeLinear,
  numberOrNull,
  requireSource
} from "./helpers";
import type { AdapterContext, AdapterResult, SourceAdapter } from "./types";

interface WikimediaPageviewsPayload {
  items?: Array<{
    timestamp?: unknown;
    views?: unknown;
  }>;
}

interface PageviewAggregate {
  latestViews: number | null;
  changePercent: number | null;
  timestamp: string;
  error?: string;
}

export const wikimediaPageviewsAdapter: SourceAdapter = {
  sourceId: "wikimedia_pageviews_hourly",
  async read(context: AdapterContext): Promise<AdapterResult> {
    const source = requireSource("wikimedia_pageviews_hourly");
    const { start, end } = completeHourWindow(context.now);
    const loaded = await loadPayload<WikimediaPageviewsPayload>({
      source,
      context,
      url: wikimediaUrl(start, end),
      fixturePath: "wikimedia-pageviews-hourly.json",
      cacheVariant: "all-projects&all-access&user&latest-two-complete-hours",
      headers: {
        "User-Agent":
          "CosmoauditionSystem/0.1 (local sonic-matter research instrument; https://sonicfield.org)"
      }
    });
    const aggregate = aggregatePageviews(loaded.payload, loaded.fetchedAt);
    const confidence = aggregate.error ? "error" : loaded.confidence;

    return {
      source,
      signals: [
        createSignal({
          id: "wikimedia_pageviews_latest_hour",
          label: "Wikimedia pageviews, latest complete hour",
          layer: "city",
          unit: "views/hour",
          value: aggregate.latestViews,
          normalized: normalizeLinear(aggregate.latestViews, [0, 1_000_000_000]),
          timestamp: aggregate.timestamp,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence,
          epistemicStatus: "reported",
          notes:
            "All-project, all-access, user-agent aggregate. This delayed attention trace is not a measure of culture or individual behavior."
        }),
        createSignal({
          id: "wikimedia_pageviews_hourly_change",
          label: "Wikimedia pageview change from prior hour",
          layer: "city",
          unit: "percent",
          value: aggregate.changePercent,
          normalized: normalizeLinear(aggregate.changePercent, [-50, 50]),
          timestamp: aggregate.timestamp,
          source,
          sourceUrl: loaded.sourceUrl,
          confidence,
          epistemicStatus: "derived",
          notes:
            "Derived from the latest two complete hourly aggregates; normalized 0.5 is no change."
        })
      ],
      health: aggregate.error
        ? {
            ...createHealthFromLoad(source, loaded, context.now),
            confidence: "error" as Confidence,
            error: aggregate.error
          }
        : createHealthFromLoad(source, loaded, context.now),
      cache: loaded.metadata
    };
  }
};

export function aggregatePageviews(
  payload: WikimediaPageviewsPayload,
  fallbackTimestamp: string
): PageviewAggregate {
  if (!Array.isArray(payload.items)) {
    return {
      latestViews: null,
      changePercent: null,
      timestamp: fallbackTimestamp,
      error: "Wikimedia pageviews payload is missing items."
    };
  }

  const rows = payload.items
    .map((item) => ({
      timestamp: parseWikimediaTimestamp(item.timestamp),
      views: numberOrNull(item.views)
    }))
    .filter(
      (item): item is { timestamp: string; views: number } =>
        item.timestamp !== null && item.views !== null && item.views >= 0
    )
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const latest = rows.at(-1);
  const previous = rows.at(-2);
  const changePercent =
    latest && previous && previous.views > 0
      ? ((latest.views - previous.views) / previous.views) * 100
      : null;

  return {
    latestViews: latest?.views ?? null,
    changePercent,
    timestamp: latest?.timestamp ?? fallbackTimestamp,
    ...(latest
      ? {}
      : { error: "Wikimedia pageviews payload contains no valid hourly row." })
  };
}

/**
 * Wikimedia publishes hourly aggregates several hours behind real time, so a
 * window ending one hour ago returns 404 rather than data. Request a span wide
 * enough to clear that publication lag; the parser already sorts the returned
 * rows and uses the latest two, so the reported observation stays "the latest
 * two complete hours" — it just no longer asks for hours that do not exist yet.
 */
const WIKIMEDIA_PUBLICATION_LAG_HOURS = 14;

function completeHourWindow(now: Date): { start: Date; end: Date } {
  const currentHour = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours()
  );

  return {
    start: new Date(currentHour - WIKIMEDIA_PUBLICATION_LAG_HOURS * 60 * 60 * 1000),
    end: new Date(currentHour - 60 * 60 * 1000)
  };
}

function wikimediaUrl(start: Date, end: Date): string {
  return `https://wikimedia.org/api/rest_v1/metrics/pageviews/aggregate/all-projects/all-access/user/hourly/${formatHour(start)}/${formatHour(end)}`;
}

function formatHour(date: Date): string {
  const year = date.getUTCFullYear().toString().padStart(4, "0");
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");
  const hour = date.getUTCHours().toString().padStart(2, "0");
  return `${year}${month}${day}${hour}`;
}

function parseWikimediaTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{10}$/.test(value)) {
    return null;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const hour = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day, hour));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour
  ) {
    return null;
  }

  return date.toISOString();
}
