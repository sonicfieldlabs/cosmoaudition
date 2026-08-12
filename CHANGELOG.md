# Changelog

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
