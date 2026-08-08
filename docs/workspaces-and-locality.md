# Workspaces and locality

Status: active Cosmoaudition System v0.1 behavior

## Workspaces

- **Observe** receives one bounded fixture or live snapshot, groups signals by
  source stratum, and exposes source, time, unit, confidence, epistemic status,
  and limitation.
- **Patch** shows executable mapping decisions. Each route can be applied,
  held, skipped, represented as uncertainty, or refused; disabling a route is
  visible and does not alter its source observation.
- **Transform** processes a browser-local sound through rate, filter, delay,
  gain, and declared observation modulation. Playback is not a recorded
  derivative.
- **Route** projects accepted controls to JSON, Standard MIDI File, optional
  live Web MIDI, or a validated MASA account. Transmission is not evidence that
  a destination sounded.
- **Archive** stores and reloads a bounded browser-local observation history.

Workspace navigation changes the available operation, not the underlying data
or its epistemic status.

## Input state

- **Fixture / reproducible** uses declared local payloads. The weather fixture
  is Bogota-only and is never relabelled as another selected locality.
- **Live** calls declared providers through the loopback API. A provider error,
  stale cache, or malformed field remains visible and cannot become an invented
  zero.

Fixture and live acquisition are distinct provenance events in MASA records.

## Locality policy

- No automatic geolocation.
- Preset places are explicit manual coordinates.
- Snapshot requests send the selected coordinates only to the local API proxy.
- Parameter-aware cache keys prevent one locality from supplying another.
- Situated weather is one point condition, not planetary atmosphere.

## Archive policy

- The active key is `cosmoaudition.archive.v1` and stores at most twelve entries.
- Archive payloads are not sent to a third party.
- Loading an entry changes the current observation; it does not claim the data
  is current.

## Validation

Current browser tests cover workspace navigation, fixture observation, explicit
Listen/Panic flow, mapping-route visibility, imported-material boundaries,
local archive save/load, failure without substitution, and responsive runtime
budgets. MASA and MIDI exports have separate unit/integration coverage.
