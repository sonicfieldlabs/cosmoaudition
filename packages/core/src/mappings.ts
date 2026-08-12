import { mappingValidationErrors } from "./control";
import type { SonicMapping } from "./types";

export const mappingCatalog: readonly SonicMapping[] = [
  {
    id: "carbon-intensity-filter",
    signalId: "carbon_intensity_actual",
    layer: "earth",
    target: "earth.carbonDrone.filterCutoff",
    scale: "linear",
    inputRange: [0, 500],
    outputRange: [260, 2600],
    smoothingMs: 1200,
    missingData: "hold-explicitly",
    description:
      "Reported Great Britain grid carbon intensity opens the carbon drone filter and exposes more upper partials.",
    epistemicNote:
      "This maps the provider's regional carbon-intensity estimate, not planetary carbon intensity; generation-mix mappings remain separate controls."
  },
  {
    id: "coal-noise-gain",
    signalId: "generation_mix_coal",
    layer: "earth",
    target: "earth.energyMixChoir.coalNoiseGain",
    scale: "linear",
    inputRange: [0, 100],
    outputRange: [0, 0.24],
    smoothingMs: 900,
    missingData: "hold-explicitly",
    description: "Coal share adds dark filtered noise to the energy mix choir.",
    epistemicNote:
      "Fuel share is a regional generation mix value and should remain labelled by geography."
  },
  {
    id: "wind-air-band",
    signalId: "generation_mix_wind",
    layer: "earth",
    target: "earth.energyMixChoir.windNoiseBand",
    scale: "linear",
    inputRange: [0, 100],
    outputRange: [400, 5000],
    smoothingMs: 900,
    missingData: "hold-explicitly",
    description: "Wind share lifts an airy band-passed noise layer.",
    epistemicNote:
      "The sound marks generation proportion, not ecological innocence or impact absence."
  },
  {
    id: "quake-resonator-density",
    signalId: "earthquake_count_1h",
    layer: "earth",
    target: "earth.quakeResonator.eventDensity",
    scale: "quantized",
    inputRange: [0, 30],
    outputRange: [0, 8],
    smoothingMs: 250,
    missingData: "skip",
    description: "Past-hour earthquake count controls restrained low transient density.",
    epistemicNote:
      "Earthquake events are not spectacle; zero events is valid data and network failure is not."
  },
  {
    id: "gbfs-bike-availability-pulse",
    signalId: "bogota_bike_availability_ratio",
    layer: "city",
    target: "city.mobilityPulse.rate",
    scale: "linear",
    inputRange: [0, 1],
    outputRange: [760, 180],
    smoothingMs: 600,
    missingData: "hold-explicitly",
    description:
      "Bogota bike availability ratio shortens or lengthens a restrained city-layer pulse.",
    epistemicNote:
      "This is the Bogota public bike system station_status feed, not a total model of city movement."
  },
  {
    id: "hashrate-fm-index",
    signalId: "bitcoin_current_hashrate",
    layer: "cloud",
    target: "cloud.hashrateCore.fmIndex",
    scale: "log",
    inputRange: [100_000_000_000_000_000_000, 1_500_000_000_000_000_000_000],
    outputRange: [0.2, 8],
    smoothingMs: 1800,
    missingData: "hold-explicitly",
    description: "Bitcoin mining hashrate controls metallic FM modulation depth.",
    epistemicNote:
      "Hashrate is a crypto computation proxy, not the whole thermal reality of cloud infrastructure."
  },
  {
    id: "mempool-noise-density",
    signalId: "bitcoin_mempool_vsize",
    layer: "cloud",
    target: "cloud.mempoolNoise.density",
    scale: "log",
    inputRange: [1_000_000, 250_000_000],
    outputRange: [0.05, 0.9],
    smoothingMs: 800,
    missingData: "hold-explicitly",
    description: "Mempool virtual size controls sparse-to-dense granular noise.",
    epistemicNote:
      "Congestion is a Bitcoin network condition and should not be heard as all network traffic."
  },
  {
    id: "weather-filter-cutoff",
    signalId: "local_temperature_2m",
    layer: "user",
    target: "user.weatherFilter.cutoff",
    scale: "linear",
    inputRange: [-10, 40],
    outputRange: [500, 4200],
    smoothingMs: 1500,
    missingData: "hold-explicitly",
    description: "Manual-location temperature moves the local weather filter cutoff.",
    epistemicNote:
      "Local mode starts from user-supplied place; no automatic geolocation is required."
  },
  {
    id: "browser-latency-jitter",
    signalId: "browser_fetch_latency",
    layer: "interface",
    target: "interface.browserTicks.jitter",
    scale: "log",
    inputRange: [10, 3000],
    outputRange: [0, 0.45],
    smoothingMs: 400,
    missingData: "skip",
    description: "Local fetch latency adds timing instability to browser microticks.",
    epistemicNote:
      "Latency stays local to the browser session and must not become persistent fingerprinting."
  },
  {
    id: "stale-system-noise",
    signalId: "source_stale_count",
    layer: "interface",
    target: "interface.staleNoise.gain",
    scale: "linear",
    // The full active API aperture, matching how the adapter normalizes the
    // same count so the module and this mapping agree.
    inputRange: [0, 17],
    outputRange: [0, 0.12],
    smoothingMs: 700,
    missingData: "skip",
    description: "The count of stale sources raises a quiet uncertainty noise bed.",
    epistemicNote:
      "Staleness is represented as system state rather than hidden or replaced data."
  },
  {
    id: "solar-wind-speed-microsonic-clock",
    signalId: "solar_wind_speed",
    layer: "address",
    target: "material.playbackRate",
    scale: "linear",
    inputRange: [250, 900],
    outputRange: [0.5, 1.75],
    smoothingMs: 1600,
    missingData: "hold-explicitly",
    description:
      "Solar-wind proton speed conditions the microsonic clock and imported-material playback rate within a conservative range.",
    epistemicNote:
      "This is an authored control relation from a near-real-time L1 product, not an acoustic frequency or the voice of solar wind."
  },
  {
    id: "solar-magnetic-bt-spectral-aperture",
    signalId: "solar_wind_magnetic_field_bt",
    layer: "address",
    target: "material.cutoffHz",
    scale: "exp",
    inputRange: [0, 30],
    outputRange: [240, 12000],
    smoothingMs: 1800,
    missingData: "hold-explicitly",
    description:
      "Interplanetary magnetic-field magnitude opens the spectral aperture of the control field and material processor.",
    epistemicNote:
      "Magnetic field magnitude conditions a filter; it is not asserted to be spectral brightness or timbre."
  },
  {
    id: "solar-magnetic-bz-bipolar-field",
    signalId: "solar_wind_magnetic_field_bz_gsm",
    layer: "address",
    target: "cosmos.control.bzBipolar",
    scale: "linear",
    inputRange: [-20, 20],
    outputRange: [-1, 1],
    smoothingMs: 1200,
    missingData: "hold-explicitly",
    description:
      "Signed Bz becomes a bipolar modulation value whose midpoint preserves the physical zero crossing.",
    epistemicNote:
      "The sign is retained rather than folded into magnitude; the bipolar control is an instrumental convention."
  },
  {
    id: "geomagnetic-kp-slow-scene",
    signalId: "planetary_k_index",
    layer: "address",
    target: "cosmos.control.geomagneticScene",
    scale: "linear",
    inputRange: [0, 9],
    outputRange: [0.02, 0.85],
    smoothingMs: 5000,
    missingData: "hold-explicitly",
    description:
      "The estimated planetary K index changes a slow scene state with long smoothing rather than firing minute-by-minute notes.",
    epistemicNote:
      "Kp is an estimated planetary geomagnetic index, not a local measurement or a sequence of discrete storms."
  },
  {
    id: "jpl-near-earth-approach-clock",
    signalId: "closest_approach_time_hours",
    layer: "address",
    target: "cosmos.event.approachHorizon",
    scale: "linear",
    inputRange: [0, 168],
    outputRange: [1, 0],
    smoothingMs: 3000,
    missingData: "skip",
    description:
      "Time until the closest predicted approach conditions the scheduling horizon for sparse event pulses.",
    epistemicNote:
      "The input is derived from a prediction catalogue and snapshot time; it is not a live detection or impact warning."
  },
  {
    id: "jpl-approach-velocity-material-delay",
    signalId: "closest_approach_velocity_km_s",
    layer: "address",
    target: "material.delayMix",
    scale: "linear",
    inputRange: [0, 50],
    outputRange: [0, 0.55],
    smoothingMs: 2200,
    missingData: "hold-explicitly",
    description:
      "Predicted relative velocity conditions the wet proportion of the imported-material delay field.",
    epistemicNote:
      "Relative orbital velocity does not physically cause the browser delay; the relation is authored and reversible."
  },
  {
    id: "inaturalist-biosphere-submission-density",
    signalId: "inaturalist_observation_rate_per_minute",
    layer: "address",
    target: "biosphere.control.submissionDensity",
    scale: "linear",
    inputRange: [0, 350],
    outputRange: [0.02, 0.9],
    smoothingMs: 2400,
    missingData: "hold-explicitly",
    description:
      "The aggregate rate of new iNaturalist submissions conditions a restrained filtered-noise body.",
    epistemicNote:
      "This represents activity on a human observation platform, not organism abundance, ecological health, or animal voice."
  },
  {
    id: "wikimedia-culture-pageview-drift",
    signalId: "wikimedia_pageviews_hourly_change",
    layer: "address",
    target: "culture.control.pageviewDrift",
    scale: "linear",
    inputRange: [-50, 50],
    outputRange: [-1, 1],
    smoothingMs: 2600,
    missingData: "hold-explicitly",
    description:
      "Change between two complete Wikimedia pageview hours becomes a bipolar macro-modulation drift.",
    epistemicNote:
      "This is delayed activity on Wikimedia infrastructure, not global culture, attention, or collective consciousness."
  },
  {
    id: "wikimedia-pageview-level",
    signalId: "wikimedia_pageviews_latest_hour",
    layer: "address",
    target: "culture.control.pageviewLevel",
    scale: "log",
    inputRange: [1000000, 1000000000],
    outputRange: [0.02, 0.72],
    smoothingMs: 1800,
    missingData: "skip",
    description:
      "The latest complete all-project pageview aggregate conditions a slowly changing macro-control level.",
    epistemicNote:
      "This delayed infrastructure aggregate is a continuous authored control, not an event, a reader count, or a measure of global culture."
  },
  {
    id: "jpl-fireball-impact-event",
    signalId: "fireball_latest_impact_energy_kt",
    layer: "address",
    target: "cosmos.event.fireballImpact",
    scale: "log",
    inputRange: [0.01, 100],
    outputRange: [0.08, 1],
    smoothingMs: 40,
    missingData: "skip",
    description:
      "A newly accepted, stably keyed fireball record emits one bounded event-control accent scaled by its reported impact-energy estimate.",
    epistemicNote:
      "The accent is an authored event projection from the NASA/JPL report, not the fireball's sound and not evidence of live detection."
  },
  {
    id: "jpl-fireball-altitude-filter-q",
    signalId: "fireball_latest_altitude_km",
    layer: "address",
    target: "material.filterQ",
    scale: "linear",
    inputRange: [10, 80],
    outputRange: [0.3, 12],
    smoothingMs: 1600,
    missingData: "hold-explicitly",
    description:
      "Reported peak-brightness altitude traverses the imported-material filter resonance inside a conservative range.",
    epistemicNote:
      "Atmospheric altitude does not acoustically cause filter resonance; this reversible processor relation remains explicit."
  },
  {
    id: "local-clock-phase",
    signalId: "local_clock_phase",
    layer: "interface",
    target: "generator.control.clockPhase",
    scale: "linear",
    inputRange: [0, 1],
    outputRange: [0, 1],
    smoothingMs: 20,
    missingData: "skip",
    description: "The deterministic local saw clock exposes a bounded phase control.",
    epistemicNote:
      "This is authored internal timing with explicit phase origin, rate, and seed; it is not external observation data."
  },
  {
    id: "local-pulse-trigger",
    signalId: "local_pulse_gate",
    layer: "interface",
    target: "cosmos.event.localPulse",
    scale: "categorical",
    categories: [
      { value: 0, output: 0, label: "gate-closed" },
      { value: 1, output: 1, label: "gate-open" }
    ],
    outputRange: [0, 1],
    smoothingMs: 5,
    missingData: "skip",
    description:
      "The deterministic pulse gate emits a locally authored trigger state with a stable cycle key.",
    epistemicNote:
      "The pulse is a generator event, never a substitute for a missing provider event or an observation of the cosmos."
  },
  {
    id: "local-lfo-bipolar-field",
    signalId: "local_lfo_bipolar",
    layer: "interface",
    target: "generator.control.lfoBipolar",
    scale: "linear",
    inputRange: [-1, 1],
    outputRange: [-1, 1],
    smoothingMs: 120,
    missingData: "skip",
    description: "A deterministic sine LFO exposes a bipolar local modulation field.",
    epistemicNote:
      "The LFO is a declared local control source and has no external epistemic claim."
  },
  {
    id: "local-envelope-delay-feedback",
    signalId: "local_decay_envelope",
    layer: "interface",
    target: "material.delayFeedback",
    scale: "linear",
    inputRange: [0, 1],
    outputRange: [0, 0.72],
    smoothingMs: 80,
    missingData: "skip",
    description:
      "A deterministic cyclic attack-decay envelope traverses safe imported-material delay feedback.",
    epistemicNote:
      "This is an authored processor movement with reproducible parameters, not information received from a provider."
  },
  {
    id: "local-sample-hold-delay-time",
    signalId: "local_sample_and_hold",
    layer: "interface",
    target: "material.delayTimeSeconds",
    scale: "linear",
    inputRange: [0, 1],
    outputRange: [0.03, 1.4],
    smoothingMs: 160,
    missingData: "skip",
    description:
      "A seeded deterministic sample-and-hold selects bounded delay times for imported material.",
    epistemicNote:
      "Seeded local variation is procedural control, not random evidence and not a replacement for unavailable source data."
  }
] as const;

export function getMappingBySignal(signalId: string): readonly SonicMapping[] {
  return mappingCatalog.filter((mapping) => mapping.signalId === signalId);
}

export function validateMappingCatalog(
  mappings: readonly SonicMapping[] = mappingCatalog
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const targets = new Map<string, string>();

  for (const mapping of mappings) {
    if (ids.has(mapping.id)) {
      errors.push(`Duplicate mapping id: ${mapping.id}`);
    }
    ids.add(mapping.id);

    // Two mappings sharing a target race for one control; the last writer wins
    // silently in controlFrame, so the catalog refuses the ambiguity instead.
    const existingTarget = targets.get(mapping.target);
    if (existingTarget !== undefined) {
      errors.push(
        `Mapping ${mapping.id} targets ${mapping.target}, already claimed by ${existingTarget}.`
      );
    }
    targets.set(mapping.target, mapping.id);

    if (mapping.description.trim().length === 0) {
      errors.push(`Mapping ${mapping.id} is missing a description.`);
    }

    if (mapping.epistemicNote.trim().length === 0) {
      errors.push(`Mapping ${mapping.id} is missing an epistemic note.`);
    }

    // Defer executability to the executor's own rules so a catalog entry can
    // never pass validation and then refuse on every execution.
    for (const reason of mappingValidationErrors(mapping)) {
      errors.push(`Mapping ${mapping.id} is not executable: ${reason}.`);
    }
  }

  return errors;
}
