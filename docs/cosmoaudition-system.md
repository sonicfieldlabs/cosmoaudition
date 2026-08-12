# Cosmoaudition System: local instrument architecture

Status: active implementation contract, 2026-08-11

Cosmoaudition System is the Sonic Matter Framework's interactive observation machine and data-conditioned sound instrument. It receives bounded observations from heterogeneous cosmic, atmospheric, hydrospheric, terrestrial, ecological, cultural, economic, and computational sources; preserves their differences; derives declared relations; and makes those relations available as audio parameters, event triggers, MIDI, control frames, and transformations of imported sonic material.

It does not claim to reveal the intrinsic sound of a planet, body, species, institution, or dataset. Every audible or actionable result is an authored material transduction through a specific source, field, normalization, temporal window, mapping, processor, apparatus, and listening situation.

The [modulation contract](./modulation-framework.md) governs the transport surface, the signal catalog fixes normalization semantics, and the protocol boundary is the published MASA 0.2.0 release.

## Operational chain

```text
provider or fixture
  → canonical parsed payload
  → source observation
  → optional derived observation
  → explicit mapping decision
  → control frame
  → audio / material processor / trigger / MIDI projection
  → optional recorded derivative
  → bounded MASA record, receipts, lineage, and export
```

No link is equivalent to the one before it. A provider value is not an audible property; a normalized value is not a measurement; a completed Web MIDI call is not evidence that another instrument sounded; a live synthesis state is not an audio artifact unless it is recorded.

## Source strata

| Stratum | Initial operational material | Function and limit |
| --- | --- | --- |
| Cosmos | NOAA SWPC solar wind, magnetic field, Kp; NASA/JPL close approaches and reported fireballs | Space-weather measurements, predicted encounter relations, and incomplete reported atmospheric events; not a universal cosmos. |
| Atmosphere | local weather and modelled air-quality forecasts | Situated atmospheric conditions; model forecast remains distinct from a local instrument reading. |
| Hydrosphere | marine-model forecast at manual coordinates | Wave, sea-surface, current, and sea-level conditions; not a buoy, and inland absence remains null. |
| Geosphere | USGS earthquake events and bounded NASA EONET aggregates | Preliminary or catalogue-reported events; not an alert service, severity measure, or complete planetary total. |
| Biosphere | aggregated recent iNaturalist activity | Human-contributed observation activity; never organism voices or total biodiversity. |
| Human activity | Wikimedia activity and slower economic statistics where enabled | Activity on named infrastructures; not global culture or social totality. |
| Machine/infrastructure | grid, mobility, mempool, browser, and local engine state | Specific computational and civic systems; not “technology” in general. |

Each adapter owns its endpoint, cadence, schema boundary, attribution, rights note, coverage, quality interpretation, fixture, cache variant, and failure behavior. Location-dependent caches include rounded coordinates. Missing values remain missing. Last-known-good values retain their original observation time and acquire an explicit stale/fallback state.

## Temporal behavior

Sources are not forced onto one clock. The scheduler respects provider cadence and cache directives:

- event or one-minute feeds may refresh once per minute;
- weather follows its provider expiry;
- ecological activity is aggregated at multi-minute cadence;
- predicted close approaches refresh over hours;
- slow economic or archival data refresh daily or less.

The interface may smooth a control between accepted frames, but it cannot fabricate intermediate observations. Deduplicated stable event identifiers generate triggers. Aggregate values never become events merely by changing or being non-zero, and stale cached events do not fire as fresh pulses. Revisions update an event relation rather than masquerading as a new occurrence.

## Mapping decision contract

A mapping decision has one of five statuses:

- `applied`: a valid, fresh-enough observation produced a bounded control value;
- `held`: an explicitly configured last valid control is retained, with its age;
- `skipped`: no control is emitted;
- `uncertainty`: a bounded control is emitted while retaining its low or stale evidence state;
- `refused`: policy or operator choice prohibits the mapping.

Every applied mapping records observation reference, source field and unit, input window, transform, clamp, curve, smoothing, cadence, target, output range, value, actor, software version, and epistemic note. Operator enable state and amount are executable inputs, not display-only settings. Null, unavailable, stale, or malformed values are never silently turned into zero, minimum, or neutral midpoint.

The `cosmo/signal-catalog/v0.2` document at `/api/signals` is the canonical declaration for each signal's source, layer, unit, sphere, epistemic status, temporal character, signal kind, and normalization method/range. These ranges are authored modulation envelopes, not asserted physical extrema or safety thresholds. Modulation frames carry the matching catalog contract and normalization metadata so downstream consumers do not have to reconstruct them from prose.

## Sound and control

The internal control domain is normalized floating point plus declared bipolar controls. MIDI is an optional projection:

- continuous variables use CC or higher-resolution data where available;
- deduplicated events may use notes or trigger frames;
- pitch is an authored register, never a claim about source frequency;
- channels group source strata but remain editable;
- live MIDI requires an explicit permission gesture and names the chosen destination;
- a deterministic Standard MIDI File export remains available without device permission.

The audio engine has two related but distinct practices:

1. **Generated field:** conservative oscillators, noise, impulses, resonators, filters, and delay are conditioned by control frames.
2. **Material transformation:** a user imports an audio representation; the original buffer remains the parent while filter, rate, spectral, delay, granular, spatial, or morphological parameters are driven by mapped controls.

A transform is attributable to the imported parent and its control-frame lineage. Live playback alone does not create a derivative artifact. Recording or export creates a new representation and a transformation receipt.

The local deterministic generator bank is a third control source, not an observation provider. Clock, pulse, sine LFO, cyclic envelope, and seeded sample-and-hold signals record algorithm, phase origin, rate, and seed. They may address the same mapping and processor infrastructure, but never substitute for unavailable external evidence.

## MASA integration

Cosmoaudition vendors immutable MASA TypeScript tooling rather than depending on a mutable sibling checkout. The current boundary is the public MASA 0.2.0 release (`sonicfieldlabs/MASA`, tag `v0.2.0`) and its canonical identifiers under `https://masa.sonicfield.org/`. One explicit snapshot or bounded performance take creates one MatterRecord with the `core`, `observation`, and `mapping` profiles. Raw and mapping-derived observations carry `epistemicStatus`, `temporalCharacter`, and `signalKind` as normative Observation-profile fields. A recorded generated render adds `audio` and `generation`; a recorded imported-material descendant adds `audio` and `transformation`. The imported-material path remains the bounded Web Audio chain described above.

An archived observation replayed from the browser archive carries the mode it was acquired in, so a replayed fixture stays attributed to its local fixture and never acquires a live provider locator.

The bounded record includes:

- software and human actors;
- provider/fixture Sources with health and freshness;
- a canonical JSON Representation of the accepted snapshot;
- source Observations and derived-index Observations;
- only concrete Mappings that reference present observations;
- ControlFrame Representations for consequential control or MIDI output;
- explicit relations and operation receipts;
- local policy and disclosure state;
- validation result and content integrity where bytes exist.

Fixture ingestion is attributed to a local fixture, not to a live provider. Failed live operations have no output. A later fixture or cache fallback is a distinct completed operation. A completed modulation receipt means “scheduled to the named engine parameter,” not “heard.” `agentRuns` remains empty until an actual authorized agent workflow exists.

## Package responsibilities

| Package | Responsibility |
| --- | --- |
| `@cosmoaudition/core` | source vocabulary, signal contracts, indices, executable mapping decisions, sessions |
| `@cosmoaudition/masa` | bounded MatterRecord builder, validation, projections, receipts |
| `@cosmoaudition/audio-engine` | safe synthesis, imported-material path, validated control routing |
| `@cosmoaudition/midi-engine` | deterministic MIDI projection and opt-in live output |
| `@cosmoaudition/ui-system` | visual tokens and shared accessible primitives |
| `@cosmoaudition/api` | provider boundary, schemas, cache, scheduler, canonicalization, bundle export |
| `@cosmoaudition/web` | observation, patching, performance, inspection, local archive, export |

## Local-first security and privacy

The initial server binds only to loopback. Secrets are never shipped to the browser. Provider responses are size-bounded, strict-UTF-8 decoded, JSON validated, and cached atomically; identical acquisitions are coalesced and provider fair-use queues are serialized where declared. Browser snapshots and MASA projections are reduced to necessary fields. Imported audio is bounded both before decode and by decoded sample-value budget. Exact sensitive biological coordinates, usernames, comments, page titles, and other personal identifiers must be removed before any cache or record can leave the private local runtime. The browser can function from fixtures without a network connection.

Local records are private by default. A future public web publication receives a separately generated public projection that removes private paths, credentials, exact restricted locations, provider settings, and unlicensed media.

## v0.2 completion criteria

The local v0.2 system is complete when:

1. active project identity is Cosmoaudition System;
2. fixture mode exercises every active source reproducibly, including explicit inland marine absence;
3. live adapters fail visibly and safely without converting failure to signal;
4. mapping decisions are executable and missing-data safe;
5. the user can observe, patch, transform imported audio, and export control/MIDI/MASA accounts;
6. tests validate adapters, signal-catalog coverage, pre-persistence aggregate reduction, mapping decisions, MASA reference closure, MIDI bytes, audio safety, responsive behavior, and keyboard flow;
7. build, typecheck, unit, browser, and dependency audits pass locally.
