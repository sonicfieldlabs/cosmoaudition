# Changelog

## 0.1.1 - 2026-08-09

- Made Internal audio a true engine-wide arm and prevented delayed observations, material decoding, replay, Stop, or Panic from reviving an obsolete audio intent.
- Applied current route, generator, material, selection, and MIDI state when asynchronous snapshots finish, including withholding hardware MIDI after disarm.
- Hardened provider redirects, literal-address policy, loopback CORS and Host handling, request cancellation, cache failures, and UI error boundaries.
- Restricted local release archives to tracked public inputs and expected build output; rejected symlinks, stale builds, unsafe paths, private material, and unexpected files.
- Updated the local MASA boundary to TypeScript tooling 0.1.1 while preserving MASA protocol and schema identity 0.1.0, and removed the unused MASA bundle archive.
- Added pinned, read-only Node 22 CI and expanded the release gate across unit/integration tests, Chromium concurrency and safety scenarios, production builds, archive verification, and dependency audit.

## 0.1.0 - 2026-08-08

- Established the clean public baseline for the local modulation framework, instrument, MASA adapter, Web Audio and MIDI engines, provider gateway, fixtures, documentation, and release verifier.
