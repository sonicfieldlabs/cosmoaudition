# Changelog

## Unreleased — observation freshness

- Prepare application 0.3.1 with build integrity receipts and immutable MASA 0.2.2 tooling. MASA protocol identifiers and the independent snapshot-adapter revision remain unchanged.
- Evaluate source age independently of successful transport and confidence; refuse expired, future, and archive values at mapping boundaries.
- Preserve original clocks and carbon settlement intervals; add effective freshness to frames and MASA exports. Fixtures remain explicitly non-current simulation evidence.
- See [freshness policy](docs/freshness.md) for owner/consumer behavior and compatibility.

## Unreleased — MASA validation candidate

- Select locally verified MASA tooling 0.2.1 for bidirectional generating-lineage and completed-preservation validation. Stored MASA protocol identifiers remain 0.2.0.
- Preserve the previous 0.2.0 archives unchanged; package only the versioned candidate directory and its source provenance in new local archives.
- Exercise the canonical 33-case matrix through the snapshot validation boundary. No public MASA tag, Cosmoaudition publication or live-provider qualification is claimed.

## 0.3.0 - 2026-09-12

- Added credential-free Climate TRACE Colombia January 2025 emissions, NOAA CO-OPS station 9414290 water level, USGS OGC station 01435000 streamflow, and NOAA PSL monthly Niño 3.4 anomalies.
- Added bounded `cosmo/observation-series/v1` metadata to snapshots, preserving units, time intervals, quality, missing slots, attribution, fetch mode and source hashes. Latest scalar points do not imply historical sampled coverage.
- The Phase 5 local candidate also preserves the exact series under `cosmo:observation-series` in MASA snapshots, so a receiving observation account can bind a later GERM mapping without refetching or rewriting history.
- Signal catalog entries advertise raw and normalized access. Sonification is not implemented by this release.
- Added provider Retry-After backoff, bounded plain-text retrieval for PSL, and validation before caching environmental payloads. Live outages never substitute fixtures.
- OSTIA remains deferred: feasibility did not establish a credential-free product endpoint.

## 0.2.0 - 2026-08-11

- Added a versioned signal catalog that makes source identity, units, sphere, epistemic status, temporal character, signal kind, and normalization semantics available through `/api/signals` and every modulation frame.
- Expanded the active aperture from fourteen to seventeen sources with Open-Meteo air quality, Open-Meteo marine forecasts, and a bounded NASA EONET aggregate; introduced the Hydrosphere stratum and preserved inland marine absence as null.
- Reduced NASA EONET event rows, links, and coordinates in memory before cache persistence, following the existing aggregate-only privacy boundary for iNaturalist.
- Upgraded modulation frames to `cosmo/modulation/v0.2` and MASA snapshots to protocol/tooling 0.2.0 with the normative Observation profile.
- Centralized adapter normalization through the catalog so values and their declared operational envelopes cannot drift independently.

## 0.1.1 - 2026-08-09

- Made Internal audio a true engine-wide arm and prevented delayed observations, material decoding, replay, Stop, or Panic from reviving an obsolete audio intent.
- Applied current route, generator, material, selection, and MIDI state when asynchronous snapshots finish, including withholding hardware MIDI after disarm.
- Hardened provider redirects, literal-address policy, loopback CORS and Host handling, request cancellation, cache failures, and UI error boundaries.
- Restricted local release archives to tracked public inputs and expected build output; rejected symlinks, stale builds, unsafe paths, private material, and unexpected files.
- Updated the local MASA boundary to TypeScript tooling 0.1.1 while preserving MASA protocol and schema identity 0.1.0, and removed the unused MASA bundle archive.
- Added pinned, read-only Node 22 CI and expanded the release gate across unit/integration tests, Chromium concurrency and safety scenarios, production builds, archive verification, and dependency audit.

## 0.1.0 - 2026-08-08

- Established the clean public baseline for the local modulation framework, instrument, MASA adapter, Web Audio and MIDI engines, provider gateway, fixtures, documentation, and release verifier.
