import type {
  ControlDecision,
  ObservedSignal,
  SignalTrigger,
  StackLayer
} from "@cosmoaudition/core";
import {
  buildStackIndices,
  clamp01,
  executeMappings,
  mappingCatalog,
  smoothValue,
  updateControlState
} from "@cosmoaudition/core";
import {
  createLayerBus,
  createMasterBus,
  DEFAULT_MASTER_VOLUME,
  stackLayers,
  type LayerBus,
  type MasterBus
} from "./buses";
import { CarbonDrone } from "./modules/CarbonDrone";
import { BrowserTicks } from "./modules/BrowserTicks";
import {
  ControlFieldVoice,
  isEventControlTarget
} from "./modules/ControlFieldVoice";
import { EnergyMixChoir } from "./modules/EnergyMixChoir";
import { HashrateCore } from "./modules/HashrateCore";
import { MempoolNoise } from "./modules/MempoolNoise";
import { MobilityPulse } from "./modules/MobilityPulse";
import { QuakeResonator } from "./modules/QuakeResonator";
import { StaleNoise } from "./modules/StaleNoise";
import { WeatherFilter } from "./modules/WeatherFilter";
import type { AudioModule } from "./modules/types";
import {
  DEFAULT_MATERIAL_CONTROL,
  DEFAULT_MATERIAL_CONTROL_ROUTES,
  ImportedMaterialPlayer,
  emptyMaterialStatus,
  materialControlPatchFromDecisions,
  validateMaterialControlPatch,
  type MaterialControl,
  type MaterialControlPatch,
  type MaterialControlRoute,
  type MaterialControlUpdate,
  type MaterialStatus,
  type RoutedMaterialControlUpdate
} from "./material";

export type AudioEngineState = "idle" | "running" | "stopped" | "panicked";

export interface AudioEngineStatus {
  state: AudioEngineState;
  outputArmed: boolean;
  sampleRate: number | null;
  currentTime: number;
  masterVolume: number;
  density: number;
  moduleIds: string[];
}

export interface AudioSignalRouting {
  disabledMappingIds?: ReadonlySet<string>;
  mappingAmounts?: ReadonlyMap<string, number>;
}

type BrowserAudioContextConstructor = typeof AudioContext;

function getAudioContextConstructor(): BrowserAudioContextConstructor {
  const candidate =
    globalThis.AudioContext ??
    (globalThis as typeof globalThis & {
      webkitAudioContext?: BrowserAudioContextConstructor;
    }).webkitAudioContext;

  if (!candidate) {
    throw new Error("Web Audio API is not available in this browser.");
  }

  return candidate;
}

export class AudioEngine {
  private context: AudioContext | null = null;
  private master: MasterBus | null = null;
  private buses = new Map<StackLayer, LayerBus>();
  private modules: AudioModule[] = [];
  private material: ImportedMaterialPlayer | null = null;
  private materialControls: MaterialControl = { ...DEFAULT_MATERIAL_CONTROL };
  private controlState = new Map<string, number>();
  private controlDecisions: ControlDecision[] = [];
  private state: AudioEngineState = "idle";
  private outputArmed = true;
  private masterVolume = DEFAULT_MASTER_VOLUME;
  private density = 0.5;
  private startPromise: Promise<AudioEngineStatus> | null = null;

  async start(): Promise<AudioEngineStatus> {
    if (this.context && this.state === "running") {
      await this.context.resume();
      return this.getStatus();
    }

    // Concurrent starts share one in-flight startup. Without this, a second
    // start during the first `resume()` await built a second context and
    // orphaned the first one with live modules that Stop and Panic could no
    // longer reach.
    if (this.startPromise) {
      return this.startPromise;
    }
    const startPromise = this.startExclusive();
    this.startPromise = startPromise;
    try {
      return await startPromise;
    } finally {
      if (this.startPromise === startPromise) {
        this.startPromise = null;
      }
    }
  }

  private async startExclusive(): Promise<AudioEngineStatus> {
    const AudioContextConstructor = getAudioContextConstructor();
    const context = new AudioContextConstructor();
    const master = createMasterBus(context);
    master.setVolume(this.outputArmed ? this.masterVolume : 0);

    this.context = context;
    this.master = master;
    this.buses = new Map(
      stackLayers.map((layer) => [
        layer,
        createLayerBus(context, layer, master.input)
      ])
    );
    this.material = new ImportedMaterialPlayer(
      context,
      this.requireBus("user").input,
      this.materialControls
    );
    this.materialControls = this.material.getStatus().controls;
    this.modules = [
      new CarbonDrone(),
      new EnergyMixChoir(),
      new QuakeResonator(),
      new HashrateCore(),
      new MempoolNoise(),
      new MobilityPulse(),
      new WeatherFilter(),
      new BrowserTicks(),
      new StaleNoise(),
      new ControlFieldVoice()
    ];

    try {
      for (const module of this.modules) {
        module.start(context, this.requireBus(module.layer).input);
      }

      await context.resume();
    } catch (error) {
      if (this.context === context) {
        this.stop();
        this.state = "idle";
      } else {
        context.close().catch(() => undefined);
      }
      throw error;
    }

    if (this.context !== context) {
      // Stop or Panic intervened while the context was resuming; honor it
      // instead of resurrecting a context the user just silenced.
      context.close().catch(() => undefined);
      return this.getStatus();
    }

    this.state = "running";
    return this.getStatus();
  }

  updateSignals(
    signals: readonly ObservedSignal[],
    routing: AudioSignalRouting = {}
  ): AudioEngineStatus {
    this.controlDecisions = executeMappings(mappingCatalog, signals, {
      previousOutputs: this.controlState,
      ...(routing.disabledMappingIds
        ? { disabledMappingIds: routing.disabledMappingIds }
        : {}),
      ...(routing.mappingAmounts
        ? { mappingAmounts: routing.mappingAmounts }
        : {})
    });
    this.controlState = updateControlState(
      this.controlState,
      this.controlDecisions
    );
    if (this.material?.getStatus().loaded) {
      this.routeMaterialControls(
        this.controlDecisions,
        DEFAULT_MATERIAL_CONTROL_ROUTES
      );
    }

    if (!this.context || this.state !== "running") {
      return this.getStatus();
    }

    // Derived indices shape the sound. Reuse the same buildStackIndices the UI
    // readout uses so what is heard matches what is shown. SPI drives global
    // rhythmic density (smoothed, never gain); CTI/LPI/BNI bias the timbre of
    // their own layer (cloud/city/earth) at the bus level.
    const indices = buildStackIndices(signals);
    const indexLevel = (id: string): number | null => {
      const index = indices.find((candidate) => candidate.id === id);
      return index &&
        index.normalized !== null &&
        Number.isFinite(index.normalized)
        ? index.normalized
        : null;
    };

    const spi = indices.find((index) => index.id === "SPI");
    if (
      spi &&
      spi.normalized !== null &&
      Number.isFinite(spi.normalized)
    ) {
      this.density = smoothValue(this.density, spi.normalized, 0.5);
    }

    const cloudCharacter = indexLevel("CTI");
    const cityCharacter = indexLevel("LPI");
    const earthCharacter = indexLevel("BNI");
    if (cloudCharacter !== null) {
      this.buses.get("cloud")?.setCharacter(cloudCharacter);
    }
    if (cityCharacter !== null) {
      this.buses.get("city")?.setCharacter(cityCharacter);
    }
    if (earthCharacter !== null) {
      this.buses.get("earth")?.setCharacter(earthCharacter);
    }

    for (const module of this.modules) {
      module.update(
        signals,
        this.context,
        this.density,
        indices,
        this.controlDecisions
      );
    }

    return this.getStatus();
  }

  setMasterVolume(value: number): AudioEngineStatus {
    this.masterVolume = clamp01(value);
    this.master?.setVolume(this.outputArmed ? this.masterVolume : 0);
    return this.getStatus();
  }

  /** Arm or silence the graph while preserving the configured master volume. */
  setOutputArmed(armed: boolean): AudioEngineStatus {
    this.outputArmed = armed;
    this.master?.setVolume(armed ? this.masterVolume : 0);
    return this.getStatus();
  }

  setLayerVolume(layer: StackLayer, value: number): AudioEngineStatus {
    this.buses.get(layer)?.setVolume(value);
    return this.getStatus();
  }

  setLayerMuted(layer: StackLayer, muted: boolean): AudioEngineStatus {
    this.buses.get(layer)?.setMuted(muted);
    return this.getStatus();
  }

  async loadMaterial(
    arrayBuffer: ArrayBuffer,
    name?: string
  ): Promise<MaterialStatus> {
    if (this.state === "panicked") {
      throw new Error(
        "Panic is active. Press Listen to re-arm audio before loading material."
      );
    }
    if (!this.context || this.state !== "running" || !this.material) {
      throw new Error("Press Listen before loading material.");
    }
    return name === undefined
      ? this.material.load(arrayBuffer)
      : this.material.load(arrayBuffer, name);
  }

  startMaterial(): MaterialStatus {
    if (!this.outputArmed) {
      throw new Error("Arm the Internal audio output before material playback.");
    }
    if (!this.material || this.state !== "running") {
      throw new Error("Start the audio engine before material playback.");
    }
    return this.material.start();
  }

  stopMaterial(): MaterialStatus {
    return this.material?.stop() ?? emptyMaterialStatus(this.materialControls);
  }

  setMaterialControl(control: MaterialControlPatch): MaterialControlUpdate {
    const update = this.material
      ? this.material.setControls(control)
      : validateMaterialControlPatch(this.materialControls, control);
    this.materialControls = update.controls;
    return update;
  }

  routeMaterialControls(
    decisions: readonly ControlDecision[],
    routes: readonly MaterialControlRoute[]
  ): RoutedMaterialControlUpdate {
    if (this.material) {
      const update = this.material.routeControls(decisions, routes);
      this.materialControls = update.controls;
      return update;
    }

    const routed = materialControlPatchFromDecisions(decisions, routes);
    const update = this.setMaterialControl(routed.patch);
    return {
      ...update,
      routedMappingIds: routed.routedMappingIds,
      smoothingMsByControl: routed.smoothingMsByControl
    };
  }

  /** Route deduplicated event projections through enabled event mappings only. */
  emitTriggers(triggers: readonly SignalTrigger[]): number {
    if (
      !this.outputArmed ||
      !this.context ||
      this.state !== "running" ||
      triggers.length === 0
    ) {
      return 0;
    }
    const routedSignalIds = new Set(
      this.controlDecisions
        .filter(
          (decision) =>
            (decision.status === "applied" || decision.status === "uncertainty") &&
            decision.outputValue !== null &&
            decision.outputValue > 0 &&
            isEventControlTarget(decision.target)
        )
        .map((decision) => decision.signalId)
    );
    const voice = this.modules.find(
      (module): module is ControlFieldVoice => module instanceof ControlFieldVoice
    );
    return voice?.emitTriggers(
      triggers.filter((trigger) => routedSignalIds.has(trigger.signalId))
    ) ?? 0;
  }

  routeLatestControlsToMaterial(
    routes: readonly MaterialControlRoute[] = DEFAULT_MATERIAL_CONTROL_ROUTES
  ): RoutedMaterialControlUpdate {
    return this.routeMaterialControls(this.controlDecisions, routes);
  }

  getMaterialStatus(): MaterialStatus {
    return this.material?.getStatus() ?? emptyMaterialStatus(this.materialControls);
  }

  getControlDecisions(): readonly ControlDecision[] {
    return this.controlDecisions;
  }

  /**
   * The last bounded output per mapping id. Exports pass this back so a
   * `hold-explicitly` policy can be recorded as held rather than degrading to
   * skipped, which would understate what the instrument actually emitted.
   */
  getControlState(): Record<string, number> {
    return Object.fromEntries(this.controlState);
  }

  stop(): AudioEngineStatus {
    // The old startup continues only long enough to close its own context.
    // Clearing the shared handle lets a new explicit Listen create a fresh
    // context without allowing the old promise's finally block to erase it.
    this.startPromise = null;
    if (!this.context) {
      this.state = "stopped";
      return this.getStatus();
    }

    for (const module of this.modules) {
      module.stop(this.context);
    }

    this.material?.dispose();

    this.master?.setVolume(0);
    void this.context.close();
    this.context = null;
    this.master = null;
    this.material = null;
    this.buses.clear();
    this.modules = [];
    this.state = "stopped";

    return this.getStatus();
  }

  panic(): AudioEngineStatus {
    if (this.master && this.context) {
      this.master.output.gain.cancelScheduledValues(this.context.currentTime);
      this.master.output.gain.setValueAtTime(0, this.context.currentTime);
    }

    this.stop();
    this.state = "panicked";
    return this.getStatus();
  }

  getStatus(): AudioEngineStatus {
    return {
      state: this.state,
      outputArmed: this.outputArmed,
      sampleRate: this.context?.sampleRate ?? null,
      currentTime: this.context?.currentTime ?? 0,
      masterVolume: this.masterVolume,
      density: this.density,
      moduleIds: this.modules.map((module) => module.id)
    };
  }

  /**
   * Real per-layer output levels (0..1) read from each bus analyser. Returns
   * zeros when the engine is not running so meters fall silent with the audio.
   */
  getLayerLevels(): Record<StackLayer, number> {
    const levels = {} as Record<StackLayer, number>;
    for (const layer of stackLayers) {
      const bus = this.buses.get(layer);
      levels[layer] =
        this.outputArmed && this.state === "running" && bus ? bus.level() : 0;
    }
    return levels;
  }

  private requireBus(layer: StackLayer): LayerBus {
    const bus = this.buses.get(layer);
    if (!bus) {
      throw new Error(`Missing audio bus for layer: ${layer}`);
    }
    return bus;
  }
}
