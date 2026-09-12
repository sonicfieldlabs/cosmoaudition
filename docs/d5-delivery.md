# Mapping receipts, snapshots and local subscribers (D5)

The existing snapshot and MASA export routes remain the catalog export pipeline.
They preserve original observation timestamps, acquisition mode, attribution,
licence notes and source coverage. A new export timestamp does not refresh an
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
snapshot plus the process producer envelope for Oida's O6 observation receiver.
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
