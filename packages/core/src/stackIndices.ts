import {
  calculateBiosphericNoiseIndex,
  calculateCarbonElectricIntensity,
  calculateCloudThermicIndex,
  calculateExtractionPressureIndex,
  calculateLocalMachineIndex,
  calculateLogisticPulseIndex,
  calculateStackPulseIndex
} from "./indices";
import { clamp01 } from "./normalize";
import type {
  Confidence,
  DerivedIndex,
  ObservedSignal,
  WeightedValue
} from "./types";

// Derived indices are compositional instruments, not totals. They are computed
// from the same signals that drive the audio so the readout never claims a
// reality the sound does not also carry. Missing inputs stay missing (skipped),
// they are never replaced with invented values.

const confidenceRank: Record<Confidence, number> = {
  high: 4,
  medium: 3,
  low: 2,
  stale: 1,
  error: 0
};

function signalComponent(
  signals: readonly ObservedSignal[],
  id: string
): WeightedValue {
  const signal = signals.find((candidate) => candidate.id === id);
  if (!signal || signal.normalized === null) {
    return { id, value: null };
  }

  return { id, value: signal.normalized, confidence: signal.confidence };
}

// Blend several normalized shares (each already 0..1) into a single component,
// keeping the most cautious confidence of the parts that are actually present.
function blendShares(
  signals: readonly ObservedSignal[],
  id: string,
  partIds: readonly string[]
): WeightedValue {
  const present = partIds
    .map((partId) => signals.find((candidate) => candidate.id === partId))
    .filter(
      (candidate): candidate is ObservedSignal =>
        candidate !== undefined &&
        candidate.normalized !== null &&
        // A non-finite share would sum to NaN and clamp to 0, which reads as a
        // measured "none of this kind" instead of missing evidence.
        Number.isFinite(candidate.normalized)
    );

  if (present.length === 0) {
    return { id, value: null };
  }

  const value = clamp01(
    present.reduce((total, signal) => total + (signal.normalized ?? 0), 0)
  );
  const confidence = present.reduce<Confidence>(
    (worst, signal) =>
      confidenceRank[signal.confidence] < confidenceRank[worst]
        ? signal.confidence
        : worst,
    "high"
  );

  return { id, value, confidence };
}

const FOSSIL_FUELS = ["generation_mix_coal", "generation_mix_gas", "generation_mix_oil"];
const RENEWABLE_FUELS = [
  "generation_mix_wind",
  "generation_mix_solar",
  "generation_mix_hydro"
];

/**
 * Compute every derived stack index from the current signal list. Indices whose
 * inputs are deferred or absent from the active source aperture (for example oil/flight
 * sources behind the Extraction Pressure Index) return a `null` value with an
 * `error` confidence rather than a fabricated number, so the UI can surface them
 * as honestly deferred instead of silently dropping them.
 */
export function buildStackIndices(
  signals: readonly ObservedSignal[]
): DerivedIndex[] {
  return [
    calculateStackPulseIndex({
      energyActivity: signalComponent(signals, "carbon_intensity_actual"),
      cloudActivity: signalComponent(signals, "bitcoin_mempool_vsize"),
      cryptoActivity: signalComponent(signals, "bitcoin_current_hashrate"),
      logisticsActivity: signalComponent(signals, "bogota_bike_availability_ratio"),
      localMachineActivity: signalComponent(signals, "browser_fetch_latency")
    }),
    calculateExtractionPressureIndex({
      // The signal ids these components bind to are the ones the deferred
      // OWID and Yahoo adapters declare in the source register. They were
      // previously invented names that could never have matched, so the index
      // would have stayed empty even after those sources were activated.
      oilProduction: signalComponent(signals, "oil_production_latest"),
      oilPrice: signalComponent(signals, "crude_oil_wti_usd")
    }),
    calculateCarbonElectricIntensity({
      carbonIntensity: signalComponent(signals, "carbon_intensity_actual"),
      fossilMix: blendShares(signals, "fossil_mix", FOSSIL_FUELS),
      renewableMix: blendShares(signals, "renewable_mix", RENEWABLE_FUELS)
    }),
    calculateCloudThermicIndex({
      hashrate: signalComponent(signals, "bitcoin_current_hashrate"),
      mempoolCongestion: signalComponent(signals, "bitcoin_mempool_vsize"),
      fetchLatency: signalComponent(signals, "browser_fetch_latency")
    }),
    calculateLogisticPulseIndex({
      // OpenSky is blocked for this use pattern, so this component stays
      // absent by design rather than binding a name that will never arrive.
      aircraftActivity: { id: "aircraft_state_count", value: null },
      bikeAvailability: signalComponent(signals, "bogota_bike_availability_ratio")
    }),
    calculateBiosphericNoiseIndex({
      // Absolute local temperature is not an anomaly. Keep this component
      // absent until an adapter supplies a declared rolling or climatological
      // baseline rather than manufacturing one from the current value.
      temperatureAnomaly: signalComponent(signals, "local_temperature_anomaly"),
      windActivity: signalComponent(signals, "local_wind_speed_10m"),
      precipitation: signalComponent(signals, "local_precipitation"),
      quakeActivity: signalComponent(signals, "earthquake_count_1h")
    }),
    calculateLocalMachineIndex({
      fetchLatency: signalComponent(signals, "browser_fetch_latency"),
      // No producer emits an interaction rate, and observing one would mean
      // watching the operator's input. The component is declared absent so the
      // index reports what it actually has instead of permanently listing a
      // skipped component for an observation that was never planned.
      interactionRate: { id: "browser_interaction_rate", value: null },
      viewportPressure: signalComponent(signals, "browser_window_size"),
      audioContextState: signalComponent(signals, "browser_audio_context")
    })
  ];
}
