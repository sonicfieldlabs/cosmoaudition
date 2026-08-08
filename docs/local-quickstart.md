# Cosmoaudition local quickstart

Date: 2026-07-28

Requirements: Node.js 22.20+, pnpm 10.32.1, and a browser with Web Audio. Web MIDI is optional.

```bash
pnpm install --frozen-lockfile
pnpm local:preview
```

The launcher selects loopback ports, normally web `http://127.0.0.1:4173/` and API `http://127.0.0.1:8797/health`. It refuses public bind hosts.

## Reproducible first path

1. Keep Input on **Fixture / reproducible**.
2. Press **Take observation**. The bundled weather fixture is explicitly
   Bogotá-only; locality selection applies to live weather requests.
3. Inspect the orbital field and select a signal.
4. Press **Listen** to start Web Audio after an explicit gesture.
5. Open **Patch** and apply or skip a route.
6. Open **Transform**, choose a local sound, and play it through the material processor.
7. Open **Route** to export observation JSON, control frames, MIDI, or a validated MASA record.
8. Open **Archive** to save a bounded browser-local observation.
9. Press **Panic** at any time to close audio paths.

Live mode uses network providers and is not deterministic. Provider failure stays visible and is never substituted with an invented value.

## Verification

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm e2e
pnpm audit --audit-level=high
```

Press `Ctrl-C` to stop the paired local preview.
