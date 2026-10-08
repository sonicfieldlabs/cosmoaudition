# Source register and transduction limits

Status: active local v0.2 register, 2026-08-11

Cosmoaudition System currently collects seventeen API source families through its loopback ingestion gateway. Fixture mode supplies one reproducible payload per family; live mode applies timeouts, response bounds, parameter-aware caching, last-known-good state, and explicit nulls on unrecoverable failure. A snapshot may select an allowlisted subset. Source health follows the selected aperture, while `source_stale_count` remains normalized against the full active aperture so its scale does not change when a subset is requested.

“Cadence” is the earliest local refresh interval, not a promise that a provider publishes at that rate. Provider observation time and local fetch time remain separate.

## Active source families

| Stratum | Source | Initial cadence | Observation kind | Material/control use | Limit |
| --- | --- | ---: | --- | --- | --- |
| Cosmos | NOAA SWPC solar-wind speed | 60 s | reported near-real-time measurement | microsonic clock, playback-rate control, cosmic field | Operational L1 product can be interrupted or switch upstream spacecraft. |
| Cosmos | NOAA SWPC magnetic Bt and signed Bz GSM | 60 s | reported near-real-time measurement | spectral aperture, bipolar modulation | Bz sign is preserved; normalization midpoint represents zero. |
| Cosmos | NOAA SWPC planetary K index | 5 min | estimated planetary index | slow scene energy with long smoothing | Estimate, not a local magnetometer and not one event per update. |
| Cosmos | NASA/JPL close approaches, next seven days within 0.2 AU | 6 h | predicted catalogue relation; time-to-event is derived and stably keyed | scheduling horizon, delay field, deduplicated event projection | Not a live detector, impact warning, or acoustic property. Sequential cached requests only. |
| Cosmos | NASA/JPL reported fireballs, rolling thirty days | 6 h | reported peak-brightness events; optional speed derived from `vx/vy/vz` | deduplicated impact-energy event control, filter resonance, inspection | Dataset coverage and optional fields are incomplete; not a live detector or warning service. |
| Atmosphere | Open-Meteo current conditions at manual coordinates | 10 min | reported current/forecast service value | filter, wind, precipitation controls | One selected point, not planetary weather. Fixture is truthfully Bogotá-only. |
| Atmosphere | Open-Meteo air quality at manual coordinates | 30 min | modelled CAMS-domain forecast values | particulate and gas concentration control fields | Not a local regulatory monitor; one manually selected point. |
| Hydrosphere | Open-Meteo marine conditions at manual coordinates | 30 min | marine-model forecast | wave, sea-surface, current, and sea-level fields | Not an in-situ buoy; inland or unsupported points remain explicitly null. |
| Geosphere | USGS earthquakes, past hour | 5 min | preliminary event aggregate | restrained resonator density and event field | Publication latency and later revision remain possible; not an alert service. |
| Geosphere | NASA EONET open events, bounded thirty-day aperture | 30 min | privacy-reduced catalogue aggregate | event-density and recency fields | At most 200 reported open events; not complete global incidence or hazard severity. |
| Biosphere | iNaturalist submissions created in the previous hour | 5 min | privacy-reduced platform aggregate | filtered-noise body and activity density | Provider rows are reduced before cache persistence; submission activity is not abundance, ecological health, or organism voice. |
| Human activity | Wikimedia all-project user pageviews, latest two complete hours | 15 min | delayed aggregate plus derived change | bipolar drift and continuous macro-control level | Wikimedia activity is not an event, culture, or collective attention as a whole. |
| Machine / infrastructure | GB grid carbon intensity | 30 min | regional reported/forecast value | carbon drone filter | Great Britain only. |
| Machine / infrastructure | GB electricity generation mix | 30 min | regional aggregate | energy-mix voices | Electricity share is not complete ecological impact. |
| Machine / infrastructure | mempool.space mempool statistics | 60 s | network aggregate | granular/noise density | Bitcoin mempool only. |
| Machine / infrastructure | mempool.space hashrate/difficulty | 30 min | network/mining aggregate | FM depth and cloud-computation field | Proxy for Bitcoin computation, not total cloud heat or energy. |
| Machine / infrastructure | Bogotá GBFS station status | 30 s | situated mobility aggregate | pulse rate | One public-bike system, not total urban movement. |

Browser-local clock, viewport, API latency, AudioContext state, and archive state are additional local observations. They are never attributed to an external provider.

## Blocked source

`opensky_states` is defined but must not be activated. The OpenSky Network's terms of use require a previous written agreement for operational REST API use, including integration into any automated system even if only internal, and limit the REST API to non-profit research and education. A polling instrument is exactly such a system. Anonymous requests still succeed technically, which is why this is recorded here rather than left to a future reader to discover. Verified 2026-08-07.

## Provider endpoints and primary documentation

- NOAA SWPC summaries: `https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json`, `solar-wind-mag-field.json`, and `https://services.swpc.noaa.gov/json/planetary_k_index_1m.json`; product context: `https://www.swpc.noaa.gov/products/real-time-solar-wind`.
- NASA/JPL CAD API: `https://ssd-api.jpl.nasa.gov/cad.api`; contract and fair-use rules: `https://ssd-api.jpl.nasa.gov/doc/cad.html` and `https://ssd-api.jpl.nasa.gov/doc/index.php`.
- NASA/JPL Fireball API: `https://ssd-api.jpl.nasa.gov/fireball.api`; v1.2 contract: `https://ssd-api.jpl.nasa.gov/doc/fireball.html`; the adapter requests `vel-comp=true` and does not depend on undocumented convenience fields.
- Open-Meteo forecast endpoints: `https://api.open-meteo.com/v1/forecast`, `https://air-quality-api.open-meteo.com/v1/air-quality`, and `https://marine-api.open-meteo.com/v1/marine`.
- NASA EONET v3 events: `https://eonet.gsfc.nasa.gov/api/v3/events`; API contract: `https://eonet.gsfc.nasa.gov/docs/v3`.
- USGS GeoJSON feed: `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson`; feed documentation: `https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php`.
- iNaturalist API and request practice: `https://api.inaturalist.org/v1/docs/` and `https://www.inaturalist.org/pages/api+recommended+practices`.
- Wikimedia aggregate pageviews: `https://wikimedia.org/api/rest_v1/metrics/pageviews/aggregate/`; access policy: `https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/documentation/access-policy.html`.
- UK Carbon Intensity API: `https://api.carbonintensity.org.uk/`.
- mempool.space API: `https://mempool.space/docs/api/rest`.
- GBFS specification: `https://gbfs.org/`.

## Provider attribution and rights

Every source definition in `packages/core/src/sources.ts` carries a `licenseNote`
that travels with the emitted signal. This table collects those declarations so a
reader does not have to read the source to find them. It records what each provider
requires of this project; it is not legal advice and it does not restate the
providers' full terms, which govern and can change.

| Provider | Sources here | Fixture shipped | Declared obligation |
| --- | --- | :---: | --- |
| NOAA SWPC | solar-wind speed, magnetic field, planetary K index | yes | Public operational product; attribution required. |
| NASA/JPL | close approaches, fireballs | yes | Public API; attribution and API fair-use rules apply. |
| NASA EONET | bounded open-event aggregates | yes, aggregate only | Public API attribution applies; upstream event-source attribution remains provider-specific. |
| USGS | earthquakes | yes | Public feed; attribution required. |
| Open-Meteo | local current conditions, air quality, marine forecast | yes | API and upstream model attribution requirements apply. |
| iNaturalist | recent observation activity | yes | Attribution and recommended request-rate practices; no user, media, or precise-location fields are emitted. |
| Wikimedia | hourly pageviews | yes | Attribution and identifying User-Agent requirements apply. |
| Carbon Intensity GB | carbon intensity, generation mix | yes | Public API; attribution required. |
| mempool.space | mempool stats, hashrate | yes | Public API; attribution required. |
| GBFS feed (Bogota) | station status | yes | Feed attribution required; public deployment terms need review. |
| MobilityData | GBFS systems registry | no | Registry attribution required. |
| CoinGecko | BTC reference price | no | Public API with rate-limit risk; attribution required. |
| Our World in Data | oil production | no | Grapher dataset attribution and license metadata required. |
| World Bank | population | no | Public API; attribution required. |

Locally generated sources — engine state, browser clock, fetch latency, window size,
audio-context state, the deterministic modulation bank, and the local archive — carry
`Generated locally; no external license.` and impose no external obligation.

Two defined sources stay inactive on rights grounds rather than technical ones:
`opensky_states` (see [Blocked source](#blocked-source)) and `yahoo_oil_cl`, whose
terms require review before any public deployment.

## Runtime states

An adapter can produce:

- a fresh live observation;
- an explicit fixture observation;
- a stale last-known-good observation retaining its original time;
- a partially valid observation in which malformed fields are null;
- an unavailable/error observation with null values.

Cache fallback never changes a source's coordinates, query window, or provider. A cached payload is accepted only when its source ID and cache variant match. Writes use a temporary sibling followed by atomic rename.

Fresh cache entries are read before network access, identical in-flight loads are coalesced, and provider concurrency keys serialize requests when fair-use guidance requires it. Provider JSON is response-size bounded, content-type checked when declared, decoded as strict UTF-8, and parsed before caching. A live failure uses a matching cache only; fixtures are never substituted into live mode unless an adapter explicitly opts into that policy.

The iNaturalist live response is reduced in memory to count, query window, and
newest creation time before persistence. User, observation, taxon, media, and
coordinate fields cannot enter its cache envelope. NASA EONET responses are
likewise reduced before persistence to bounded category counts and the latest
geometry time; titles, upstream URLs, event rows, and coordinates do not enter
the cache.

## Mapping discipline

Source values remain in their units. Mappings declare input range, curve, output range, smoothing, target, and missing-data policy. Signed physical values such as Bz and hourly pageview change remain signed. Log mappings are used only for strictly positive, wide-range values. Data magnitude never maps directly to master loudness.

The generated control field has restrained cosmic, biospheric, and cultural voices selected by semantic mapping targets. This is an instrumental organization of control decisions, not a claim that the source domains share one substance or voice. Stable event keys are projected and deduplicated separately from continuous control; stale cached events cannot become fresh trigger pulses. The same executable decisions can separately condition imported material and MIDI.

## Deferred expansions

### Operator-provided observation packets

`cosmo/local-observation/v1` admits a bounded offline `grib-forecast` or
`account-report` packet. Required fields include source fingerprint, attribution,
licence note, rights reference, coverage, issue/fetch timestamps with time zone,
TTL and up to 4,096 uniquely identified points. Account references are opaque
identifiers, never login secrets or URLs. Future account aggregates are refused;
forecast validity is separate from issue time. Non-finite values and malformed
packets are refused. Stale data becomes null with stale status; normalization is
not invented and independently verified remains false.

The local API's fixed `GET /api/local-observations` reads only the operator's
`COSMOAUDITION_LOCAL_OBSERVATION` file. Requests cannot choose a path. The reader
refuses symlinks, nonregular files, changes during a bounded read and packets over
2 MiB. With no configured file it returns unavailable. There is no account login,
remote import, provider cache or automatic control mapping.

```sh
pnpm exec tsx scripts/import-local-observation.mts packet.json 2026-10-08T00:00:20Z
```

`scripts/import-grib.py` optionally decodes local GRIB using an explicitly
provisioned isolated Python environment. `scripts/requirements-grib.txt` records
the exact codec dependency cohort used for generated qualification. The application
does not install it on browse/startup or download source data. ecCodes/eckit native
libraries carry Apache-2.0 licences; their exact installed metadata and licence
file hashes are qualification evidence, independent of the input's rights.

The decoder freezes a regular nonsymlink source of at most 32 MiB, admits at most
16 messages and 4,096 total grid points before expanding arrays, binds coordinates
and raw source SHA-256, and preserves issue/forecast validity and missing values.
The CLI isolates native decoding in a worker with a 15-second deadline and bounded
output. It requires source ID, attribution, licence, rights, coverage and fetch time.
Run `python scripts/import-grib.py --help` for the exact arguments. Generated GRIB2
roundtrip evidence establishes codec/import behavior only. Real weather data,
source-specific availability, rights, credentials, provider rate limits and account
reports still require separate qualification.

Candidates for a later, independently reviewed adapter phase include NOAA CO-OPS coastal water level/wind, MET Norway forecast with required identifying headers, Wikimedia EventStreams with one server-side SSE aggregator and immediate personal-field removal, GBIF as slow ecological context, ECB daily statistics, and credentialed Copernicus Marine products. They are not operational merely because they are named here; the new Open-Meteo marine forecast does not replace an in-situ coastal station or a credentialed ocean product.
