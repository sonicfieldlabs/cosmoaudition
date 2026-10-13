# Cosmoaudition System

Cosmoaudition System is a **modulation framework** for situated observation, with a local instrument attached. Once its loopback gateway is running it publishes normalized, attributed, epistemically-typed modulation over HTTP, Server-Sent Events, OSC, MIDI, and MASA records, so any sonic project can consume these signals without inheriting this repository — see [the modulation framework](./docs/modulation-framework.md). It is also a live sound instrument and MASA-native research interface within the Sonic Matter Framework. It receives bounded observations from cosmic, atmospheric, hydrospheric, geophysical, ecological, cultural, economic, and computational infrastructures, then makes explicitly authored relations available as sound-engine controls, triggers, MIDI, control frames, and transformations of imported sonic material.

It is not a machine for revealing “the sound of” the Sun, Earth, a species, a city, or a dataset. Provider values, normalized controls, synthesis states, and audible results remain distinct and attributable.

See [Cosmoaudition System architecture](./docs/cosmoaudition-system.md) and the [source register](./docs/source-register.md).

## Current local workbench

The interface has five connected workspaces:

- **Observe** groups sources into Cosmos, Atmosphere, Hydrosphere, Geosphere, Biosphere, Human activity, and Machine/infrastructure; it exposes value, unit, evidence kind, health, freshness, and institutional scope.
- **Patch** shows the complete `Observation → Feature → Control signal → Processor → Output` relation, provides a deterministic clock/pulse/LFO/envelope/sample-and-hold bank, and gives every mapping an enable switch and bounded amount.
- **Transform** loads a private local sound as a parent representation and sends it through a bounded rate/filter-Q/delay-time/delay-feedback material path whose automation follows each mapping's declared smoothing.
- **Route** independently arms internal audio, triggers, control-frame JSON, MIDI projection, and a bounded MASA account.
- **Archive** stores up to twelve private browser-local observations for replay.

Audio starts only after a user gesture. Stop and Panic remain available. Missing, malformed, or stale values are not silently interpreted as zero.

## Architecture

```text
official provider or declared fixture
  → local Hono ingestion gateway
  → schema-aware adapter + parameter-specific cache
  → project-neutral ObservedSignal observation
  → optional derived observation/index
  → executable MappingDecision
  → control frame
  → Web Audio / imported-material processor / MIDI / trigger
  → bounded MASA record + receipts + lineage
```

Packages:

| Package | Responsibility |
| --- | --- |
| `@cosmoaudition/core` | source definitions, observations, normalization, indices, mappings, decisions |
| `@cosmoaudition/masa` | bounded MASA record construction, validation, projections |
| `@cosmoaudition/audio-engine` | conservative synthesis, buses, control routing, imported-material processing |
| `@cosmoaudition/midi-engine` | deterministic Standard MIDI File projection and opt-in live MIDI helpers |
| `@cosmoaudition/ui-system` | source strata, epistemic marks, visual tokens |
| `@cosmoaudition/api` | local provider boundary, fixtures, cache, snapshot and MASA routes |
| `@cosmoaudition/web` | the observation, patch, transform, route, and archive instrument |

The internal control domain is floating point. MIDI is an optional projection, not the canonical representation.

Snapshots can request an allowlisted subset of the seventeen active API sources. Every emitted signal resolves through the versioned `cosmo/signal-catalog/v0.2` catalog at `/api/signals`, which declares its source, unit, sphere, epistemic status, temporal character, signal kind, and normalization envelope. Provider HTTP bodies, local cache files, fixtures, posted MASA snapshots, and imported audio are independently bounded. Fresh identical acquisitions are coalesced, and provider requests with declared concurrency keys are serialized.

## Source ethics and limits

Each adapter declares endpoint, field, unit, cadence, coverage, attribution, fixture, failure behavior, and observation kind. Current source families include:

- NOAA SWPC space-weather measurements and geomagnetic estimates;
- NASA/JPL predicted close-approach relations;
- NASA/JPL reported fireball events, with optional velocity derived from the documented vector components;
- situated weather, modelled air quality, marine forecasts, and USGS earthquake events;
- NASA EONET open-event aggregates reduced before cache persistence;
- aggregated iNaturalist observation activity;
- Wikimedia infrastructure activity;
- grid, mobility, mempool, browser, and other machine/infrastructure signals.

No family stands for a whole cosmos, atmosphere, biosphere, culture, or planet. Ecological activity is not organism voice or abundance. Wikimedia activity is not global cultural attention. Predicted orbital relations are not live sensors. Fixture observations are attributed to local fixtures rather than their network providers.

## Requirements

- Node.js 22.20 or newer
- pnpm 10.32.1
- a browser with Web Audio support
- optional Web MIDI support for authorized live device output

## Run locally

Install from the existing lockfile:

```bash
pnpm install --frozen-lockfile
```

Development terminals:

```bash
pnpm dev:api
pnpm dev:web
```

The defaults are:

- web: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:8797`

Or build and run the paired local preview with automatic loopback ports:

```bash
pnpm local:preview
```

The server refuses non-loopback bind hosts, non-loopback CORS origins, and requests whose `Host` header is not a loopback authority, so a rebound public domain cannot reach the gateway as a same-origin caller. Provider requests resolve redirects one hop at a time, require HTTPS, and refuse reserved hostnames and literal non-public addresses. DNS resolution and certificate authentication remain Node's platform HTTPS boundary: this code-declared provider client is not a general-purpose SSRF proxy, and a future user-supplied URL surface would need connection-level address enforcement. This repository does not contain a public deployment script.

## Verification

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm e2e
pnpm audit --audit-level=high
```

The full local release check additionally profiles the bundle, packages a local archive, and inspects that archive:

```bash
pnpm release:check
```

## Environment

All variables are optional:

| Variable | Purpose |
| --- | --- |
| `COSMOAUDITION_CACHE_DIR` | source cache directory; defaults to `data/cache` |
| `COSMOAUDITION_MOCK_DIR` | fixture root; defaults to `data/mock` |
| `COSMOAUDITION_CORS_ORIGIN` | comma-separated loopback web origins |
| `COSMOAUDITION_OSC_TARGET` | loopback `host:port` to emit modulation frames over OSC; unset disables it |
| `COSMOAUDITION_OSC_MODE` | `live` (default) or `fixture` acquisition for OSC emission |
| `COSMOAUDITION_OSC_INTERVAL_MS` | OSC cadence, 1000–600000, default 60000 |
| `VITE_API_BASE_URL` | credential-free loopback HTTP origin for the local API; read from the process environment, never a web `.env` file |
| `HOST` / `PORT` | local API bind host and port; non-loopback hosts are refused |

## Privacy and provenance

- Provider credentials, when a future adapter needs them, belong only in the local API process.
- Imported audio bytes remain in the browser session unless the user explicitly exports a derivative.
- Browser time, viewport, latency, and audio-context facts are local observations and are not provider facts.
- No automatic geolocation, analytics, cookies, accounts, or public upload are used.
- A control or modulation receipt means the parameter was scheduled; it does not claim audition.
- A live synthesis state is not represented as an audio artifact unless it is recorded.
- MASA TypeScript tooling 0.2.2 is selected as an unpublished, locally verified validation candidate. It repairs generating-lineage and completed-preservation checks while snapshot records retain the normative MASA 0.2.0 Observation profile. Epistemic status, temporal character, and signal kind remain protocol fields. Runtime dependencies are reviewed package archives, not mutable sibling checkouts. See [`vendor/masa-0.2.2/README.md`](vendor/masa-0.2.2/README.md) for checksums and source provenance. The original public 0.2.0 archives remain unchanged under `vendor/masa/` and are excluded from new local build archives.

## Licensing

The software in this repository is MIT licensed. See [`LICENSE`](./LICENSE).

That grant covers the code, not the data. Three things in this tree carry terms of
their own and are **not** relicensed by it:

- **Provider fixtures under `data/mock/`** are seventeen provider-derived fixtures from
  nine external provider organizations, included so fixture mode is reproducible offline. They remain subject to
  each provider's own terms. Every source declares its attribution and rights
  obligation, collected in the
  [source register](./docs/source-register.md#provider-attribution-and-rights).
- **Live provider responses** fetched at runtime are governed by the terms of the
  provider they came from. This is why attribution and licence notes travel with every
  emitted signal rather than being stripped at the gateway.
- **The selected MASA tooling under `vendor/masa-0.2.2/` and historical `vendor/masa/` release** are MIT from their canonical source
  (`sonicfieldlabs/MASA`), and each archive retains that repository's copyright notice. Only the historical set comes from public tag `v0.2.0`; the candidate has the source identity recorded in its provenance receipt.

Reusing the code and operating the system publicly are separate questions. Sources whose
note says terms need review before public deployment mean exactly that, and
`opensky_states` must stay inactive without a prior written agreement.

Local observation feeds and mapping receipts: [operator runbook](docs/local-operator-runbook.md).

Observation freshness is distinct from transport health. See the [freshness and mapping policy](docs/freshness.md) for live, forecast, aggregate, fixture and archive behavior.
