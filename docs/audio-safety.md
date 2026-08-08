# Audio safety

Status: active Cosmoaudition System v0.1 behavior
Date: 2026-07-28

## Implemented rules

- Audio starts only from the explicit `Listen` browser gesture; there is no
  autoplay path.
- Master gain defaults to 38%, and the output stage retains headroom below
  unity after the dynamics limiter, so even the limiter's ceiling reaches the
  device attenuated.
- Six internal layer buses have independent gain, stereo placement, analysis,
  and smoothed parameter changes.
- `Panic` cancels gain, stops generated and imported-material paths, closes the
  `AudioContext`, and leaves the engine in a visible panicked state.
- Missing, malformed, and rejected controls do not become minimum values,
  neutral midpoints, or hidden gain.
- Stale/error state uses restrained uncertainty sound rather than an alarm.
- Source magnitude never maps directly to master loudness.

## Generated field

The engine uses carbon, energy-mix, earthquake, hashrate, mempool, mobility,
weather, browser, and stale-state modules. A tenth
`controlFieldVoice` receives only executable mapping decisions and produces
restrained cosmic, biospheric, and cultural control fields.

These voices are authored instrumental relations. They are not the acoustic
voice, intrinsic frequency, or audible essence of a source domain.

## Imported material

- A selected audio file is decoded and processed locally in the browser.
- The path is buffer source → playback rate → filter → delay field → bounded
  material gain → safe master.
- Catalog or selected-signal decisions can modulate declared material controls.
- The original buffer remains the parent representation.
- Live playback creates no derivative artifact unless recording/export is
  explicitly implemented and invoked.

## Known limits

- Node tests validate mapping, routing, control bounds, missing-data behavior,
  and material parameter validation, but cannot prove what a person heard.
- Browser automation verifies explicit start and Panic state transitions; it is
  not a substitute for device-level listening checks.
- The system does not record audio in v0.1.

## Manual check

1. Run `pnpm local:preview` and keep system volume low.
2. Select `Fixture / reproducible` and press `Take observation`.
3. Press `Listen`; confirm the status reports a running engine.
4. Adjust master gain conservatively and inspect applied routes in `Patch`.
5. Optionally load a local sound in `Transform`, play it, and stop it.
6. Press `Panic`; confirm generated and imported-material paths stop.
