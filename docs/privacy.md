# Privacy and source minimization

Date: 2026-07-28

Cosmoaudition System is local-first and private by default. The browser calls only the loopback API. The API contacts declared public providers in live mode, reduces their responses to the fields required by the instrument, and retains provider identity, timing, quality, coverage, and attribution.

## Browser to local API

Snapshot requests include:

- `mode=fixture` or `mode=live`;
- the manually selected latitude and longitude for situated weather sources.

There is no automatic geolocation. Preset coordinates are static and custom-coordinate support, when enabled, requires explicit input.

## Local browser material

The following stays in the browser:

- imported audio bytes and decoded AudioBuffer;
- patch, output, and material-processor controls;
- up to twelve archived observations in `cosmoaudition.archive.v1`.

Browser-session signals — fetch latency, local clock, viewport area, and
AudioContext sample rate — are produced in the browser and are never sent to a
public provider. They do leave the page in one explicit, user-initiated case:
requesting a MASA export posts the current snapshot, including these signals,
to the loopback gateway, which embeds them in the downloadable record. Nothing
is transmitted off the machine, and no export happens without the gesture.

Clearing site storage removes the archive. An imported sound is not uploaded by the application. Live playback does not create an audio derivative unless recording/export is explicitly implemented and invoked.

## API cache

Provider payloads may be cached under `data/cache`. Parameter-dependent sources use parameter-dependent keys; locality caches cannot be shared across coordinates. A failed request may expose an explicitly stale last-known-good entry, retaining its original time. It never turns failure into zero.

iNaturalist is reduced in memory to an aggregate count, query window, and newest
creation time before the cache write. Provider observation rows, users, taxa,
media, and coordinates are not persisted.

## Data reduction

Ecological and human-activity adapters retain aggregate counts needed for control. Usernames, comments, page titles, precise sensitive biological coordinates, and media are not needed and are not placed in normalized observations or public-ready records. An aggregate still represents platform activity, not biological abundance or global culture.

## Not used

- analytics, advertising, cookies, or account tracking;
- automatic geolocation;
- direct browser calls to public data providers;
- public upload or synchronization;
- autonomous agents;
- secret-bearing source providers in the initial local slice.

## MASA and export

Local MatterRecords use private disclosure. A snapshot MASA record includes canonical parsed data, source identity, fixture/live acquisition mode, observation and mapping decisions, policy, and integrity. It does not include private filesystem paths. Public web publication would require a separate public projection and provider-rights review.
