# Local operator runbook

Status: active Cosmoaudition System v0.2 operator procedure
Reviewed: 2026-08-11

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
