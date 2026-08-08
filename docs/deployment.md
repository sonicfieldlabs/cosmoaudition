# Local-only build and packaging

Date: 2026-07-28

Cosmoaudition System currently supports a local Node API bundle and static browser bundle. Public hosting is intentionally outside this transformation.

## Build and preview

```bash
pnpm build
pnpm local:preview
```

Build output:

- `apps/api/dist/server.mjs`
- `apps/web/dist/`

The API binds to `127.0.0.1` by default and rejects non-loopback values. CORS accepts loopback web origins only. The browser bundle calls the local ingestion gateway rather than public providers.

## Package

```bash
pnpm package:local
```

This creates `release/cosmoaudition-system-local-<UTC timestamp>.tgz`. The archive is assembled from an explicit release allowlist: current source, built API and browser assets, fixtures, vendored MASA packages, tests, scripts, and current operator/specification documents. Dependencies, repository metadata, local process material, runtime cache JSON, browser artifacts, and older archives are not included.

## Environment

- `HOST`, default `127.0.0.1`; non-loopback refused.
- `PORT`, default `8797`.
- `COSMOAUDITION_CACHE_DIR`, default `data/cache`.
- `COSMOAUDITION_MOCK_DIR`, default `data/mock`.
- `COSMOAUDITION_CORS_ORIGIN`, comma-separated loopback origins only.
- `VITE_API_BASE_URL`, browser URL for the local API.


## Public-deployment boundary

Before any hosted release, provider terms and attribution must be re-audited, especially NASA/JPL’s website-embedding restriction and every data or media license that can vary per record. A hosted gateway would need production cache, rate, schema, privacy, CSP, abuse, observability, and deletion controls. Public projection of MASA records must redact private paths, precise restricted locations, credentials, provider settings, and unlicensed media. None of that is claimed here.
