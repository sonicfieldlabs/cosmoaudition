import {
  isExecutableControlDecision,
  type ControlDecision
} from "@cosmoaudition/core";
import { safeParamRamp } from "./params";

export interface MaterialControl {
  cutoffHz: number;
  filterQ: number;
  playbackRate: number;
  delayMix: number;
  delayTimeSeconds: number;
  delayFeedback: number;
  gain: number;
}

export type MaterialControlName = keyof MaterialControl;
export type MaterialControlPatch = Partial<MaterialControl>;
export type MaterialControlSmoothing = Partial<
  Record<MaterialControlName, number>
>;

export interface MaterialControlLimit {
  min: number;
  max: number;
  unit: string;
}

export interface MaterialControlDecision {
  control: string;
  status: "applied" | "refused";
  requestedValue: number | null;
  previousValue: number | null;
  appliedValue: number | null;
  reason: "within-safe-range" | "unknown-control" | "non-finite" | "outside-safe-range";
}

export interface MaterialControlUpdate {
  controls: MaterialControl;
  decisions: MaterialControlDecision[];
}

export interface MaterialControlRoute {
  target: string;
  control: MaterialControlName;
}

export interface RoutedMaterialControlUpdate extends MaterialControlUpdate {
  routedMappingIds: string[];
  smoothingMsByControl: MaterialControlSmoothing;
}

export interface MaterialStatus {
  loaded: boolean;
  running: boolean;
  name: string | null;
  durationSeconds: number | null;
  numberOfChannels: number | null;
  sampleRate: number | null;
  controls: MaterialControl;
}

export const MATERIAL_CONTROL_LIMITS: Readonly<
  Record<MaterialControlName, MaterialControlLimit>
> = {
  cutoffHz: { min: 30, max: 18_000, unit: "Hz" },
  filterQ: { min: 0.1, max: 18, unit: "Q" },
  playbackRate: { min: 0.25, max: 4, unit: "ratio" },
  delayMix: { min: 0, max: 1, unit: "ratio" },
  delayTimeSeconds: { min: 0.01, max: 1.8, unit: "seconds" },
  delayFeedback: { min: 0, max: 0.82, unit: "ratio" },
  gain: { min: 0, max: 0.5, unit: "linear gain" }
};

export const DEFAULT_MATERIAL_CONTROL: Readonly<MaterialControl> = {
  cutoffHz: 8_000,
  filterQ: 0.7,
  playbackRate: 1,
  delayMix: 0,
  delayTimeSeconds: 0.24,
  delayFeedback: 0.18,
  gain: 0.24
};

export const DEFAULT_MATERIAL_CONTROL_ROUTES: readonly MaterialControlRoute[] = [
  { target: "material.cutoffHz", control: "cutoffHz" },
  { target: "material.filterQ", control: "filterQ" },
  { target: "material.playbackRate", control: "playbackRate" },
  { target: "material.delayMix", control: "delayMix" },
  { target: "material.delayTimeSeconds", control: "delayTimeSeconds" },
  { target: "material.delayFeedback", control: "delayFeedback" },
  { target: "material.gain", control: "gain" }
];

const CONTROL_NAMES: readonly MaterialControlName[] = [
  "cutoffHz",
  "filterQ",
  "playbackRate",
  "delayMix",
  "delayTimeSeconds",
  "delayFeedback",
  "gain"
];
export const MAX_MATERIAL_BYTES = 64 * 1024 * 1024;
const MAX_MATERIAL_DURATION_SECONDS = 60 * 60;
const MAX_MATERIAL_CHANNELS = 8;
const MAX_DECODED_SAMPLE_VALUES = 96_000_000;
const MAX_CONTROL_SMOOTHING_MS = 30_000;

export function validateMaterialByteLength(byteLength: number): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new RangeError("Imported material has an invalid encoded byte length.");
  }
  if (byteLength === 0) {
    throw new RangeError("Imported material is empty.");
  }
  if (byteLength > MAX_MATERIAL_BYTES) {
    throw new RangeError(
      "Imported material exceeds the 64 MiB encoded-data safety limit."
    );
  }
}

function isMaterialControlName(value: string): value is MaterialControlName {
  return (CONTROL_NAMES as readonly string[]).includes(value);
}

function controlLimit(
  control: MaterialControlName,
  maxCutoffHz: number
): MaterialControlLimit {
  const limit = MATERIAL_CONTROL_LIMITS[control];
  return control === "cutoffHz"
    ? { ...limit, max: Math.min(limit.max, maxCutoffHz) }
    : limit;
}

export function validateMaterialControlPatch(
  current: Readonly<MaterialControl>,
  patch: MaterialControlPatch | Readonly<Record<string, unknown>>,
  maxCutoffHz = MATERIAL_CONTROL_LIMITS.cutoffHz.max
): MaterialControlUpdate {
  if (!Number.isFinite(maxCutoffHz) || maxCutoffHz < MATERIAL_CONTROL_LIMITS.cutoffHz.min) {
    throw new RangeError("Material cutoff ceiling must be a finite audible frequency.");
  }

  const controls: MaterialControl = { ...current };
  const decisions: MaterialControlDecision[] = [];

  for (const [control, rawValue] of Object.entries(patch)) {
    if (!isMaterialControlName(control)) {
      decisions.push({
        control,
        status: "refused",
        requestedValue: typeof rawValue === "number" ? rawValue : null,
        previousValue: null,
        appliedValue: null,
        reason: "unknown-control"
      });
      continue;
    }

    const previousValue = controls[control];
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
      decisions.push({
        control,
        status: "refused",
        requestedValue: typeof rawValue === "number" ? rawValue : null,
        previousValue,
        appliedValue: null,
        reason: "non-finite"
      });
      continue;
    }

    const limit = controlLimit(control, maxCutoffHz);
    if (rawValue < limit.min || rawValue > limit.max) {
      decisions.push({
        control,
        status: "refused",
        requestedValue: rawValue,
        previousValue,
        appliedValue: null,
        reason: "outside-safe-range"
      });
      continue;
    }

    controls[control] = rawValue;
    decisions.push({
      control,
      status: "applied",
      requestedValue: rawValue,
      previousValue,
      appliedValue: rawValue,
      reason: "within-safe-range"
    });
  }

  return { controls, decisions };
}

export function materialControlPatchFromDecisions(
  decisions: readonly ControlDecision[],
  routes: readonly MaterialControlRoute[]
): {
  patch: MaterialControlPatch;
  routedMappingIds: string[];
  smoothingMsByControl: MaterialControlSmoothing;
} {
  const routeByTarget = new Map<string, MaterialControlRoute>();
  const controls = new Set<MaterialControlName>();
  for (const route of routes) {
    if (routeByTarget.has(route.target)) {
      throw new RangeError(`Duplicate material route target: ${route.target}`);
    }
    if (controls.has(route.control)) {
      throw new RangeError(`Duplicate material route control: ${route.control}`);
    }
    routeByTarget.set(route.target, route);
    controls.add(route.control);
  }

  const patch: MaterialControlPatch = {};
  const routedMappingIds: string[] = [];
  const smoothingMsByControl: MaterialControlSmoothing = {};
  for (const decision of decisions) {
    const route = routeByTarget.get(decision.target);
    if (!route || !isExecutableControlDecision(decision)) {
      continue;
    }
    patch[route.control] = decision.outputValue;
    smoothingMsByControl[route.control] = Math.min(
      MAX_CONTROL_SMOOTHING_MS,
      Math.max(0, decision.smoothingMs)
    );
    routedMappingIds.push(decision.mappingId);
  }

  return { patch, routedMappingIds, smoothingMsByControl };
}

export function emptyMaterialStatus(
  controls: Readonly<MaterialControl> = DEFAULT_MATERIAL_CONTROL
): MaterialStatus {
  return {
    loaded: false,
    running: false,
    name: null,
    durationSeconds: null,
    numberOfChannels: null,
    sampleRate: null,
    controls: { ...controls }
  };
}

/** A conservative, looping Web Audio path for user-imported sound matter. */
export class ImportedMaterialPlayer {
  private readonly materialGain: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly dryGain: GainNode;
  private readonly delay: DelayNode;
  private readonly feedbackGain: GainNode;
  private readonly wetGain: GainNode;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private name: string | null = null;
  private controls: MaterialControl;
  private loadGeneration = 0;

  constructor(
    private readonly context: AudioContext,
    destination: AudioNode,
    initialControls: Readonly<MaterialControl> = DEFAULT_MATERIAL_CONTROL
  ) {
    const maxCutoffHz = this.maxCutoffHz();
    this.controls = {
      ...initialControls,
      cutoffHz: Math.min(initialControls.cutoffHz, maxCutoffHz)
    };

    this.materialGain = context.createGain();
    this.filter = context.createBiquadFilter();
    this.dryGain = context.createGain();
    this.delay = context.createDelay(2);
    this.feedbackGain = context.createGain();
    this.wetGain = context.createGain();

    this.materialGain.gain.value = this.controls.gain;
    this.filter.type = "lowpass";
    this.filter.frequency.value = this.controls.cutoffHz;
    this.filter.Q.value = this.controls.filterQ;
    this.delay.delayTime.value = this.controls.delayTimeSeconds;
    this.feedbackGain.gain.value = this.controls.delayFeedback;

    // The bounded material gain is the LAST node before the destination so the
    // documented bound also covers filter resonance and delay-feedback
    // build-up, not only the dry source level.
    this.filter.connect(this.dryGain);
    this.dryGain.connect(this.materialGain);
    this.filter.connect(this.delay);
    this.delay.connect(this.feedbackGain);
    this.feedbackGain.connect(this.delay);
    this.delay.connect(this.wetGain);
    this.wetGain.connect(this.materialGain);
    this.materialGain.connect(destination);
    this.applyMix(this.controls.delayMix, 0);
  }

  async load(arrayBuffer: ArrayBuffer, name?: string): Promise<MaterialStatus> {
    validateMaterialByteLength(arrayBuffer.byteLength);

    const generation = ++this.loadGeneration;
    const decoded = await this.context.decodeAudioData(arrayBuffer.slice(0));
    if (generation !== this.loadGeneration) {
      throw new Error("Material load was superseded by a newer request.");
    }
    if (
      !Number.isFinite(decoded.duration) ||
      decoded.duration <= 0 ||
      decoded.duration > MAX_MATERIAL_DURATION_SECONDS
    ) {
      throw new RangeError("Decoded material duration is outside the 0..1 hour limit.");
    }
    if (
      !Number.isInteger(decoded.numberOfChannels) ||
      decoded.numberOfChannels < 1 ||
      decoded.numberOfChannels > MAX_MATERIAL_CHANNELS
    ) {
      throw new RangeError("Decoded material must contain 1..8 channels.");
    }
    if (!Number.isFinite(decoded.sampleRate) || decoded.sampleRate <= 0) {
      throw new RangeError("Decoded material has an invalid sample rate.");
    }
    if (
      !Number.isInteger(decoded.length) ||
      decoded.length < 1 ||
      decoded.length * decoded.numberOfChannels > MAX_DECODED_SAMPLE_VALUES
    ) {
      throw new RangeError(
        "Decoded material exceeds the 96 million sample-value memory budget."
      );
    }

    this.stop();
    this.buffer = decoded;
    this.name = name?.trim() ? name.trim() : "Imported material";
    return this.getStatus();
  }

  start(): MaterialStatus {
    if (!this.buffer) {
      throw new Error("Load material before starting material playback.");
    }
    if (this.source) {
      return this.getStatus();
    }

    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.loop = true;
    source.playbackRate.value = this.controls.playbackRate;
    source.connect(this.filter);
    source.onended = () => {
      if (this.source === source) {
        source.disconnect();
        this.source = null;
      }
    };
    source.start();
    this.source = source;
    return this.getStatus();
  }

  stop(): MaterialStatus {
    const source = this.source;
    this.source = null;
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already-ended Web Audio sources can reject a second stop request.
      }
      source.disconnect();
    }
    return this.getStatus();
  }

  setControls(
    patch: MaterialControlPatch,
    smoothingMsByControl: Readonly<MaterialControlSmoothing> = {}
  ): MaterialControlUpdate {
    const update = validateMaterialControlPatch(
      this.controls,
      patch,
      this.maxCutoffHz()
    );
    this.controls = update.controls;

    const now = this.context.currentTime;
    const smoothing = (control: MaterialControlName, fallback: number): number => {
      const requested = smoothingMsByControl[control];
      return typeof requested === "number" && Number.isFinite(requested)
        ? Math.min(MAX_CONTROL_SMOOTHING_MS, Math.max(0, requested))
        : fallback;
    };
    if (update.decisions.some((decision) => decision.control === "gain" && decision.status === "applied")) {
      safeParamRamp(this.materialGain.gain, this.controls.gain, now, smoothing("gain", 80));
    }
    if (update.decisions.some((decision) => decision.control === "cutoffHz" && decision.status === "applied")) {
      safeParamRamp(this.filter.frequency, this.controls.cutoffHz, now, smoothing("cutoffHz", 120));
    }
    if (update.decisions.some((decision) => decision.control === "filterQ" && decision.status === "applied")) {
      safeParamRamp(this.filter.Q, this.controls.filterQ, now, smoothing("filterQ", 120));
    }
    if (update.decisions.some((decision) => decision.control === "playbackRate" && decision.status === "applied")) {
      if (this.source) {
        safeParamRamp(this.source.playbackRate, this.controls.playbackRate, now, smoothing("playbackRate", 80));
      }
    }
    if (update.decisions.some((decision) => decision.control === "delayMix" && decision.status === "applied")) {
      this.applyMix(this.controls.delayMix, smoothing("delayMix", 80));
    }
    if (update.decisions.some((decision) => decision.control === "delayTimeSeconds" && decision.status === "applied")) {
      safeParamRamp(this.delay.delayTime, this.controls.delayTimeSeconds, now, smoothing("delayTimeSeconds", 120));
    }
    if (update.decisions.some((decision) => decision.control === "delayFeedback" && decision.status === "applied")) {
      safeParamRamp(this.feedbackGain.gain, this.controls.delayFeedback, now, smoothing("delayFeedback", 120));
    }
    return update;
  }

  routeControls(
    decisions: readonly ControlDecision[],
    routes: readonly MaterialControlRoute[]
  ): RoutedMaterialControlUpdate {
    const routed = materialControlPatchFromDecisions(decisions, routes);
    const update = this.setControls(routed.patch, routed.smoothingMsByControl);
    return {
      ...update,
      routedMappingIds: routed.routedMappingIds,
      smoothingMsByControl: routed.smoothingMsByControl
    };
  }

  getStatus(): MaterialStatus {
    return {
      loaded: this.buffer !== null,
      running: this.source !== null,
      name: this.name,
      durationSeconds: this.buffer?.duration ?? null,
      numberOfChannels: this.buffer?.numberOfChannels ?? null,
      sampleRate: this.buffer?.sampleRate ?? null,
      controls: { ...this.controls }
    };
  }

  dispose(): void {
    this.loadGeneration += 1;
    this.stop();
    this.materialGain.disconnect();
    this.filter.disconnect();
    this.dryGain.disconnect();
    this.delay.disconnect();
    this.feedbackGain.disconnect();
    this.wetGain.disconnect();
    this.buffer = null;
    this.name = null;
  }

  private maxCutoffHz(): number {
    return Math.min(
      MATERIAL_CONTROL_LIMITS.cutoffHz.max,
      this.context.sampleRate * 0.45
    );
  }

  private applyMix(mix: number, smoothingMs: number): void {
    const angle = mix * Math.PI * 0.5;
    safeParamRamp(
      this.dryGain.gain,
      Math.cos(angle),
      this.context.currentTime,
      smoothingMs
    );
    safeParamRamp(
      this.wetGain.gain,
      Math.sin(angle),
      this.context.currentTime,
      smoothingMs
    );
  }
}
