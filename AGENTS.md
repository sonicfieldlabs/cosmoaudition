# Cosmoaudition repository contract

This repository holds Cosmoaudition System, a modulation framework and local instrument.

## Git commit conventions

- **Never add `Co-Authored-By` lines or any AI attribution trailer to a commit message.** Commits carry the human author's identity only. No assistant, tool, or model is listed as an author, co-author, or contributor.
- Commit messages describe the change and its reason in plain prose. No generated-with footers, no tool signatures, no emoji badges.
- Do not commit, push, merge, create, or delete anything without explicit instruction.

## What belongs in this repository

Only what the system needs to run, be verified, and be understood:

- source under `apps/` and `packages/`, plus the fixtures in `data/mock/` that make fixture mode reproducible;
- the vendored MASA release under `vendor/masa/` with its checksums;
- current specifications and operator documentation under `docs/`;
- scripts and test suites.

Deliberately excluded: private working material, build output, `node_modules/`, the package store, Playwright artifacts, the runtime cache under `data/cache/`, and local build archives under `release/`.

Nothing in this repository may contain credentials, provider keys, absolute home-directory paths, private endpoints, or personal data. The gateway reaches providers over public HTTPS only; there are no internal or private routes to protect, and no `.env` file is expected.

## Invariants

- The runtime is loopback-only. It refuses non-loopback bind hosts, CORS origins, and request authorities, and provider redirects may not leave public HTTPS.
- Missing, stale, refused, and held values never become numbers. A control value never travels without its decision status.
- A control or modulation receipt records that a parameter was scheduled, never that anything was heard.
- Fixture mode is evidence of software behavior, not of current external observation. It cannot catch provider drift, so check `GET /api/sources?mode=live` before a release.
- Attribution, licence notes, and coverage limits travel with every emitted signal.

## Verification

Run before calling any change complete:

```bash
pnpm typecheck && pnpm test && pnpm build && pnpm e2e && pnpm verify:release && pnpm audit --audit-level=high
```
