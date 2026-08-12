import { describe, expect, it } from "vitest";
import {
  createSourceHealth,
  getSourceDefinition,
  isSourceStale,
  sourceDefinitions
} from "../sources";

describe("source metadata", () => {
  it("contains the active and explicitly deferred sources", () => {
    const ids = sourceDefinitions.map((source) => source.id);

    expect(ids).toContain("carbon_intensity_gb");
    expect(ids).toContain("carbon_generation_gb");
    expect(ids).toContain("open_meteo_local");
    expect(ids).toContain("open_meteo_air_quality");
    expect(ids).toContain("open_meteo_marine");
    expect(ids).toContain("usgs_earthquakes");
    expect(ids).toContain("nasa_eonet_open_events");
    expect(ids).toContain("mempool_stats");
    expect(ids).toContain("mempool_hashrate");
    expect(ids).toContain("gbfs_bogota_station_status");
    expect(ids).toContain("noaa_swpc_solar_wind_speed");
    expect(ids).toContain("noaa_swpc_magnetic_field");
    expect(ids).toContain("noaa_swpc_planetary_k_index");
    expect(ids).toContain("nasa_jpl_close_approaches");
    expect(ids).toContain("inaturalist_recent_observations");
    expect(ids).toContain("wikimedia_pageviews_hourly");
    expect(ids).toContain("coingecko_btc");
    expect(ids).toContain("owid_oil_production");
    expect(ids).toContain("worldbank_population");
    expect(ids).toContain("gbfs_systems");
    expect(ids).toContain("browser_local_time");
    expect(ids).toContain("browser_window_size");
    expect(ids).toContain("browser_audio_context");
    expect(ids).toContain("local_archive");
  });

  it("classifies sources without collapsing their spheres", () => {
    expect(getSourceDefinition("noaa_swpc_solar_wind_speed")?.sphere).toBe(
      "cosmos"
    );
    expect(getSourceDefinition("inaturalist_recent_observations")?.sphere).toBe(
      "biosphere"
    );
    expect(getSourceDefinition("wikimedia_pageviews_hourly")?.sphere).toBe(
      "human"
    );
    expect(getSourceDefinition("open_meteo_marine")?.sphere).toBe(
      "hydrosphere"
    );
    expect(getSourceDefinition("nasa_jpl_close_approaches")?.temporalCharacter).toBe(
      "forecast"
    );
  });

  it("looks up source definitions by id", () => {
    expect(getSourceDefinition("mempool_stats")?.ttlSeconds).toBe(60);
    expect(getSourceDefinition("unknown_source")).toBeUndefined();
  });

  it("keeps risky expansion sources deferred", () => {
    expect(getSourceDefinition("yahoo_oil_cl")?.status).toBe("deferred");
    expect(getSourceDefinition("opensky_states")?.status).toBe("deferred");
    expect(getSourceDefinition("gbfs_bogota_station_status")?.status).toBe(
      "ready"
    );
    expect(getSourceDefinition("gbfs_systems")?.status).toBe("deferred");
    expect(getSourceDefinition("coingecko_btc")?.status).toBe("deferred");
    expect(getSourceDefinition("owid_oil_production")?.status).toBe("deferred");
    expect(getSourceDefinition("worldbank_population")?.status).toBe("deferred");
  });

  it("documents provenance, limits, license, TTL, and fallback for every source", () => {
    for (const source of sourceDefinitions) {
      expect(source.ttlSeconds).toBeGreaterThan(0);
      expect(source.fallback.trim().length).toBeGreaterThan(0);
      expect(source.limitation.trim().length).toBeGreaterThan(0);
      expect(source.licenseNote.trim().length).toBeGreaterThan(0);

      if (source.route === "api-proxy") {
        expect(source.endpoint ?? source.endpointPattern).toBeDefined();
      }
    }
  });

  it("detects stale source timestamps", () => {
    const now = new Date("2026-06-26T17:00:00.000Z");

    expect(isSourceStale("2026-06-26T16:59:45.000Z", 30, now)).toBe(false);
    expect(isSourceStale("2026-06-26T16:59:00.000Z", 30, now)).toBe(true);
    expect(isSourceStale(null, 30, now)).toBe(true);
  });

  it("creates source health without hiding errors", () => {
    const source = getSourceDefinition("carbon_intensity_gb");
    expect(source).toBeDefined();

    const health = createSourceHealth(source!, {
      fetchedAt: "2026-06-26T16:59:45.000Z",
      now: new Date("2026-06-26T17:00:00.000Z"),
      error: "validation failed"
    });

    expect(health.confidence).toBe("error");
    expect(health.error).toBe("validation failed");
  });
});
