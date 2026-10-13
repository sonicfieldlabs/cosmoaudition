# Local operator runbook

Current local operator procedure.

## Local-only rule

Do not expose Cosmoaudition System on a public network. Do not run the API with
`HOST=0.0.0.0`. The API rejects non-loopback hosts by default.

## One-command local preview

```bash
pnpm local:preview
```

Defaults:

- Web: `http://127.0.0.1:4173/`
- API: `http://127.0.0.1:8797/`

The launcher rebuilds:

- API artifact: `apps/api/dist/server.mjs`
- web bundle: `apps/web/dist`

It bakes the local API URL into the web bundle and starts both processes. Press
`Ctrl-C` to stop both.

## Alternate local ports

```bash
API_PORT=8897 WEB_PORT=4174 pnpm local:preview
```

The launcher still binds only to `127.0.0.1`.
It also passes the selected web loopback origin into the API CORS allowlist, so
custom local preview ports can load snapshots.

## Manual preview

Terminal 1:

```bash
pnpm build
pnpm preview:api
```

Terminal 2:

```bash
pnpm preview:web
```

Use the one-command launcher when changing API ports, because it rebuilds the
web bundle with the matching `VITE_API_BASE_URL`.

## Operator references

- Short install/run path: `docs/local-quickstart.md`
- Instrument architecture: `docs/cosmoaudition-system.md`
- Source and claim boundaries: `docs/source-register.md`
- Mapping decisions: `docs/mappings/mapping-contract.md`
- Audio/browser help: `docs/audio-browser-troubleshooting.md`

## Release archive

Create:

```bash
pnpm package:local
```

Verify:

```bash
pnpm verify:release
```

Profile built web assets:

```bash
pnpm profile:local
```

Full local release check:

```bash
pnpm release:check
```

Dependency advisory audit:

```bash
pnpm audit --audit-level high
```

The dependency audit needs network access and the package advisory service, so
it is documented separately from deterministic local release verification.

Restore package elsewhere:

```bash
mkdir cosmoaudition-local
tar -xzf release/cosmoaudition-system-local-YYYYMMDDTHHMMSSZ.tgz -C cosmoaudition-local
cd cosmoaudition-local
pnpm install --frozen-lockfile
pnpm local:preview
```

## Troubleshooting

Port already in use:

- Choose alternate local ports with `API_PORT=... WEB_PORT=... pnpm local:preview`.
- Keep API and web ports on loopback only.

No sound:

- Keep `Fixture / reproducible` selected and press `Take observation`.
- Press `Listen`; audio starts only from this explicit browser gesture.
- Check browser tab audio, system volume, and output device.
- Use `Panic`, then press `Listen` again.

Observation fails:

- Use fixture mode for deterministic local demos.
- Confirm the API health endpoint responds on the selected port.
- If live mode fails, stale/error states should remain visible.

Imported material does not play:

- Press `Listen` before loading or playing local material.
- In `Transform`, choose a browser-readable audio file, then press `Play loop`.
- Imported bytes remain in the browser and are not uploaded by the application.
- Live processing is not a recorded derivative.

Archive missing:

- Archive entries are stored in browser `localStorage` under
  `cosmoaudition.archive.v1`.
- Clearing site data removes archived observations.

Cache confusion:

- Runtime cache JSON lives under `data/cache`.
- Parameter-dependent sources use different cache entries for different
  coordinates or query windows.
- Release packages exclude cache JSON and keep fixtures under `data/mock`.

## Build reuse

`pnpm build` records hashes of tracked build inputs, build settings and generated
outputs. `pnpm package:local -- --skip-build` accepts only an unchanged successful
build. Missing receipts, unfinished builds, changed source/configuration, changed
build settings and changed outputs require a fresh build. Receipts are ignored
local files; they are not public qualification records.

## Mapping receipts, snapshots and local subscribers

The existing snapshot and MASA export routes remain the catalog export pipeline.
They preserve original observation timestamps, acquisition mode, attribution,
licence notes and source coverage. An export timestamp does not refresh an
old or constructed observation. The posted MASA snapshot route can retain
explicit held/refused decisions using its existing route/previous-output fields;
non-actions remain non-actions. No new public export sanitizer is introduced.

`GET /api/generation-frame?mode=fixture|live` reuses the core mapping executor
for three prompt-parameter intentions: carbon intensity → duration 0.1–30 s,
quake count → integer steps 1–250, coal proportion → guidance 0–25. Every
assignment carries its receipt ID, source clock, capture clock, input/output
ranges, curve, attribution, evidence class, decision status and reason. Execution
is `not_requested`. Held, skipped, uncertainty and refused decisions remain
visible. GERM explicitly chooses assignments and intermodulation before running
its own bounded generation provider. These are intention receipts, not claims
that an AudioParam was scheduled or a person heard sound.

`GET /api/observation-feed?mode=fixture|live` supplies the existing validated MASA
snapshot plus the process producer envelope for Oída's observation receiver.
The relation remains `signal` and the source register remains non-acoustic.
Oida's owner-requested poll reuses its existing operation and consent controls.
Reconnect means a new poll, not durable process replay. No source observation is
silently reclassified as acoustic capture.

All endpoints remain behind the existing loopback authority/Origin boundary.
Public delivery belongs to a separately configured application projection
service. The artifact app uses a copied, attributed GERM browser wavetable
component for an explicit local variation of a permitted fixture snapshot.
It does not expose a public Cosmo gateway, rewrite the source, or claim that
browser rendering is identical to the server DSP.

The authoritative release gate is `pnpm release:check`. Local source-equivalent
isolation is permitted for checking accumulated uncommitted input without
staging the working repository; evidence records hashes and the isolated scope.
