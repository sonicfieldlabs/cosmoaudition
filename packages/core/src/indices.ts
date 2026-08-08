import { clamp01, weightedMean } from "./normalize";
import type { Confidence, DerivedIndex, IndexId, WeightedValue } from "./types";

const indexLabels: Record<IndexId, string> = {
  SPI: "Stack Pulse Index",
  EPI: "Extraction Pressure Index",
  CEI: "Carbon-Electric Intensity",
  CTI: "Cloud Thermic Index",
  LPI: "Logistic Pulse Index",
  BNI: "Biospheric Noise Index",
  LMI: "Local Machine Index"
};

function isUsableComponent(component: WeightedValue): boolean {
  if (component.value === null) {
    return false;
  }

  if (component.confidence === "error" || component.confidence === "stale") {
    return false;
  }

  // A non-positive or non-finite weight would let a component be reported as
  // used while the weighted mean silently drops it, so absence must stay
  // visible in skippedComponents instead.
  const weight = component.weight ?? 1;
  if (!Number.isFinite(weight) || weight <= 0) {
    return false;
  }

  return Number.isFinite(component.value);
}

function aggregateConfidence(
  usable: readonly WeightedValue[],
  skipped: readonly WeightedValue[]
): Confidence {
  if (usable.length === 0) {
    return skipped.some((component) => component.confidence === "stale")
      ? "stale"
      : "error";
  }

  if (usable.some((component) => component.confidence === "low")) {
    return "low";
  }

  if (
    skipped.length > 0 ||
    usable.some((component) => component.confidence === "medium")
  ) {
    return "medium";
  }

  return "high";
}

export function createWeightedIndex(
  id: IndexId,
  components: readonly WeightedValue[],
  notes: string
): DerivedIndex {
  const usable = components.filter(isUsableComponent);
  const skipped = components.filter((component) => !isUsableComponent(component));
  const value = weightedMean(
    usable.map((component) => ({
      value: clamp01(component.value ?? 0),
      ...(component.weight === undefined ? {} : { weight: component.weight })
    }))
  );

  return {
    id,
    label: indexLabels[id],
    value,
    normalized: value,
    confidence: aggregateConfidence(usable, skipped),
    components: usable.map((component) => component.id),
    skippedComponents: skipped.map((component) => component.id),
    notes
  };
}

export interface StackPulseInputs {
  energyActivity: WeightedValue;
  cloudActivity: WeightedValue;
  cryptoActivity: WeightedValue;
  logisticsActivity: WeightedValue;
  localMachineActivity: WeightedValue;
}

export function calculateStackPulseIndex(input: StackPulseInputs): DerivedIndex {
  return createWeightedIndex(
    "SPI",
    [
      { ...input.energyActivity, weight: input.energyActivity.weight ?? 1.2 },
      { ...input.cloudActivity, weight: input.cloudActivity.weight ?? 1 },
      { ...input.cryptoActivity, weight: input.cryptoActivity.weight ?? 0.8 },
      { ...input.logisticsActivity, weight: input.logisticsActivity.weight ?? 0.8 },
      {
        ...input.localMachineActivity,
        weight: input.localMachineActivity.weight ?? 0.6
      }
    ],
    "Activity index for pacing and density. It must not control master gain."
  );
}

export interface ExtractionPressureInputs {
  oilProduction: WeightedValue;
  oilPrice: WeightedValue;
  criticalMinerals?: WeightedValue;
}

export function calculateExtractionPressureIndex(
  input: ExtractionPressureInputs
): DerivedIndex {
  const components: WeightedValue[] = [
    { ...input.oilProduction, weight: input.oilProduction.weight ?? 1.2 },
    { ...input.oilPrice, weight: input.oilPrice.weight ?? 0.8 }
  ];

  if (input.criticalMinerals) {
    components.push({
      ...input.criticalMinerals,
      weight: input.criticalMinerals.weight ?? 0.6
    });
  }

  return createWeightedIndex(
    "EPI",
    components,
    "Extraction pressure is a compositional index, not a total measure of extraction."
  );
}

export interface CarbonElectricInputs {
  carbonIntensity: WeightedValue;
  fossilMix: WeightedValue;
  renewableMix: WeightedValue;
}

export function calculateCarbonElectricIntensity(
  input: CarbonElectricInputs
): DerivedIndex {
  return createWeightedIndex(
    "CEI",
    [
      { ...input.carbonIntensity, weight: input.carbonIntensity.weight ?? 1.2 },
      { ...input.fossilMix, weight: input.fossilMix.weight ?? 1 },
      {
        ...input.renewableMix,
        // Invert only a usable share. Passing a non-finite value through
        // clamp01 would turn missing evidence into 0 and the inversion would
        // then assert 1: maximum carbon pressure from no data at all.
        value:
          input.renewableMix.value === null ||
          !Number.isFinite(input.renewableMix.value)
            ? null
            : 1 - clamp01(input.renewableMix.value),
        weight: input.renewableMix.weight ?? 0.6
      }
    ],
    "Electric carbon intensity combines grid carbon and mix signals; source geography remains explicit."
  );
}

export interface CloudThermicInputs {
  hashrate: WeightedValue;
  mempoolCongestion: WeightedValue;
  fetchLatency: WeightedValue;
}

export function calculateCloudThermicIndex(input: CloudThermicInputs): DerivedIndex {
  return createWeightedIndex(
    "CTI",
    [
      { ...input.hashrate, weight: input.hashrate.weight ?? 1 },
      { ...input.mempoolCongestion, weight: input.mempoolCongestion.weight ?? 0.9 },
      { ...input.fetchLatency, weight: input.fetchLatency.weight ?? 0.5 }
    ],
    "Cloud thermic load uses Bitcoin and latency as partial proxies, not a complete cloud model."
  );
}

export interface LogisticPulseInputs {
  aircraftActivity: WeightedValue;
  bikeAvailability: WeightedValue;
  vehicleProduction?: WeightedValue;
}

export function calculateLogisticPulseIndex(input: LogisticPulseInputs): DerivedIndex {
  const components: WeightedValue[] = [
    { ...input.aircraftActivity, weight: input.aircraftActivity.weight ?? 1 },
    { ...input.bikeAvailability, weight: input.bikeAvailability.weight ?? 0.7 }
  ];

  if (input.vehicleProduction) {
    components.push({
      ...input.vehicleProduction,
      weight: input.vehicleProduction.weight ?? 0.5
    });
  }

  return createWeightedIndex(
    "LPI",
    components,
    "Logistic pulse stages mobility and transport rhythms without claiming total logistics coverage."
  );
}

export interface BiosphericNoiseInputs {
  temperatureAnomaly: WeightedValue;
  windActivity: WeightedValue;
  precipitation: WeightedValue;
  quakeActivity: WeightedValue;
}

export function calculateBiosphericNoiseIndex(
  input: BiosphericNoiseInputs
): DerivedIndex {
  return createWeightedIndex(
    "BNI",
    [
      { ...input.temperatureAnomaly, weight: input.temperatureAnomaly.weight ?? 0.8 },
      { ...input.windActivity, weight: input.windActivity.weight ?? 0.5 },
      { ...input.precipitation, weight: input.precipitation.weight ?? 0.5 },
      { ...input.quakeActivity, weight: input.quakeActivity.weight ?? 0.7 }
    ],
    "Biospheric noise is a pressure texture. It should not aestheticize harm or extinction."
  );
}

export interface LocalMachineInputs {
  fetchLatency: WeightedValue;
  interactionRate: WeightedValue;
  viewportPressure: WeightedValue;
  audioContextState: WeightedValue;
}

export function calculateLocalMachineIndex(input: LocalMachineInputs): DerivedIndex {
  return createWeightedIndex(
    "LMI",
    [
      { ...input.fetchLatency, weight: input.fetchLatency.weight ?? 0.7 },
      { ...input.interactionRate, weight: input.interactionRate.weight ?? 0.6 },
      { ...input.viewportPressure, weight: input.viewportPressure.weight ?? 0.4 },
      { ...input.audioContextState, weight: input.audioContextState.weight ?? 0.8 }
    ],
    "Local machine activity stays in the browser and must not become persistent fingerprinting."
  );
}
