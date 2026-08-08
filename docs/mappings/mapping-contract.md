# Mapping contract

Date: 2026-07-29
Package: `@cosmoaudition/core`

## Purpose

Mappings are declarations, not hidden audio code. Each `SonicMapping` records
which signal addresses which control target, the scale, input/output ranges,
smoothing time, missing-data policy, description, and epistemic note.

The `Patch` workspace renders their current executable decisions so the source
observation and authored control relation remain distinct.

`ObservedSignal` is the project-neutral canonical envelope. External
measurements, infrastructure aggregates, local observations, derived values,
and declared generators can all enter the same control contract without
becoming equivalent.

## Null and stale rule

Missing values must remain missing:

- `value: null` means no numeric measurement exists.
- `normalized: null` means no normalized control value exists.
- `confidence: stale` means the value is old enough to become a state of the system.
- `confidence: error` means the adapter failed or the payload did not validate.

Core helpers must not convert these states into invented zeros. Derived indices skip null, stale, and error components, then report the skipped components and degraded confidence.

Execution produces one explicit status:

- `applied`: a bounded output was produced;
- `held`: a valid previous output was retained by declared policy;
- `skipped`: no output was emitted;
- `uncertainty`: a bounded mapping output was emitted while retaining low or stale evidence status;
- `refused`: the mapping or policy prohibited output.

Only decisions with a non-null, in-range output can reach audio, imported
material, MIDI, or another control destination.

The operator route amount scales traversal of the declared output range and is
recorded in the decision. Disabling a route yields `route-disabled`; it never
silently emits the range minimum. Categorical mappings require an explicit,
unique value-to-output table. Interpolation refuses execution until attributed
history and a declared method are available.

## Normalization

Available helpers:

- `clamp01`
- `linearNormalize`
- `nullableLinearNormalize`
- `logNormalize`
- `nullableLogNormalize`
- `quantize`
- `weightedMean`
- `smoothValue`

Use logarithmic normalization for large-scale planetary or infrastructural values such as hashrate, mempool size, production, population, and aircraft counts. Do not map large values linearly without a written reason.

## Derived indices

Indices are compositional instruments, not truth claims:

- `SPI`: Stack Pulse Index
- `EPI`: Extraction Pressure Index
- `CEI`: Carbon-Electric Intensity
- `CTI`: Cloud Thermic Index
- `LPI`: Logistic Pulse Index
- `BNI`: Biospheric Noise Index
- `LMI`: Local Machine Index

Every index returns:

- `value`
- `normalized`
- `confidence`
- `components`
- `skippedComponents`
- `notes`

The `skippedComponents` list is part of the epistemic interface. If data is absent, stale, or invalid, that absence should be visible and may become audible through a restrained uncertainty mapping.

## Active mapping catalog

The catalog in `packages/core/src/mappings.ts` covers the preserved local slice
and the first Cosmoaudition strata:

- carbon intensity to carbon drone filter cutoff
- generation coal share to dark noise gain
- generation wind share to air-band frequency
- earthquake count to low transient density
- Bitcoin hashrate to FM index
- Bitcoin mempool size to noise density
- Bogota GBFS bike availability ratio to city mobility pulse rate
- local temperature to weather filter cutoff
- browser fetch latency to microtick jitter
- stale source count to quiet uncertainty noise
- solar-wind speed to the microsonic clock and imported-material playback rate
- magnetic Bt to spectral aperture and signed Bz to bipolar control
- planetary Kp to a slow geomagnetic scene state
- predicted close-approach time to event horizon and relative velocity to
  imported-material delay
- aggregate iNaturalist submission rate to a restrained biosphere control field
- Wikimedia hourly change to bipolar drift and the latest complete aggregate to a continuous macro-control level
- NASA/JPL fireball impact energy to a deduplicated event control and altitude to imported-material filter Q
- deterministic local clock, keyed pulse, bipolar LFO, envelope, and seeded sample-and-hold to explicit generator and material controls

Oil and flights remain outside the active engine until their source access,
fallback, and licensing constraints are defensible.

## Validation

The mapping catalog is tested for:

- duplicate IDs;
- non-empty descriptions;
- non-empty epistemic notes;
- non-empty output ranges;
- required input ranges for non-categorical mappings.

Catalog validation defers executability to the executor's own rules, so an
entry cannot pass its test and then refuse on every execution, and it refuses
two mappings that claim the same target.

Control-execution tests additionally cover each missing-data policy (skip,
refuse, hold, explicit interpolation, and uncertainty), invalid previous
output, stale and error input, signed and reversed output ranges, a zero route
amount, and logarithmic and exponential scales, as well as state updates. Stable trigger projection is tested separately from continuous mapping,
including deduplication, stale refusal, and bounded history. MASA records include only mappings that reference observations present
in the bounded snapshot.
