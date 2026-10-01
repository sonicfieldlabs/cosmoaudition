# Environmental sources in 0.3.0

These four credential-free adapters are deliberately narrow. They declare raw and normalized access in `/api/signals`; they do not render audio. The signal catalog remains wire-compatible `cosmo/signal-catalog/v0.2`, with catalog version `0.3.0`.

| Source / signal | Scope and units | Fetch TTL | Normalization envelope |
| --- | --- | --- | --- |
| `climate_trace_colombia` / `climate_trace_colombia_emissions` | Colombia, all sectors, January 2025; tonnes CO2e, 100-year horizon; inventory estimate | 24 hours | 0–100 million tonnes |
| `noaa_coops_water_level` / `coops_water_level` | NOAA station 9414290, San Francisco; metres relative to MLLW; latest point, quality and flags retained | 6 minutes | −2–5 m |
| `usgs_water_streamflow` / same signal ID | USGS-01435000, parameter 00060, statistic 00011; ft³/s; latest point, approval and qualifier retained | 15 minutes | 0–10,000 ft³/s |
| `noaa_psl_nino34` / `nino34_anomaly` | Monthly ERSST v6 Niño 3.4 SST anomalies, 1981–2010 baseline; °C | 24 hours | −3–3 °C |

Envelopes are authored modulation ranges, not physical limits or hazard thresholds. Units, identities and declared interval semantics are checked before newly fetched payloads are cached. The PSL parser also checks the dataset, anomaly baseline and unit declaration in the file footer. Missing slots remain null. A latest-point adapter does not claim historical series coverage.

Exact requests verified without credentials on 2026-09-12:

- [Climate TRACE country rankings](https://api.climatetrace.org/v7/rankings/countries?start=2025-01&end=2025-01&gas=co2e_100yr): select `COL` from the returned rankings, with the response interval checked against January 2025. This does not imply current-month coverage. [Terms and attribution](https://climatetrace.org/terms): emissions data and metadata use CC BY 4.0, subject to identified exceptions; this adapter selects a country total and normalizes it.
- [NOAA CO-OPS latest water level](https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?date=latest&station=9414290&product=water_level&datum=MLLW&time_zone=gmt&units=metric&format=json): GMT timestamps, metric units and MLLW requested explicitly. [API reference](https://api.tidesandcurrents.noaa.gov/api/prod/). Attribute NOAA CO-OPS and station 9414290; preliminary quality is not upgraded to a verified observation.
- [USGS OGC latest continuous data](https://api.waterdata.usgs.gov/ogcapi/v1/collections/latest-continuous/items?limit=1&monitoring_location_id=USGS-01435000&parameter_code=00060&f=json): one bounded observation. The feasibility v0 URL redirected to v1; implementation uses v1 directly. [API documentation](https://api.waterdata.usgs.gov/docs/ogcapi/) and [USGS data credits](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits). No legacy WaterServices dependency or sustained anonymous quota claim.
- [NOAA PSL anomaly table](https://psl.noaa.gov/data/correlation/nina34.anom.data): its footer declares ERSST V6, the 1981–2010 anomaly baseline and degC. The earlier feasibility URL `nina34.data` contains temperatures, so it is not used as an anomaly series. Attribute NOAA/OAR/PSL and the dataset declared by the table. [PSL disclaimer](https://psl.noaa.gov/disclaimer/).

`/api/snapshot` adds `series[]` entries under `cosmo/observation-series/v1`. Each includes source/series ID, units, fetch time, exact URL, fixture/live mode, availability, cadence, normalization version, attribution, coverage and a SHA-256 over source identity, URL and retrieved payload. Points have an absolute timestamp, optional exclusive interval end, nullable value, reported/missing status and provider quality. Points are sorted; PSL output is bounded to the final 120 monthly slots. Fetch cadence is not an audio sampling rate. The catalog supplies the normalization definition for each named signal.

Responses are bounded to 1 MiB with the existing six-second timeout, public HTTPS redirect policy, cache and in-flight coalescing. HTTP 429 honours bounded Retry-After backoff (60 seconds–1 hour); other unavailable environmental fetches back off for one minute. Matching stale cache remains explicitly stale. An absent live source never falls back to a fixture or zero. Fixtures in `data/mock/phase4-*` are retained public provider examples from the date above, not evidence of current conditions.

OSTIA remains **not built**: the feasibility pass did not identify a working credential-free ERDDAP product query. Account-based ocean products and GRIB2 adapters remain outside this release. Waveform rendering and two-parent sonification lineage belong to the later generation phase.


The Phase 5 local candidate carries the same bounded series inside MASA snapshot extension
`cosmo:observation-series`, including missing slots, quality, clocks and provenance hashes.
Oída preserves this source snapshot in a new observation account. GERM resolves the retained
series and creates a separate mapping/render; this adapter does not synthesize audio or turn
a scalar observation into a sampled acoustic time series. Older accounts are not rewritten.
