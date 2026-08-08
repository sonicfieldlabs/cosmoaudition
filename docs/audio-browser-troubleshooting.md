# Audio and browser troubleshooting

Date: 2026-07-28

## No sound

Try:

1. Keep `Fixture / reproducible` selected and press `Take observation`.
2. Press `Listen`.
3. Raise the app `Master Volume`.
4. Check system output device and system volume.
5. Confirm the browser tab is not muted.
6. Press `Panic`, then `Listen` again.

Notes:

- Browser autoplay rules require the explicit `Listen` gesture.
- Fixture mode is enough to hear the instrument; live mode is not required.
- Panic is safe to use at any time.

## Observation fails

Try:

1. Confirm the API health URL responds.
2. Use fixture mode.
3. If using custom ports, run the app with one command:

```bash
API_PORT=8897 WEB_PORT=4174 pnpm local:preview
```

The launcher rebuilds the web app with the matching API URL and passes the web
loopback origin into API CORS.

## Port already in use

Use alternate loopback ports:

```bash
API_PORT=8897 WEB_PORT=4174 pnpm local:preview
```

Do not use `HOST=0.0.0.0`. The API rejects non-loopback hosts.

## Live data looks stale

Use fixture mode for demos. Live mode depends on public providers and may return
stale cache or error states. This is expected behavior, not a reason to invent
replacement values.

## Archive disappeared

The archive is browser-local `localStorage` under
`cosmoaudition.archive.v1`. Clearing site data removes saved observations.

## Imported material does not play

Try:

1. Press `Listen` to create the local audio context.
2. Open `Transform` and choose a supported local audio file.
3. Press `Play loop` and check the bounded material gain.
4. If decoding fails, try WAV, MP3, or another format supported by the browser.

The application does not upload the selected bytes. `Panic` closes this path as
well as the generated field.

## MIDI output is unavailable

Standard MIDI File download does not require a device. Live Web MIDI requires a
supporting browser, an explicit `Authorize MIDI` action, and a selected output.
A successful send reports transmission only; it does not prove reception or
sound.

## Browser is slow or layout looks wrong

Run:

```bash
pnpm e2e
pnpm profile:local
```

The e2e suite checks critical desktop/mobile controls and runtime budgets. The
profile command checks built JS/CSS size budgets.
