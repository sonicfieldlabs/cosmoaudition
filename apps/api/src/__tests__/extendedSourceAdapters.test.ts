import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectSnapshot } from "../adapters";
import { aggregateFireballs } from "../adapters/fireball";
import { aggregateCloseApproaches } from "../adapters/jpl";
import { mempoolStatsAdapter } from "../adapters/mempool";
import { inaturalistRecentObservationsAdapter } from "../adapters/inaturalist";
import { eonetOpenEventsAdapter } from "../adapters/eonet";
import { swpcSolarWindSpeedAdapter } from "../adapters/swpc";
import { usgsEarthquakesAdapter } from "../adapters/usgs";
import { aggregatePageviews, wikimediaPageviewsAdapter } from "../adapters/wikimedia";

const originalFetch = globalThis.fetch;
const originalCacheDir = process.env.COSMOAUDITION_CACHE_DIR;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalCacheDir === undefined) {
    delete process.env.COSMOAUDITION_CACHE_DIR;
  } else {
    process.env.COSMOAUDITION_CACHE_DIR = originalCacheDir;
  }
});

describe.sequential("extended source adapter fixtures", () => {
  it("parses cosmic, biosphere, and human aggregates with explicit epistemic metadata", async () => {
    const snapshot = await collectSnapshot({
      mode: "fixture",
      now: new Date("2026-07-28T17:10:00.000Z")
    });
    const signals = new Map(snapshot.signals.map((signal) => [signal.id, signal]));

    expect(signals.get("solar_wind_speed")?.value).toBe(468);
    expect(signals.get("solar_wind_magnetic_field_bt")?.value).toBe(8.4);
    expect(signals.get("solar_wind_magnetic_field_bz_gsm")?.value).toBe(-3.2);
    expect(signals.get("solar_wind_magnetic_field_bz_gsm")?.normalized).toBeCloseTo(
      0.42,
      4
    );
    expect(signals.get("planetary_k_index")?.value).toBe(2.67);
    expect(signals.get("close_approach_count_7d")?.value).toBe(2);
    expect(signals.get("closest_approach_distance_au")?.value).toBe(0.0123);
    expect(signals.get("closest_approach_velocity_km_s")?.value).toBe(18.75);
    expect(signals.get("inaturalist_observations_created_1h")?.value).toBe(7320);
    expect(signals.get("inaturalist_observation_rate_per_minute")?.value).toBe(122);
    expect(signals.get("wikimedia_pageviews_latest_hour")?.value).toBe(441_000_000);
    expect(signals.get("wikimedia_pageviews_hourly_change")?.value).toBeCloseTo(5, 8);
    expect(signals.get("air_quality_pm2_5")?.value).toBe(8.6);
    expect(signals.get("marine_wave_height")?.value).toBeNull();
    expect(signals.get("marine_wave_height")?.sphere).toBe("hydrosphere");
    expect(signals.get("eonet_open_event_count_bounded")?.value).toBe(24);
    expect(signals.get("eonet_open_wildfire_count_bounded")?.value).toBe(12);

    expect(signals.get("solar_wind_speed")?.sphere).toBe("cosmos");
    expect(signals.get("inaturalist_observations_created_1h")?.sphere).toBe(
      "biosphere"
    );
    expect(signals.get("wikimedia_pageviews_latest_hour")?.sphere).toBe("human");
    expect(signals.get("closest_approach_time_hours")?.epistemicStatus).toBe(
      "derived"
    );
    expect(signals.get("fireball_latest_impact_energy_kt")?.eventKey).toBe(
      "nasa-jpl-fireball:2026-07-21T01:14:45.000Z"
    );
  });

  it("keeps every available source normalization bounded", async () => {
    const snapshot = await collectSnapshot({
      mode: "fixture",
      now: new Date("2026-07-28T17:10:00.000Z")
    });
    const ids = [
      "solar_wind_speed",
      "solar_wind_magnetic_field_bt",
      "solar_wind_magnetic_field_bz_gsm",
      "planetary_k_index",
      "close_approach_count_7d",
      "closest_approach_distance_au",
      "closest_approach_velocity_km_s",
      "closest_approach_time_hours",
      "inaturalist_observations_created_1h",
      "inaturalist_observation_rate_per_minute",
      "wikimedia_pageviews_latest_hour",
      "wikimedia_pageviews_hourly_change"
    ];

    for (const id of ids) {
      const normalized = snapshot.signals.find((signal) => signal.id === id)
        ?.normalized;
      expect(normalized, id).not.toBeNull();
      expect(normalized, id).toBeGreaterThanOrEqual(0);
      expect(normalized, id).toBeLessThanOrEqual(1);
    }
  });

  it("reduces iNaturalist rows before persisting the live cache", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "cosmoaudition-inat-cache-"));
    process.env.COSMOAUDITION_CACHE_DIR = cacheDir;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          total_results: 60,
          results: [
            {
              created_at: "2026-07-28T17:09:31Z",
              user: { login: "private-user" },
              taxon: { name: "Sensitive taxon row" },
              photos: [{ url: "https://media.invalid/private.jpg" }],
              location: "4.711,-74.0721",
              private_location: "4.700,-74.080"
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof fetch;

    try {
      const result = await inaturalistRecentObservationsAdapter.read({
        mode: "live",
        now: new Date("2026-07-28T17:10:00.000Z"),
        latitude: 4.711,
        longitude: -74.0721
      });
      const cacheFiles = (await readdir(cacheDir)).filter((name) =>
        name.startsWith("inaturalist_recent_observations--")
      );
      expect(cacheFiles).toHaveLength(1);

      const envelope = JSON.parse(
        await readFile(join(cacheDir, cacheFiles[0]!), "utf8")
      ) as { payload: Record<string, unknown> };
      const persisted = JSON.stringify(envelope.payload);

      expect(result.signals[0]?.value).toBe(60);
      expect(result.health.confidence).toBe("high");
      expect(Object.keys(envelope.payload).sort()).toEqual([
        "kind",
        "newestCreatedAt",
        "totalResults",
        "windowEnd",
        "windowStart"
      ]);
      expect(persisted).not.toContain("private-user");
      expect(persisted).not.toContain("Sensitive taxon row");
      expect(persisted).not.toContain("private.jpg");
      expect(persisted).not.toContain("4.711,-74.0721");
      expect(persisted).not.toContain("private_location");
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it("reduces NASA EONET event rows and geometries before cache persistence", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "cosmoaudition-eonet-cache-"));
    process.env.COSMOAUDITION_CACHE_DIR = cacheDir;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          events: [
            {
              id: "EONET_1",
              title: "Provider event title",
              sources: [{ id: "source", url: "https://provider.invalid/event" }],
              categories: [{ id: "wildfires", title: "Wildfires" }],
              geometry: [
                {
                  date: "2026-08-11T10:00:00Z",
                  type: "Point",
                  coordinates: [-74.0721, 4.711]
                }
              ]
            },
            {
              id: "EONET_2",
              title: "Second event",
              categories: [{ id: "severeStorms", title: "Severe Storms" }],
              geometry: [{ date: "2026-08-11T11:00:00Z", coordinates: [1, 2] }]
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof fetch;

    try {
      const result = await eonetOpenEventsAdapter.read({
        mode: "live",
        now: new Date("2026-08-11T12:00:00.000Z"),
        latitude: 4.711,
        longitude: -74.0721
      });
      const cacheFiles = (await readdir(cacheDir)).filter((name) =>
        name.startsWith("nasa_eonet_open_events--")
      );
      expect(cacheFiles).toHaveLength(1);
      const envelope = JSON.parse(
        await readFile(join(cacheDir, cacheFiles[0]!), "utf8")
      ) as { payload: Record<string, unknown> };
      const persisted = JSON.stringify(envelope.payload);

      expect(result.signals.find((signal) => signal.id === "eonet_open_event_count_bounded")?.value).toBe(2);
      expect(result.signals.find((signal) => signal.id === "eonet_open_wildfire_count_bounded")?.value).toBe(1);
      expect(result.signals.find((signal) => signal.id === "eonet_open_severe_storm_count_bounded")?.value).toBe(1);
      expect(result.signals.find((signal) => signal.id === "eonet_latest_geometry_age_hours")?.value).toBe(1);
      expect(Object.keys(envelope.payload).sort()).toEqual([
        "apertureDays",
        "eventCount",
        "kind",
        "latestGeometryAt",
        "rowLimit",
        "severeStormCount",
        "wildfireCount"
      ]);
      expect(persisted).not.toContain("Provider event title");
      expect(persisted).not.toContain("provider.invalid");
      expect(persisted).not.toContain("-74.0721");
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it("enforces the EONET 200-row aperture even if the provider exceeds it", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "cosmoaudition-eonet-limit-"));
    process.env.COSMOAUDITION_CACHE_DIR = cacheDir;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          events: Array.from({ length: 205 }, (_, index) => ({
            id: `EONET_${index}`,
            categories: [{ id: "wildfires" }],
            geometry: [{ date: "2026-08-11T11:00:00Z", coordinates: [index, index] }]
          }))
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof fetch;

    try {
      const result = await eonetOpenEventsAdapter.read({
        mode: "live",
        now: new Date("2026-08-11T12:00:00.000Z"),
        latitude: 4.711,
        longitude: -74.0721
      });
      expect(result.signals.find((signal) => signal.id === "eonet_open_event_count_bounded")?.value).toBe(200);
      expect(result.signals.find((signal) => signal.id === "eonet_open_wildfire_count_bounded")?.value).toBe(200);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it("keeps malformed JPL and Wikimedia values null instead of fabricating zero", () => {
    const jpl = aggregateCloseApproaches(
      { fields: ["des"], data: [["2026 XX"]] },
      new Date("2026-07-28T17:10:00.000Z"),
      "2026-07-28T17:10:00.000Z"
    );
    const wikimedia = aggregatePageviews(
      { items: [{ timestamp: "bad", views: "also bad" }] },
      "2026-07-28T17:10:00.000Z"
    );

    expect(jpl.distanceAu).toBeNull();
    expect(jpl.relativeVelocityKmS).toBeNull();
    expect(jpl.hoursUntil).toBeNull();
    expect(jpl.error).toBeDefined();
    expect(wikimedia.latestViews).toBeNull();
    expect(wikimedia.changePercent).toBeNull();
    expect(wikimedia.error).toBeDefined();
  });

  it("enforces NASA/JPL contracts while preserving valid zero-result windows", () => {
    const fallback = "2026-07-29T00:00:00.000Z";
    const fireballZero = aggregateFireballs(
      { signature: { version: "1.2" }, count: "0" },
      fallback
    );
    const fireballWrongVersion = aggregateFireballs(
      { signature: { version: "9.9" }, count: "0" },
      fallback
    );
    const cadZero = aggregateCloseApproaches(
      { signature: { version: "1.5" }, count: "0" },
      new Date(fallback),
      fallback
    );
    const cadWrongVersion = aggregateCloseApproaches(
      { signature: { version: "1.4" }, count: "0" },
      new Date(fallback),
      fallback
    );

    expect(fireballZero.count).toBe(0);
    expect(fireballZero.error).toBeUndefined();
    expect(fireballWrongVersion.error).toMatch(/supported 1\.2 contract/);
    expect(cadZero.count).toBe(0);
    expect(cadZero.error).toBeUndefined();
    expect(cadWrongVersion.error).toMatch(/supported 1\.5 contract/);
    expect(
      aggregateFireballs(
        {
          signature: { version: "1.2" },
          count: "1",
          fields: ["date", "energy", "impact-e"],
          data: []
        },
        fallback
      ).error
    ).toMatch(/no data rows/);
    expect(
      aggregateCloseApproaches(
        {
          signature: { version: "1.5" },
          count: "1",
          fields: ["dist", "v_rel", "jd"],
          data: []
        },
        new Date(fallback),
        fallback
      ).error
    ).toMatch(/no data rows/);
  });

  it("derives fireball speed only from official vector components and keeps optional nulls", () => {
    const aggregate = aggregateFireballs(
      {
        signature: { version: "1.2" },
        count: "2",
        fields: ["date", "energy", "impact-e", "alt", "vel", "vx", "vy", "vz"],
        data: [
          ["2026-07-20 00:00:00", "1", "0.2", "45", "999", "3", "4", "12"],
          ["2026-07-21 00:00:00", "2", "0.3", null, "999", null, null, null]
        ]
      },
      "2026-07-29T00:00:00.000Z"
    );
    const componentAggregate = aggregateFireballs(
      {
        signature: { version: "1.2" },
        count: "1",
        fields: ["date", "energy", "impact-e", "vx", "vy", "vz"],
        data: [["2026-07-20 00:00:00", "1", "0.2", "3", "4", "12"]]
      },
      "2026-07-29T00:00:00.000Z"
    );

    expect(aggregate.altitudeKm).toBeNull();
    expect(aggregate.velocityKmS).toBeNull();
    expect(componentAggregate.velocityKmS).toBe(13);
  });

  it("rejects malformed USGS aggregates and selects the newest event by time", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "cosmoaudition-usgs-cache-"));
    process.env.COSMOAUDITION_CACHE_DIR = cacheDir;
    const context = {
      mode: "live" as const,
      now: new Date("2026-07-29T00:00:00.000Z"),
      latitude: 4.711,
      longitude: -74.0721
    };

    try {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ features: [] }), {
          headers: { "content-type": "application/json" }
        })) as typeof fetch;
      const malformed = await usgsEarthquakesAdapter.read(context);
      expect(malformed.health.confidence).toBe("error");
      expect(malformed.signals[0]?.value).toBeNull();

      await rm(cacheDir, { recursive: true, force: true });
      const secondCache = await mkdtemp(join(tmpdir(), "cosmoaudition-usgs-cache-"));
      process.env.COSMOAUDITION_CACHE_DIR = secondCache;
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            type: "FeatureCollection",
            features: [
              { id: "older", properties: { mag: 1.1, time: 1000 } },
              { id: "newer", properties: { mag: 2.4, time: 3000 } },
              { id: "middle", properties: { mag: 1.7, time: 2000 } }
            ]
          }),
          { headers: { "content-type": "application/json" } }
        )) as typeof fetch;
      const valid = await usgsEarthquakesAdapter.read(context);
      const recent = valid.signals.find(
        (signal) => signal.id === "earthquake_recent_magnitude"
      );
      expect(recent?.value).toBe(2.4);
      expect(recent?.eventKey).toBe("usgs-earthquake:newer");
      await rm(secondCache, { recursive: true, force: true });
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it("does not crash on a finite USGS timestamp outside the JavaScript date range", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "cosmoaudition-usgs-date-cache-"));
    process.env.COSMOAUDITION_CACHE_DIR = cacheDir;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          type: "FeatureCollection",
          features: [{ id: "bad-date", properties: { mag: 1.2, time: 9e15 } }]
        }),
        { headers: { "content-type": "application/json" } }
      )) as typeof fetch;

    try {
      const result = await usgsEarthquakesAdapter.read({
        mode: "live",
        now: new Date("2026-07-29T00:00:00.000Z"),
        latitude: 4.711,
        longitude: -74.0721
      });
      const recent = result.signals.find(
        (signal) => signal.id === "earthquake_recent_magnitude"
      );
      expect(result.health.confidence).toBe("error");
      expect(recent?.value).toBeNull();
      expect(recent?.eventKey).toBeUndefined();
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it("marks an all-null mempool payload as an explicit provider error", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "cosmoaudition-mempool-cache-"));
    process.env.COSMOAUDITION_CACHE_DIR = cacheDir;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ count: null, vsize: null, total_fee: null }), {
        headers: { "content-type": "application/json" }
      })) as typeof fetch;

    try {
      const result = await mempoolStatsAdapter.read({
        mode: "live",
        now: new Date("2026-07-29T00:00:00.000Z"),
        latitude: 4.711,
        longitude: -74.0721
      });
      expect(result.health.confidence).toBe("error");
      expect(result.signals.every((signal) => signal.value === null)).toBe(true);
      expect(result.signals.every((signal) => signal.confidence === "error")).toBe(true);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it("requests a Wikimedia window old enough to have been published", async () => {
    // Wikimedia publishes hourly aggregates several hours behind real time, so
    // a window ending one hour ago returns 404 and the source dies in live mode.
    const cacheDir = await mkdtemp(join(tmpdir(), "cosmoaudition-wikimedia-lag-"));
    process.env.COSMOAUDITION_CACHE_DIR = cacheDir;
    let requestedUrl = "";
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch;

    try {
      await wikimediaPageviewsAdapter.read({
        mode: "live",
        now: new Date("2026-08-07T22:29:00.000Z"),
        latitude: 4.711,
        longitude: -74.0721
      });

      const hours = requestedUrl.match(/hourly\/(\d{10})\/(\d{10})$/);
      expect(hours).not.toBeNull();
      const [, start, end] = hours!;
      const spanHours =
        (Date.parse(`${end!.slice(0, 4)}-${end!.slice(4, 6)}-${end!.slice(6, 8)}T${end!.slice(8, 10)}:00:00Z`) -
          Date.parse(`${start!.slice(0, 4)}-${start!.slice(4, 6)}-${start!.slice(6, 8)}T${start!.slice(8, 10)}:00:00Z`)) /
        3_600_000;
      expect(spanHours).toBeGreaterThanOrEqual(6);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it("reads the SWPC summary shape the provider actually serves", async () => {
    // services.swpc.noaa.gov/products/summary/* wraps the current reading in a
    // single-element array. Reading it as a bare object nulled the signal in
    // live mode while every fixture-based test kept passing.
    const cacheDir = await mkdtemp(join(tmpdir(), "cosmoaudition-swpc-array-"));
    process.env.COSMOAUDITION_CACHE_DIR = cacheDir;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify([{ proton_speed: 255, time_tag: "2026-08-07T22:21:00Z" }]),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof fetch;

    try {
      const result = await swpcSolarWindSpeedAdapter.read({
        mode: "live",
        now: new Date("2026-08-07T22:22:00.000Z"),
        latitude: 4.711,
        longitude: -74.0721
      });

      expect(result.signals[0]?.value).toBe(255);
      expect(result.health.confidence).not.toBe("error");
      expect(Date.parse(result.signals[0]!.timestamp)).toBe(
        Date.parse("2026-08-07T22:21:00Z")
      );
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it("emits a null SWPC signal and error health for malformed live data", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "cosmoaudition-swpc-cache-"));
    process.env.COSMOAUDITION_CACHE_DIR = cacheDir;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ proton_speed: "not-a-number" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })) as typeof fetch;

    try {
      const result = await swpcSolarWindSpeedAdapter.read({
        mode: "live",
        now: new Date("2026-07-28T17:10:00.000Z"),
        latitude: 4.711,
        longitude: -74.0721
      });

      expect(result.signals[0]?.value).toBeNull();
      expect(result.signals[0]?.normalized).toBeNull();
      expect(result.health.confidence).toBe("error");
      expect(result.health.error).toMatch(/proton_speed/);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
});
