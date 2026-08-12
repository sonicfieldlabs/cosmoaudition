# Cosmoaudition System modulation framework

Contract: `cosmo/modulation/v0.2`
Status: implemented, local-only

Cosmoaudition System is a modulation framework with an instrument attached, not only an instrument. Once the local gateway is running it publishes normalized, attributed, epistemically-typed modulation that any sonic project can consume — SuperCollider, Max, Pd, VCV, TouchDesigner, a Python script, an agent — without inheriting this repository.

## The frame

Every transport carries the same document, a **ModulationFrame**:

| Field | What it holds |
| --- | --- |
| `contract` | `cosmo/modulation/v0.2` |
| `frameId`, `generatedAt` | identity and time of this frame |
| `acquisitionMode` | `live`, `fixture`, or `archive` — how this observation was obtained |
| `originMode` | for a replay, the mode it was originally acquired in |
| `signalCatalog` | `cosmo/signal-catalog/v0.2`, version `0.2.0`, and the `/api/signals` route |
| `signals[]` | value, unit, normalized value, normalization declaration, confidence, staleness, sphere, epistemic status, temporal character, signal kind, and provenance |
| `controls[]` | every mapping decision: target, status, reason, raw and amount-scaled normalization, output, range, curve, smoothing, missing-data policy, epistemic note |
| `absences[]` | every target that produced no value, with its reason |
| `attribution[]` | provider, licence note, coverage limit, and original acquisition mode per contributing source |
| `values{}` | bare target/number pairs, for transports that carry only numbers |
| `masaRecordHref` | where the full MASA account of this moment lives |

Three rules hold on every transport:

1. **A number never travels without its status.** `values{}` exists for convenience; using it without the matching entry in `controls[]` discards the evidence the frame carries.
2. **Absence is emitted, not implied.** A skipped, refused, or held-without-history target appears in `absences[]` with a reason, so a consumer reacts to missing evidence instead of inferring it from a key that failed to appear.
3. **Attribution travels with the signal**, so a downstream work can credit and caveat without reading this repository.

## Transports

### HTTP

```bash
curl 'http://127.0.0.1:8797/api/modulation'            # contract + mapping catalog
curl 'http://127.0.0.1:8797/api/signals'               # signal + normalization catalog
curl 'http://127.0.0.1:8797/api/frame?mode=fixture'    # one frame
curl -N 'http://127.0.0.1:8797/api/stream?mode=fixture&intervalMs=60000'
```

`/api/stream` is Server-Sent Events. It emits `event: frame` on each cadence and `event: acquisition-error` when a cadence produced no observation — the consumer learns that acquisition failed rather than silently receiving the previous frame again. `intervalMs` is bounded to 1 000–600 000: provider cadence is measured in minutes, and a faster stream would repeat one observation rather than acquire a new one.

### OSC

Opt in with an environment variable. The target must be loopback; publishing modulation onto a network is a separate decision with its own threat model.

```bash
COSMOAUDITION_OSC_TARGET=127.0.0.1:57120 \
COSMOAUDITION_OSC_MODE=fixture \
COSMOAUDITION_OSC_INTERVAL_MS=5000 \
pnpm --filter @cosmoaudition/api start
```

Because OSC carries only bare arguments, rule 1 is preserved through a parallel address space:

```text
/cosmo/frame                     frameId, generatedAt, acquisitionMode
/cosmo/control/<target path>     the control value (always float32)
/cosmo/status/<target path>      status, reason
/cosmo/absent/<target path>      status, reason — and no control value at all
/cosmo/frame/end                 control count, absence count (int32)
```

A dotted target becomes a path: `synth.filter.cutoff` → `/cosmo/control/synth/filter/cutoff`. Characters outside the OSC-safe set are escaped as `_<hex>` rather than replaced, so two distinct targets can never collapse onto one address. Control values are always float32 so an address never changes type between frames.

In SuperCollider:

```supercollider
OSCdef(\cutoff, { |msg| ~cutoff = msg[1] }, '/cosmo/control/earth/carbonDrone/filterCutoff');
OSCdef(\cutoffStatus, { |msg| ~cutoffStatus = msg[1] }, '/cosmo/status/earth/carbonDrone/filterCutoff');
```

Reading the control without the status is a misuse of the framework.

### MASA

`/api/snapshot/masa` returns the full provenance record for the same moment: sources, canonical representations, raw and derived observations, authored mappings, control-frame representations, receipts, policy, and lineage. Each frame points at it through `masaRecordHref`. Cosmoaudition is a concrete implementation of MASA 0.2.0's `sonification-system` adapter archetype and uses its Observation profile for the fields that previously lived only in a private extension.

### MIDI

Deterministic Standard MIDI File export and opt-in live Web MIDI remain available from the instrument. MIDI is a projection, not the canonical representation; the internal control domain is floating point.

## What v0.2 deliberately does not do

- **No consumer-supplied mappings.** The framework emits the catalog. Accepting posted mapping definitions means session state, validation, and an authority question, and it is much larger than the rest of this contract combined.
- **Outbound OSC only.** Accepting OSC into the instrument would let any local process set control amounts, which the local-only posture has not answered.
- **No network binding.** Loopback only, like everything else here.
- **The contract stays in this repository** until it has more than one implementation. Extracting it early, as MASA was extracted, would add maintenance without users.

## Boundaries that travel with the frame

A control frame records that a parameter was *scheduled*, never that anything was heard. A frame is an authored relation, not the source's voice. Receiving a frame grants no rights over the underlying provider data — which is why licence notes ride along, and why some of them (non-commercial, share-alike, prior-permission) constrain what a downstream work may do.
