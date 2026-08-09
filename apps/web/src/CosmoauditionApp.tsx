import {
  type ChangeEvent,
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  AudioEngine,
  DEFAULT_MASTER_VOLUME,
  type AudioEngineStatus,
  type MaterialControl,
  type MaterialControlRoute,
  validateMaterialByteLength
} from "@cosmoaudition/audio-engine";
import {
  buildStackIndices,
  createDefaultModulatorBank,
  createModulatorSignals,
  executeMapping,
  executeMappings,
  mappingCatalog,
  manualLocalityPresets,
  projectSignalTriggers,
  sourceDefinitions,
  type ControlDecision,
  type ManualLocality,
  type ModulatorDefinition,
  type ObservedSignal,
  type SignalTrigger,
  type SonicMapping,
  type SourceHealth
} from "@cosmoaudition/core";
import {
  createMidiFile,
  listMidiOutputs,
  projectControlDecision,
  requestBrowserMidiAccess,
  sendMidiControlChange,
  type MidiOutputLike
} from "@cosmoaudition/midi-engine";
import {
  epistemicMarks,
  sourceStrata,
  sourceStratumLabels,
  type SourceStratum
} from "@cosmoaudition/ui-system";
import {
  createBrowserSessionSignals,
  type ApiSnapshot,
  type SnapshotMode
} from "./lib/instrument";

type Workspace = "observe" | "patch" | "transform" | "route" | "archive";
type MaterialModulationMode = "catalog" | "selected";
type EvidenceKind = keyof typeof epistemicMarks;
type AcquisitionScope = "all" | "cosmic" | "earth-systems" | "human-infrastructure";

interface RouteSetting {
  enabled: boolean;
  amount: number;
}

interface OutputState {
  audio: boolean;
  midi: boolean;
  triggers: boolean;
  controls: boolean;
  masa: boolean;
}

type MaterialControls = MaterialControl;

interface SessionEntry {
  id: string;
  capturedAt: string;
  title: string;
  snapshot: ApiSnapshot;
}

interface SourceGroup {
  stratum: SourceStratum;
  sourceIds: string[];
  signals: ObservedSignal[];
  health: SourceHealth[];
  readyCount: number;
}

interface LatestRuntimeState {
  outputs: OutputState;
  routes: Readonly<Record<string, RouteSetting>>;
  midiOutputs: readonly MidiOutputLike[];
  selectedMidiOutputId: string;
  generatorEnabled: boolean;
  generatorRate: number;
  generatorSeed: number;
  modulationDefinitions: readonly ModulatorDefinition[];
  audioSampleRate: number | null;
  masterVolume: number;
  materialControls: MaterialControls;
  materialModulationDepth: number;
  materialModulationMode: MaterialModulationMode;
  selectedSignalId: string | null;
}

const ARCHIVE_KEY = "cosmoaudition.archive.v1";
const MAX_ARCHIVE = 12;
/** A hung local gateway must not leave the instrument loading indefinitely. */
const SNAPSHOT_TIMEOUT_MS = 30_000;
const MAX_RECENT_TRIGGERS = 64;
const RECENT_TRIGGER_WINDOW_MS = 15 * 60 * 1000;
const workspaceLabels: Record<Workspace, string> = {
  observe: "Observe",
  patch: "Patch",
  transform: "Transform",
  route: "Route",
  archive: "Archive"
};

const initialRoutes = Object.fromEntries(
  mappingCatalog.map((mapping) => [mapping.id, { enabled: true, amount: 1 }])
) as Record<string, RouteSetting>;

const initialOutputs: OutputState = {
  audio: true,
  midi: false,
  triggers: true,
  controls: true,
  masa: true
};

const activeApiSourceIds = sourceDefinitions
  .filter((source) => source.status === "ready" && source.route === "api-proxy")
  .map((source) => source.id);

const acquisitionScopes: Readonly<
  Record<AcquisitionScope, { label: string; sourceIds: readonly string[] }>
> = {
  all: { label: "All active providers", sourceIds: activeApiSourceIds },
  cosmic: {
    label: "Cosmos + space weather",
    sourceIds: activeApiSourceIds.filter(
      (id) => sourceDefinitions.find((source) => source.id === id)?.sphere === "cosmos"
    )
  },
  "earth-systems": {
    label: "Atmosphere + geosphere + biosphere",
    sourceIds: activeApiSourceIds.filter((id) => {
      const sphere = sourceDefinitions.find((source) => source.id === id)?.sphere;
      return sphere === "atmosphere" || sphere === "geosphere" || sphere === "biosphere";
    })
  },
  "human-infrastructure": {
    label: "Human + civic + network systems",
    sourceIds: activeApiSourceIds.filter((id) => {
      const sphere = sourceDefinitions.find((source) => source.id === id)?.sphere;
      return sphere === "human" || sphere === "machine";
    })
  }
};

const materialControlRoutes: readonly MaterialControlRoute[] = [
  { target: "material.playbackRate", control: "playbackRate" },
  { target: "material.cutoffHz", control: "cutoffHz" },
  { target: "material.filterQ", control: "filterQ" },
  { target: "material.delayMix", control: "delayMix" },
  { target: "material.delayTimeSeconds", control: "delayTimeSeconds" },
  { target: "material.delayFeedback", control: "delayFeedback" }
];

function idleAudioStatus(): AudioEngineStatus {
  return {
    state: "idle",
    outputArmed: true,
    sampleRate: null,
    currentTime: 0,
    masterVolume: DEFAULT_MASTER_VOLUME,
    density: 0,
    moduleIds: []
  };
}

function stratumForSource(sourceId: string): SourceStratum {
  const declared = sourceDefinitions.find((source) => source.id === sourceId)?.sphere;
  if (declared && sourceStrata.includes(declared)) {
    return declared;
  }
  const id = sourceId.toLowerCase();

  if (id.includes("swpc") || id.includes("solar") || id.includes("jpl") || id.includes("approach")) {
    return "cosmos";
  }
  if (id.includes("meteo") || id.includes("weather") || id.includes("atmos")) {
    return "atmosphere";
  }
  if (id.includes("usgs") || id.includes("earthquake") || id.includes("quake")) {
    return "geosphere";
  }
  if (id.includes("naturalist") || id.includes("gbif") || id.includes("bio")) {
    return "biosphere";
  }
  if (
    id.includes("wikimedia") ||
    id.includes("pageview") ||
    id.includes("population") ||
    id.includes("market") ||
    id.includes("coingecko") ||
    id.includes("oil")
  ) {
    return "human";
  }
  return "machine";
}

function evidenceForSignal(signal: ObservedSignal): EvidenceKind {
  const id = signal.id.toLowerCase();
  const notes = signal.notes?.toLowerCase() ?? "";

  if (signal.value === null) return "unknown";
  // A signal that names itself a forecast is a forecast, whatever its source's
  // general temporal character says. The carbon source declares "aggregate",
  // which would otherwise mask its own explicit forecast field.
  if (id.includes("forecast")) return "forecast";
  if (signal.temporalCharacter === "forecast") return "forecast";
  if (signal.temporalCharacter === "event") return "event";
  if (signal.temporalCharacter === "aggregate") return "aggregate";
  if (signal.epistemicStatus === "derived") return "inferred";
  if (signal.epistemicStatus === "interpreted") return "interpreted";
  if (signal.epistemicStatus === "speculative") return "speculative";
  if (id.includes("forecast") || id.includes("approach")) return "forecast";
  if (
    id.includes("count") ||
    id.includes("mix") ||
    id.includes("ratio") ||
    id.includes("wikimedia") ||
    id.includes("naturalist") ||
    notes.includes("aggregate")
  ) {
    return "aggregate";
  }
  if (id.includes("earthquake") || id.includes("flare") || id.includes("event")) return "event";
  if (id.endsWith("_index") || id.includes("derived")) return "inferred";
  return "measured";
}

function formatValue(value: number | null, unit: string): string {
  if (value === null || !Number.isFinite(value)) return "unknown";
  const magnitude = Math.abs(value);
  const formatted =
    magnitude >= 1_000_000
      ? value.toExponential(2)
      : magnitude >= 100
        ? value.toFixed(1)
        : magnitude >= 1
          ? value.toFixed(2)
          : value.toFixed(4);
  return `${formatted} ${unit}`.trim();
}

function formatAge(timestamp: string | null | undefined): string {
  if (!timestamp) return "time unknown";
  const delta = Date.now() - Date.parse(timestamp);
  if (!Number.isFinite(delta) || delta < 0) return "time unknown";
  const seconds = Math.floor(delta / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function downloadBlob(filename: string, type: string, body: BlobPart): void {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function readArchive(): SessionEntry[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(ARCHIVE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    // Entries are normalized on read: an archive written by an earlier build
    // may be missing fields the interface renders directly.
    return parsed
      .filter(isRenderableArchiveEntry)
      .map((entry, index) => ({
        id: typeof entry.id === "string" ? entry.id : `entry-${index}`,
        capturedAt:
          typeof entry.capturedAt === "string"
            ? entry.capturedAt
            : typeof entry.createdAt === "string"
              ? entry.createdAt
              : new Date().toISOString(),
        title:
          typeof entry.title === "string"
            ? entry.title
            : `Observation ${index + 1}`,
        snapshot: entry.snapshot
      }))
      .slice(0, MAX_ARCHIVE);
  } catch {
    return [];
  }
}

/**
 * Archive entries are rendered directly, so an entry whose snapshot lacks its
 * arrays would throw during render and blank the instrument. Anything that
 * cannot be displayed is dropped at read time instead.
 */
function isRenderableArchiveEntry(
  entry: unknown
): entry is Record<string, unknown> & { snapshot: ApiSnapshot } {
  if (!entry || typeof entry !== "object" || !("snapshot" in entry)) return false;
  const snapshot = (entry as { snapshot: unknown }).snapshot;
  if (!snapshot || typeof snapshot !== "object") return false;
  const candidate = snapshot as Partial<ApiSnapshot>;
  return (
    typeof candidate.generatedAt === "string" &&
    typeof candidate.mode === "string" &&
    Array.isArray(candidate.signals) &&
    Array.isArray(candidate.sources)
  );
}

function makeSessionId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `session-${Date.now()}`;
}

function mappingExecutionOptions(
  routes: Readonly<Record<string, RouteSetting>>
): { disabledMappingIds: Set<string>; mappingAmounts: Map<string, number> } {
  const disabledMappingIds = new Set<string>();
  const mappingAmounts = new Map<string, number>();
  for (const mapping of mappingCatalog) {
    const route = routes[mapping.id] ?? { enabled: false, amount: 0 };
    if (!route.enabled) disabledMappingIds.add(mapping.id);
    mappingAmounts.set(mapping.id, route.amount);
  }
  return { disabledMappingIds, mappingAmounts };
}

function decisionsForSignals(
  signals: readonly ObservedSignal[],
  routes: Readonly<Record<string, RouteSetting>>
): ControlDecision[] {
  return executeMappings(mappingCatalog, signals, mappingExecutionOptions(routes));
}

function outputSummary(outputs: OutputState): string {
  const active = Object.entries(outputs)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
  return active.length === 0 ? "No outputs armed" : `${active.length} outputs armed`;
}

export function shouldEmitAudibleTriggers(
  audioArmed: boolean,
  triggerArmed: boolean
): boolean {
  return audioArmed && triggerArmed;
}

function mergeRecentTriggers(
  current: readonly SignalTrigger[],
  incoming: readonly SignalTrigger[],
  now = Date.now()
): SignalTrigger[] {
  const byId = new Map<string, SignalTrigger>();
  for (const trigger of [...current, ...incoming]) {
    const projected = Date.parse(trigger.projectedAt);
    if (Number.isFinite(projected) && now - projected <= RECENT_TRIGGER_WINDOW_MS) {
      byId.set(trigger.id, trigger);
    }
  }
  return [...byId.values()]
    .sort((left, right) => left.projectedAt.localeCompare(right.projectedAt))
    .slice(-MAX_RECENT_TRIGGERS);
}

function modulatedMaterialControls(
  base: MaterialControls,
  normalized: number | null | undefined,
  depth: number
): MaterialControls {
  if (normalized === null || normalized === undefined || !Number.isFinite(normalized)) {
    return base;
  }
  const amount = Math.min(1, Math.max(0, depth));
  const value = Math.min(1, Math.max(0, normalized));
  const target: MaterialControls = {
    cutoffHz: 120 * Math.pow(100, value),
    filterQ: 0.4 + value * 11.6,
    playbackRate: 0.5 + value * 1.25,
    delayMix: value * 0.55,
    delayTimeSeconds: 0.03 + value * 1.2,
    delayFeedback: value * 0.7,
    gain: 0.18 + value * 0.24
  };
  return {
    cutoffHz: base.cutoffHz + (target.cutoffHz - base.cutoffHz) * amount,
    filterQ: base.filterQ + (target.filterQ - base.filterQ) * amount,
    playbackRate:
      base.playbackRate + (target.playbackRate - base.playbackRate) * amount,
    delayMix: base.delayMix + (target.delayMix - base.delayMix) * amount,
    delayTimeSeconds:
      base.delayTimeSeconds +
      (target.delayTimeSeconds - base.delayTimeSeconds) * amount,
    delayFeedback:
      base.delayFeedback +
      (target.delayFeedback - base.delayFeedback) * amount,
    gain: base.gain + (target.gain - base.gain) * amount
  };
}

export function CosmoauditionApp() {
  const apiBaseUrl = useMemo(
    () => import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8797",
    []
  );
  const engineRef = useRef<AudioEngine | null>(null);
  const snapshotRef = useRef<ApiSnapshot | null>(null);
  const snapshotRequestRef = useRef(0);
  const snapshotAbortRef = useRef<AbortController | null>(null);
  const audioStartRequestRef = useRef(0);
  const audioStartPendingRef = useRef<number | null>(null);
  const materialLoadRequestRef = useRef(0);
  const triggerHistoryRef = useRef<Set<string>>(new Set());
  const recentTriggersRef = useRef<SignalTrigger[]>([]);
  const generatorOriginRef = useRef(new Date().toISOString());
  const [workspace, setWorkspace] = useState<Workspace>("observe");
  const [snapshotMode, setSnapshotMode] = useState<Exclude<SnapshotMode, "archive">>(
    "fixture"
  );
  const [snapshot, setSnapshot] = useState<ApiSnapshot | null>(null);
  const [acquisitionScope, setAcquisitionScope] = useState<AcquisitionScope>("all");
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);
  const [selectedStratum, setSelectedStratum] = useState<SourceStratum | "all">(
    "all"
  );
  const [localityId, setLocalityId] = useState(manualLocalityPresets[0]?.id ?? "bogota");
  const [audioStatus, setAudioStatus] = useState<AudioEngineStatus>(idleAudioStatus);
  // A primitive so effects can depend on the engine's state without re-running
  // every time the status object is replaced.
  const audioState = audioStatus.state;
  // Mirrors the engine's last bounded outputs so the Patch inspector reports
  // the same decision the engine made, including held values.
  const [engineControlState, setEngineControlState] = useState<Record<string, number>>(
    {}
  );
  const [masterVolume, setMasterVolume] = useState(DEFAULT_MASTER_VOLUME);
  const [autoObserve, setAutoObserve] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isAudioStarting, setIsAudioStarting] = useState(false);
  const [message, setMessage] = useState(
    "Ready for an explicit fixture observation. Audio is stopped."
  );
  const [routes, setRoutes] = useState<Record<string, RouteSetting>>(initialRoutes);
  const [outputs, setOutputs] = useState<OutputState>(initialOutputs);
  const [materialName, setMaterialName] = useState<string | null>(null);
  const [materialPlaying, setMaterialPlaying] = useState(false);
  const [materialControls, setMaterialControls] = useState<MaterialControls>({
    cutoffHz: 2400,
    filterQ: 0.7,
    playbackRate: 1,
    delayMix: 0.16,
    delayTimeSeconds: 0.24,
    delayFeedback: 0.18,
    gain: 0.24
  });
  const [materialModulationDepth, setMaterialModulationDepth] = useState(0.62);
  const [materialModulationMode, setMaterialModulationMode] =
    useState<MaterialModulationMode>("catalog");
  const [archive, setArchive] = useState<SessionEntry[]>(readArchive);
  const [midiOutputs, setMidiOutputs] = useState<MidiOutputLike[]>([]);
  const [selectedMidiOutputId, setSelectedMidiOutputId] = useState<string>("");
  const [generatorEnabled, setGeneratorEnabled] = useState(true);
  const [generatorRate, setGeneratorRate] = useState(1);
  const [generatorSeed, setGeneratorSeed] = useState(0x534d4f);
  const [recentTriggers, setRecentTriggers] = useState<SignalTrigger[]>([]);

  const locality =
    manualLocalityPresets.find((candidate) => candidate.id === localityId) ??
    (manualLocalityPresets[0] as ManualLocality);

  const selectedSignal = useMemo(
    () => snapshot?.signals.find((signal) => signal.id === selectedSignalId) ?? null,
    [selectedSignalId, snapshot]
  );
  const effectiveMaterialControls = useMemo(
    () =>
      modulatedMaterialControls(
        materialControls,
        selectedSignal?.normalized,
        materialModulationDepth
      ),
    [materialControls, materialModulationDepth, selectedSignal?.normalized]
  );
  const modulationDefinitions = useMemo(
    () =>
      createDefaultModulatorBank(
        generatorOriginRef.current,
        generatorSeed,
        generatorRate
      ),
    [generatorRate, generatorSeed]
  );
  const runtimeRef = useRef<LatestRuntimeState>({
    outputs,
    routes,
    midiOutputs,
    selectedMidiOutputId,
    generatorEnabled,
    generatorRate,
    generatorSeed,
    modulationDefinitions,
    audioSampleRate: audioStatus.sampleRate,
    masterVolume,
    materialControls,
    materialModulationDepth,
    materialModulationMode,
    selectedSignalId
  });

  // Async acquisitions, permission prompts, audio startup, and material
  // decoding must commit against the latest explicitly selected runtime state,
  // not the render that happened to launch the request.
  useLayoutEffect(() => {
    runtimeRef.current = {
      outputs,
      routes,
      midiOutputs,
      selectedMidiOutputId,
      generatorEnabled,
      generatorRate,
      generatorSeed,
      modulationDefinitions,
      audioSampleRate: audioStatus.sampleRate,
      masterVolume,
      materialControls,
      materialModulationDepth,
      materialModulationMode,
      selectedSignalId
    };
  }, [
    audioStatus.sampleRate,
    generatorEnabled,
    generatorRate,
    generatorSeed,
    masterVolume,
    materialControls,
    materialModulationDepth,
    materialModulationMode,
    midiOutputs,
    modulationDefinitions,
    outputs,
    routes,
    selectedMidiOutputId,
    selectedSignalId
  ]);

  const sourceGroups = useMemo<SourceGroup[]>(() => {
    const signals = snapshot?.signals ?? [];
    const health = snapshot?.sources ?? [];
    return sourceStrata.map((stratum) => {
      const sourceIds = Array.from(
        new Set([
          ...signals
            .filter((signal) => stratumForSource(signal.sourceId) === stratum)
            .map((signal) => signal.sourceId),
          ...health
            .filter((source) => stratumForSource(source.sourceId) === stratum)
            .map((source) => source.sourceId)
        ])
      );
      const groupSignals = signals.filter((signal) => sourceIds.includes(signal.sourceId));
      const groupHealth = health.filter((source) => sourceIds.includes(source.sourceId));
      return {
        stratum,
        sourceIds,
        signals: groupSignals,
        health: groupHealth,
        readyCount: groupSignals.filter((signal) => signal.value !== null).length
      };
    });
  }, [snapshot]);

  const fieldSignals = useMemo(() => {
    const signals = snapshot?.signals ?? [];
    const filtered =
      selectedStratum === "all"
        ? signals
        : signals.filter((signal) => stratumForSource(signal.sourceId) === selectedStratum);
    return [...filtered]
      .sort((a, b) => Number(b.value !== null) - Number(a.value !== null))
      .slice(0, 24);
  }, [selectedStratum, snapshot]);

  const indices = useMemo(() => buildStackIndices(snapshot?.signals ?? []), [snapshot]);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    return () => {
      audioStartRequestRef.current += 1;
      audioStartPendingRef.current = null;
      materialLoadRequestRef.current += 1;
      snapshotRequestRef.current += 1;
      const controller = snapshotAbortRef.current;
      snapshotAbortRef.current = null;
      controller?.abort();
      engineRef.current?.stop();
    };
  }, []);

  // The cadence reads the latest loadSnapshot through a ref: capturing the
  // function in the interval would freeze generator, output, and audio state
  // as of the render that armed the timer.
  const loadSnapshotRef = useRef(loadSnapshot);
  useEffect(() => {
    loadSnapshotRef.current = loadSnapshot;
  });

  useEffect(() => {
    if (!autoObserve || snapshotMode !== "live") return;
    const timer = window.setInterval(() => {
      void takeObservation("live", false).catch(() => undefined);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [autoObserve, snapshotMode]);

  useEffect(() => {
    const replaceGeneratorSignals = (current: ApiSnapshot, now: Date): ApiSnapshot => ({
      ...current,
      signals: [
        ...current.signals.filter((signal) => signal.sourceId !== "local_modulation_bank"),
        ...(generatorEnabled ? createModulatorSignals(modulationDefinitions, now) : [])
      ]
    });
    let renderStep = 0;
    const update = () => {
      const current = snapshotRef.current;
      if (!current) return;
      const next = replaceGeneratorSignals(current, new Date());
      snapshotRef.current = next;
      let nextAudioStatus: AudioEngineStatus | null = null;
      if (engineRef.current) {
        nextAudioStatus = applySignalsToEngine(engineRef.current, next.signals);
      }
      const projection = projectSignalTriggers(
        next.signals,
        triggerHistoryRef.current
      );
      triggerHistoryRef.current = projection.seenEventKeys;
      if (shouldEmitAudibleTriggers(outputs.audio, outputs.triggers)) {
        engineRef.current?.emitTriggers(projection.triggers);
      }
      recentTriggersRef.current = mergeRecentTriggers(
        recentTriggersRef.current,
        projection.triggers
      );
      if (!generatorEnabled) {
        if (nextAudioStatus) setAudioStatus(nextAudioStatus);
        setSnapshot(next);
        if (engineRef.current) setEngineControlState(engineRef.current.getControlState());
        setRecentTriggers(recentTriggersRef.current);
        return;
      }
      renderStep = (renderStep + 1) % 5;
      if (renderStep === 0) {
        if (nextAudioStatus) setAudioStatus(nextAudioStatus);
        setSnapshot(next);
        if (engineRef.current) setEngineControlState(engineRef.current.getControlState());
        setRecentTriggers(recentTriggersRef.current);
      }
    };
    update();
    if (!generatorEnabled) return;
    // The generator only needs audio-rate resolution when something can
    // actually consume it. With no engine running and no output armed its
    // signals are display material, so publish them far less often instead of
    // rebuilding the snapshot twenty times a second.
    const consumable =
      audioState === "running" || outputs.triggers || outputs.midi;
    const timer = window.setInterval(update, consumable ? 50 : 500);
    return () => window.clearInterval(timer);
  }, [
    audioState,
    outputs.midi,
    generatorEnabled,
    materialControls,
    materialModulationDepth,
    materialModulationMode,
    modulationDefinitions,
    outputs.audio,
    outputs.triggers,
    routes,
    selectedSignalId
  ]);

  useEffect(() => {
    if (engineRef.current) {
      if (materialModulationMode === "selected") {
        engineRef.current.setMaterialControl(effectiveMaterialControls);
      } else {
        engineRef.current.routeMaterialControls(
          engineRef.current.getControlDecisions(),
          materialControlRoutes
        );
      }
    }
  }, [effectiveMaterialControls, materialModulationMode]);

  function currentEngine(): AudioEngine {
    const engine = engineRef.current ?? new AudioEngine();
    engineRef.current = engine;
    engine.setOutputArmed(runtimeRef.current.outputs.audio);
    engine.setMasterVolume(runtimeRef.current.masterVolume);
    return engine;
  }

  function applySignalsToEngine(
    engine: AudioEngine,
    signals: readonly ObservedSignal[],
    activeRoutes: Readonly<Record<string, RouteSetting>> = runtimeRef.current.routes
  ): AudioEngineStatus {
    const runtime = runtimeRef.current;
    const status = engine.updateSignals(
      signals,
      mappingExecutionOptions(activeRoutes)
    );
    if (runtime.materialModulationMode === "catalog") {
      engine.routeMaterialControls(engine.getControlDecisions(), materialControlRoutes);
    } else {
      const activeSignal = signals.find(
        (signal) => signal.id === runtime.selectedSignalId
      );
      engine.setMaterialControl(
        modulatedMaterialControls(
          runtime.materialControls,
          activeSignal?.normalized,
          runtime.materialModulationDepth
        )
      );
    }
    return status;
  }

  async function loadSnapshot(
    mode: Exclude<SnapshotMode, "archive"> = snapshotMode,
    announce = true
  ): Promise<ApiSnapshot> {
    setIsLoading(true);
    const startedAt = performance.now();
    const params = new URLSearchParams({
      mode,
      lat: locality.latitude.toFixed(4),
      lon: locality.longitude.toFixed(4),
      sources: acquisitionScopes[acquisitionScope].sourceIds.join(",")
    });

    // Each acquisition takes a ticket. A slow earlier response must not
    // overwrite a newer snapshot or a replayed archive entry, and a hung
    // gateway must not leave the instrument loading forever.
    const requestId = ++snapshotRequestRef.current;
    snapshotAbortRef.current?.abort();
    const controller = new AbortController();
    snapshotAbortRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), SNAPSHOT_TIMEOUT_MS);

    try {
      const response = await fetch(`${apiBaseUrl}/api/snapshot?${params.toString()}`, {
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Observation request failed: HTTP ${response.status}`);
      const body = (await response.json()) as ApiSnapshot;
      if (requestId !== snapshotRequestRef.current) {
        // A newer acquisition or archive replay owns the commit. Never hand a
        // caller the superseded body as though it had become current state.
        const current = snapshotRef.current;
        if (current) return current;
        throw new DOMException("Observation request was superseded.", "AbortError");
      }
      const runtime = runtimeRef.current;
      const latency = performance.now() - startedAt;
      const browserSignals = createBrowserSessionSignals(
        latency,
        runtime.audioSampleRate
      );
      const generatorSignals = runtime.generatorEnabled
        ? createModulatorSignals(runtime.modulationDefinitions, new Date())
        : [];
      const next: ApiSnapshot = {
        ...body,
        mode,
        coordinates: body.coordinates ?? {
          latitude: locality.latitude,
          longitude: locality.longitude
        },
        signals: [
          ...body.signals.filter(
            (signal) => !browserSignals.some((local) => local.id === signal.id)
          ),
          ...browserSignals,
          ...generatorSignals
        ]
      };
      snapshotRef.current = next;
      setSnapshot(next);
      const projection = projectSignalTriggers(next.signals, triggerHistoryRef.current);
      triggerHistoryRef.current = projection.seenEventKeys;
      if (
        shouldEmitAudibleTriggers(runtime.outputs.audio, runtime.outputs.triggers) &&
        engineRef.current
      ) {
        engineRef.current.emitTriggers(projection.triggers);
      }
      recentTriggersRef.current = mergeRecentTriggers(
        recentTriggersRef.current,
        projection.triggers
      );
      setRecentTriggers(recentTriggersRef.current);
      const nextSelectedSignalId = next.signals.some(
        (signal) => signal.id === runtime.selectedSignalId
      )
        ? runtime.selectedSignalId
        : (next.signals.find((signal) => signal.value !== null)?.id ?? null);
      runtimeRef.current.selectedSignalId = nextSelectedSignalId;
      setSelectedSignalId(nextSelectedSignalId);
      if (engineRef.current) {
        setAudioStatus(applySignalsToEngine(engineRef.current, next.signals));
        setEngineControlState(engineRef.current.getControlState());
      }
      if (announce) {
        const observationBasis =
          mode === "fixture"
            ? "the bundled Bogotá fixture"
            : `${locality.label} (${next.coordinates?.latitude.toFixed(4) ?? "?"}, ${next.coordinates?.longitude.toFixed(4) ?? "?"})`;
        const acquisitionKind = mode === "fixture" ? "fixture/API" : "provider/API";
        setMessage(
          `${mode === "fixture" ? "Fixture" : "Live"} observation accepted: ${body.signals.length} ${acquisitionKind} signals from ${observationBasis}; ${browserSignals.length} browser-session signals added locally; ${generatorSignals.length} deterministic generator signals added locally.`
        );
      }
      if (runtimeRef.current.outputs.midi) {
        sendSnapshotToMidi(next, false);
      }
      return next;
    } catch (error) {
      const copy =
        error instanceof DOMException && error.name === "AbortError"
          ? `The observation request exceeded ${Math.round(SNAPSHOT_TIMEOUT_MS / 1000)} seconds and was cancelled`
          : error instanceof Error
            ? error.message
            : String(error);
      if (requestId === snapshotRequestRef.current) {
        setMessage(`${copy}. No value was substituted for the failed observation.`);
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
      // Only the newest acquisition clears the loading state, so an overtaken
      // request cannot re-enable the control while a newer one is still open.
      if (requestId === snapshotRequestRef.current) {
        if (snapshotAbortRef.current === controller) {
          snapshotAbortRef.current = null;
        }
        setIsLoading(false);
      }
    }
  }

  function takeObservation(
    mode: Exclude<SnapshotMode, "archive"> = snapshotMode,
    announce = true
  ): Promise<ApiSnapshot> {
    // An explicit observation changes state but must never complete a Listen
    // gesture that is still waiting on an older observation.
    audioStartRequestRef.current += 1;
    if (audioStartPendingRef.current !== null) {
      audioStartPendingRef.current = null;
      setIsAudioStarting(false);
      const engine = engineRef.current;
      if (engine && engine.getStatus().state !== "running") {
        setAudioStatus(engine.stop());
      }
    }
    return loadSnapshotRef.current(mode, announce);
  }

  async function startAudio(): Promise<void> {
    if (audioStartPendingRef.current !== null) return;
    const audioRequestId = ++audioStartRequestRef.current;
    audioStartPendingRef.current = audioRequestId;
    setIsAudioStarting(true);
    try {
      if (!runtimeRef.current.outputs.audio) {
        setMessage("Arm the Internal audio output in Route before listening.");
        return;
      }

      let current = snapshotRef.current;
      if (!current) {
        try {
          current = await loadSnapshot(snapshotMode, false);
        } catch {
          // loadSnapshot owns the acquisition-specific error account. In
          // particular, a superseded request must stay silent here.
          return;
        }
      }
      if (
        audioRequestId !== audioStartRequestRef.current ||
        !runtimeRef.current.outputs.audio
      ) {
        return;
      }

      try {
        const engine = currentEngine();
        const started = await engine.start();
        if (
          audioRequestId !== audioStartRequestRef.current ||
          !runtimeRef.current.outputs.audio ||
          started.state !== "running"
        ) {
          // Each cancellation path stops its pending context immediately.
          // This stale continuation must never stop a newer Listen that has
          // already installed another context on the same engine object.
          return;
        }
        engine.setOutputArmed(true);
        engine.setMasterVolume(runtimeRef.current.masterVolume);
        setAudioStatus(applySignalsToEngine(engine, current.signals));
        setEngineControlState(engine.getControlState());
        setMessage(
          `Listening engine running at ${started.sampleRate ?? "unknown"} Hz. Data mappings are authored controls, not source voices.`
        );
      } catch (error) {
        if (audioRequestId === audioStartRequestRef.current) {
          setMessage(error instanceof Error ? error.message : String(error));
        }
      }
    } finally {
      if (audioStartPendingRef.current === audioRequestId) {
        audioStartPendingRef.current = null;
        setIsAudioStarting(false);
      }
    }
  }

  function stopAudio(): void {
    audioStartRequestRef.current += 1;
    audioStartPendingRef.current = null;
    setIsAudioStarting(false);
    materialLoadRequestRef.current += 1;
    setAudioStatus(
      engineRef.current?.stop() ?? {
        ...idleAudioStatus(),
        outputArmed: runtimeRef.current.outputs.audio,
        state: "stopped"
      }
    );
    setMaterialName(null);
    setMaterialPlaying(false);
    setMessage("Audio stopped. Observation and lineage remain available.");
  }

  function panicAudio(): void {
    audioStartRequestRef.current += 1;
    audioStartPendingRef.current = null;
    setIsAudioStarting(false);
    materialLoadRequestRef.current += 1;
    setAudioStatus(
      engineRef.current?.panic() ?? {
        ...idleAudioStatus(),
        outputArmed: runtimeRef.current.outputs.audio,
        state: "panicked"
      }
    );
    setMaterialName(null);
    setMaterialPlaying(false);
    setMessage("Panic stop engaged. All local audio paths were closed.");
  }

  function updateMaster(value: number): void {
    runtimeRef.current.masterVolume = value;
    setMasterVolume(value);
    setAudioStatus(
      engineRef.current?.setMasterVolume(value) ?? { ...audioStatus, masterVolume: value }
    );
  }

  function updateRoute(mapping: SonicMapping, patch: Partial<RouteSetting>): void {
    const currentRoutes = runtimeRef.current.routes;
    const next = {
      ...currentRoutes,
      [mapping.id]: {
        ...(currentRoutes[mapping.id] ?? { enabled: true, amount: 1 }),
        ...patch
      }
    };
    runtimeRef.current.routes = next;
    setRoutes(next);
    const currentSnapshot = snapshotRef.current;
    if (currentSnapshot && engineRef.current) {
      setAudioStatus(
        applySignalsToEngine(engineRef.current, currentSnapshot.signals, next)
      );
      setEngineControlState(engineRef.current.getControlState());
    }
    setMessage(
      patch.enabled === false
        ? `${mapping.id} skipped; its source value remains unchanged in the observation.`
        : `${mapping.id} control route updated.`
    );
  }

  async function loadMaterial(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    const materialRequestId = ++materialLoadRequestRef.current;
    if (!runtimeRef.current.outputs.audio) {
      setMessage("Arm the Internal audio output in Route before loading material.");
      event.target.value = "";
      return;
    }
    try {
      validateMaterialByteLength(file.size);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      event.target.value = "";
      return;
    }
    try {
      const engine = engineRef.current;
      if (engine?.getStatus().state === "panicked") {
        setMessage(
          "Panic is active. Press Listen to re-arm audio before loading material."
        );
        return;
      }
      if (!engine || engine.getStatus().state !== "running") {
        setMessage("Press Listen before loading material.");
        return;
      }
      // Reading and decoding may be asynchronous, but choosing a file is not
      // an audio-start gesture. Only an already-running engine may accept it.
      const bytes = await file.arrayBuffer();
      if (
        materialRequestId !== materialLoadRequestRef.current ||
        engineRef.current !== engine ||
        !runtimeRef.current.outputs.audio
      ) {
        return;
      }
      setAudioStatus(engine.getStatus());
      await engine.loadMaterial(bytes, file.name);
      if (
        materialRequestId !== materialLoadRequestRef.current ||
        engineRef.current !== engine ||
        !runtimeRef.current.outputs.audio
      ) {
        return;
      }
      setMaterialName(file.name);
      const runtime = runtimeRef.current;
      if (runtime.materialModulationMode === "catalog") {
        engine.routeMaterialControls(engine.getControlDecisions(), materialControlRoutes);
      } else {
        const signal = snapshotRef.current?.signals.find(
          (candidate) => candidate.id === runtime.selectedSignalId
        );
        engine.setMaterialControl(
          modulatedMaterialControls(
            runtime.materialControls,
            signal?.normalized,
            runtime.materialModulationDepth
          )
        );
      }
      setMessage(`${file.name} loaded as a private local parent representation.`);
    } catch (error) {
      if (materialRequestId === materialLoadRequestRef.current) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      event.target.value = "";
    }
  }

  function playMaterial(): void {
    if (!runtimeRef.current.outputs.audio) {
      setMessage("Arm the Internal audio output in Route before material playback.");
      return;
    }
    const engine = engineRef.current;
    if (!engine || !materialName) return;
    try {
      engine.startMaterial();
      setMaterialPlaying(true);
      setMessage(`Playing ${materialName} through the local material processor.`);
    } catch (error) {
      setMaterialPlaying(false);
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function stopMaterial(): void {
    engineRef.current?.stopMaterial();
    setMaterialPlaying(false);
    setMessage("Imported material playback stopped; the parent buffer remains loaded locally.");
  }

  function updateMaterial(patch: Partial<MaterialControls>): void {
    const next = { ...runtimeRef.current.materialControls, ...patch };
    runtimeRef.current.materialControls = next;
    setMaterialControls(next);
    if (runtimeRef.current.materialModulationMode === "selected") {
      const signal = snapshotRef.current?.signals.find(
        (candidate) => candidate.id === runtimeRef.current.selectedSignalId
      );
      engineRef.current?.setMaterialControl(
        modulatedMaterialControls(
          next,
          signal?.normalized,
          runtimeRef.current.materialModulationDepth
        )
      );
    } else if (engineRef.current) {
      engineRef.current.setMaterialControl(next);
      engineRef.current.routeLatestControlsToMaterial(materialControlRoutes);
    }
  }

  function selectSignal(signal: ObservedSignal): void {
    runtimeRef.current.selectedSignalId = signal.id;
    setSelectedSignalId(signal.id);
    if (
      engineRef.current &&
      runtimeRef.current.materialModulationMode === "selected"
    ) {
      engineRef.current.setMaterialControl(
        modulatedMaterialControls(
          runtimeRef.current.materialControls,
          signal.normalized,
          runtimeRef.current.materialModulationDepth
        )
      );
    }
  }

  function updateMaterialModulationDepth(value: number): void {
    runtimeRef.current.materialModulationDepth = value;
    setMaterialModulationDepth(value);
    const signal = snapshotRef.current?.signals.find(
      (candidate) => candidate.id === runtimeRef.current.selectedSignalId
    );
    if (
      engineRef.current &&
      runtimeRef.current.materialModulationMode === "selected"
    ) {
      engineRef.current.setMaterialControl(
        modulatedMaterialControls(
          runtimeRef.current.materialControls,
          signal?.normalized,
          value
        )
      );
    }
  }

  function updateMaterialModulationMode(mode: MaterialModulationMode): void {
    runtimeRef.current.materialModulationMode = mode;
    setMaterialModulationMode(mode);
    const engine = engineRef.current;
    if (!engine) return;
    if (mode === "catalog") {
      engine.routeMaterialControls(engine.getControlDecisions(), materialControlRoutes);
      return;
    }
    const signal = snapshotRef.current?.signals.find(
      (candidate) => candidate.id === runtimeRef.current.selectedSignalId
    );
    engine.setMaterialControl(
      modulatedMaterialControls(
        runtimeRef.current.materialControls,
        signal?.normalized,
        runtimeRef.current.materialModulationDepth
      )
    );
  }

  function updateGeneratorEnabled(enabled: boolean): void {
    runtimeRef.current.generatorEnabled = enabled;
    setGeneratorEnabled(enabled);
  }

  function updateGeneratorRate(rate: number): void {
    runtimeRef.current.generatorRate = rate;
    runtimeRef.current.modulationDefinitions = createDefaultModulatorBank(
      generatorOriginRef.current,
      runtimeRef.current.generatorSeed,
      rate
    );
    setGeneratorRate(rate);
  }

  function updateGeneratorSeed(seed: number): void {
    runtimeRef.current.generatorSeed = seed;
    runtimeRef.current.modulationDefinitions = createDefaultModulatorBank(
      generatorOriginRef.current,
      seed,
      runtimeRef.current.generatorRate
    );
    setGeneratorSeed(seed);
  }

  function selectMidiOutput(id: string): void {
    runtimeRef.current.selectedMidiOutputId = id;
    setSelectedMidiOutputId(id);
  }

  function toggleOutput(key: keyof OutputState): void {
    const currentOutputs = runtimeRef.current.outputs;
    const armed = !currentOutputs[key];
    const next = { ...currentOutputs, [key]: armed };
    runtimeRef.current.outputs = next;
    setOutputs(next);

    if (key !== "audio") return;
    audioStartRequestRef.current += 1;
    audioStartPendingRef.current = null;
    setIsAudioStarting(false);
    materialLoadRequestRef.current += 1;
    const engine = engineRef.current;
    let status: AudioEngineStatus;
    if (engine) {
      engine.setOutputArmed(armed);
      status = armed ? engine.getStatus() : engine.stop();
    } else {
      status = {
        ...idleAudioStatus(),
        outputArmed: armed,
        state: "stopped"
      };
    }
    if (!armed) {
      setMaterialName(null);
      setMaterialPlaying(false);
    }
    setAudioStatus(status);
    setMessage(
      armed
        ? "Internal audio armed; output remains stopped until explicit Listen."
        : "Internal audio disarmed; all local audio paths were stopped."
    );
  }

  function saveSession(): void {
    if (!snapshot) return;
    const entry: SessionEntry = {
      id: makeSessionId(),
      capturedAt: new Date().toISOString(),
      title: `${snapshot.mode} · ${locality.label}`,
      snapshot
    };
    const next = [entry, ...archive].slice(0, MAX_ARCHIVE);
    setArchive(next);
    try {
      window.localStorage.setItem(ARCHIVE_KEY, JSON.stringify(next));
      setMessage("Bounded observation saved to the private browser archive.");
    } catch {
      setMessage("Observation retained for this session; browser storage is unavailable.");
    }
  }

  function loadSession(entry: SessionEntry): void {
    // Replaying reports how the record is being read; the mode it was acquired
    // in travels alongside so a replayed fixture is never later attributed to
    // a live provider.
    snapshotRequestRef.current += 1;
    audioStartRequestRef.current += 1;
    if (audioStartPendingRef.current !== null) {
      audioStartPendingRef.current = null;
      setIsAudioStarting(false);
      const engine = engineRef.current;
      if (engine && engine.getStatus().state !== "running") {
        setAudioStatus(engine.stop());
      }
    }
    snapshotAbortRef.current?.abort();
    snapshotAbortRef.current = null;
    setIsLoading(false);
    const replayed: ApiSnapshot = {
      ...entry.snapshot,
      mode: "archive",
      originMode: entry.snapshot.originMode ?? entry.snapshot.mode
    };
    snapshotRef.current = replayed;
    setSnapshot(replayed);
    const replaySelectedSignalId =
      entry.snapshot.signals.find((signal) => signal.value !== null)?.id ?? null;
    runtimeRef.current.selectedSignalId = replaySelectedSignalId;
    setSelectedSignalId(replaySelectedSignalId);
    if (engineRef.current) {
      setAudioStatus(applySignalsToEngine(engineRef.current, replayed.signals));
      setEngineControlState(engineRef.current.getControlState());
    }
    setWorkspace("observe");
    setMessage(`Archived observation loaded from ${new Date(entry.capturedAt).toLocaleString()}.`);
  }

  function removeSession(id: string): void {
    const next = archive.filter((entry) => entry.id !== id);
    setArchive(next);
    try {
      window.localStorage.setItem(ARCHIVE_KEY, JSON.stringify(next));
    } catch {
      // The in-memory archive still reflects the user's explicit removal.
    }
    setMessage("Archived observation removed from this browser.");
  }

  function exportControlFrame(): void {
    if (!snapshot) return;
    const controls = decisionsForSignals(snapshot.signals, routes).map((decision) => ({
      ...decision,
      route: routes[decision.mappingId] ?? { enabled: false, amount: 0 },
      scheduledNotHeard: true
    }));
    downloadBlob(
      `cosmoaudition-control-${Date.now()}.json`,
      "application/vnd.sonicfield.cosmo-control+json",
      JSON.stringify({ generatedAt: new Date().toISOString(), controls }, null, 2)
    );
    setMessage("Control-frame JSON downloaded. It records scheduled mappings, not audition.");
  }

  function exportTriggers(): void {
    const triggers = mergeRecentTriggers(recentTriggersRef.current, []);
    recentTriggersRef.current = triggers;
    setRecentTriggers(triggers);
    if (triggers.length === 0) {
      setMessage("No recent deduplicated stable event triggers are available.");
      return;
    }
    downloadBlob(
      `cosmoaudition-triggers-${Date.now()}.json`,
      "application/vnd.sonicfield.cosmo-trigger+json",
      JSON.stringify(
        {
          projectedAt: new Date().toISOString(),
          retention: { maxEvents: MAX_RECENT_TRIGGERS, maxAgeMinutes: 15 },
          triggerCount: triggers.length,
          triggers
        },
        null,
        2
      )
    );
    setMessage(`${triggers.length} recent deduplicated trigger records downloaded; receiver action is unverified.`);
  }

  function exportSnapshot(): void {
    if (!snapshot) return;
    downloadBlob(
      `cosmoaudition-observation-${Date.now()}.json`,
      "application/json",
      JSON.stringify(snapshot, null, 2)
    );
    setMessage("Observation JSON downloaded with source state and timestamps.");
  }

  function midiEventsForSnapshot(
    current: ApiSnapshot,
    activeRoutes: Readonly<Record<string, RouteSetting>> = runtimeRef.current.routes
  ) {
    const decisions = decisionsForSignals(current.signals, activeRoutes);
    return decisions.flatMap((decision, index) => {
      const mapping = mappingCatalog.find((candidate) => candidate.id === decision.mappingId);
      const signal = current.signals.find((candidate) => candidate.id === decision.signalId);
      if (!mapping || !signal) return [];
      const projected = projectControlDecision(
        decision,
        {
          target: decision.target,
          channel: Math.min(
            15,
            Math.max(0, sourceStrata.indexOf(stratumForSource(signal.sourceId))) * 2
          ),
          controller: 20 + (index % 100),
          sourceRange: mapping.outputRange
        },
        index * 120
      );
      return projected ? [projected.event] : [];
    });
  }

  function exportMidi(): void {
    if (!snapshot) return;
    const events = midiEventsForSnapshot(snapshot);
    if (events.length === 0) {
      setMessage("No applied control decisions are available for MIDI export.");
      return;
    }
    const bytes = createMidiFile({
      tempoBpm: 90,
      ticksPerQuarter: 480,
      tracks: [{ name: "Cosmoaudition control frames", events }]
    });
    const midiBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    downloadBlob(`cosmoaudition-control-${Date.now()}.mid`, "audio/midi", midiBuffer);
    setMessage(`${events.length} control changes downloaded as deterministic MIDI; no audition is claimed.`);
  }

  async function connectMidi(): Promise<void> {
    try {
      const access = await requestBrowserMidiAccess();
      const available = listMidiOutputs(access);
      const selected = runtimeRef.current.selectedMidiOutputId || available[0]?.id || "";
      runtimeRef.current.midiOutputs = available;
      runtimeRef.current.selectedMidiOutputId = selected;
      setMidiOutputs(available);
      setSelectedMidiOutputId(selected);
      setMessage(
        available.length > 0
          ? `${available.length} MIDI output${available.length === 1 ? "" : "s"} authorized. Transmission remains separately armed.`
          : "MIDI permission granted, but no output device is available."
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function sendSnapshotToMidi(
    current = snapshotRef.current,
    announce = true
  ): void {
    if (!current) return;
    const runtime = runtimeRef.current;
    if (!runtime.outputs.midi) {
      if (announce) setMessage("Arm MIDI output before transmission.");
      return;
    }
    const output = runtime.midiOutputs.find(
      (candidate) => candidate.id === runtime.selectedMidiOutputId
    );
    if (!output) {
      if (announce) setMessage("Authorize and select a MIDI output before transmission.");
      return;
    }
    let events: ReturnType<typeof midiEventsForSnapshot> = [];
    let sent = 0;
    try {
      events = midiEventsForSnapshot(current, runtime.routes);
      for (const event of events) {
        sendMidiControlChange(output, event);
        sent += 1;
      }
    } catch (error) {
      setMessage(
        `MIDI transmission stopped after ${sent} of ${events.length} control changes: ${error instanceof Error ? error.message : String(error)}. Device state is unknown; the observation remains accepted.`
      );
      return;
    }
    if (announce) {
      setMessage(`${events.length} MIDI control changes transmitted to ${output.name ?? output.id}; reception and audition are unverified.`);
    }
  }

  async function exportMasa(): Promise<void> {
    if (!snapshot) return;
    try {
      const response = await fetch(`${apiBaseUrl}/api/snapshot/masa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...snapshot,
          mappingRoutes: routes,
          // Carry the engine's last bounded outputs so held decisions appear
          // in the record as held, with their own status and warning.
          ...(engineRef.current
            ? { previousOutputs: engineRef.current.getControlState() }
            : {})
        })
      });
      if (!response.ok) throw new Error(`MASA export failed: HTTP ${response.status}`);
      const record = await response.text();
      downloadBlob(
        `cosmoaudition-${Date.now()}.masa.json`,
        "application/vnd.sonicfield.masa.record+json",
        record
      );
      setMessage("Validated bounded MASA record downloaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <main className="cosmo-shell" aria-labelledby="app-title">
      <a className="skip-link" href="#cosmo-workspace">
        Skip to observation workspace
      </a>

      <header className="cosmo-header">
        <div className="cosmo-brand">
          <span className="cosmo-mark" aria-hidden="true"><i /></span>
          <div>
            <p className="eyebrow">Sonic Matter Framework / local instrument</p>
            <h1 id="app-title">Cosmoaudition System</h1>
          </div>
        </div>

        <nav className="workspace-nav" aria-label="Instrument workspaces">
          {(Object.keys(workspaceLabels) as Workspace[]).map((item) => (
            <button
              key={item}
              type="button"
              className={workspace === item ? "active" : ""}
              aria-current={workspace === item ? "page" : undefined}
              onClick={() => setWorkspace(item)}
            >
              {workspaceLabels[item]}
            </button>
          ))}
        </nav>

        <div className="header-state" role="group" aria-label="Current runtime state">
          <span className={`state-dot ${snapshotMode}`} aria-hidden="true" />
          <span>{snapshotMode}</span>
          <span className="header-time">{snapshot ? formatAge(snapshot.generatedAt) : "not observed"}</span>
        </div>
      </header>

      <section className="command-rail" aria-label="Observation and audio controls">
        <div className="command-group observation-command">
          <label>
            <span>Input</span>
            <select
              value={snapshotMode}
              onChange={(event) => setSnapshotMode(event.target.value as "fixture" | "live")}
            >
              <option value="fixture">Fixture / reproducible</option>
              <option value="live">Live providers</option>
            </select>
          </label>
          <label>
            <span>Situated point</span>
            <select value={localityId} onChange={(event) => setLocalityId(event.target.value)}>
              {manualLocalityPresets.map((place) => (
                <option key={place.id} value={place.id}>{place.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Provider set</span>
            <select
              value={acquisitionScope}
              onChange={(event) => setAcquisitionScope(event.target.value as AcquisitionScope)}
            >
              {(Object.keys(acquisitionScopes) as AcquisitionScope[]).map((scope) => (
                <option key={scope} value={scope}>
                  {acquisitionScopes[scope].label} ({acquisitionScopes[scope].sourceIds.length})
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="command primary"
            disabled={isLoading}
            onClick={() => void takeObservation(snapshotMode).catch(() => undefined)}
          >
            <span aria-hidden="true">◎</span>
            {isLoading ? "Observing…" : "Take observation"}
          </button>
          <label className="switch-control">
            <input
              type="checkbox"
              checked={autoObserve}
              disabled={snapshotMode !== "live"}
              onChange={(event) => setAutoObserve(event.target.checked)}
            />
            <span>60s live cadence</span>
          </label>
        </div>

        <div className="command-group audio-command">
          <button
            type="button"
            className="command listen"
            disabled={isLoading || isAudioStarting || !outputs.audio}
            onClick={() => void startAudio()}
          >
            <span aria-hidden="true">▶</span> {isAudioStarting ? "Starting…" : "Listen"}
          </button>
          <button type="button" className="command" onClick={stopAudio}>
            <span aria-hidden="true">■</span> Stop
          </button>
          <button type="button" className="command panic" onClick={panicAudio}>
            Panic
          </button>
          <label className="master-fader">
            <span>Output</span>
            <input
              type="range"
              min="0"
              max="0.7"
              step="0.01"
              value={masterVolume}
              onChange={(event) => updateMaster(Number(event.target.value))}
            />
            <span className="control-value">{Math.round(masterVolume * 100)}%</span>
          </label>
        </div>
      </section>

      {/* tabIndex -1 so the skip link actually moves focus here rather than
          only setting the sequential-navigation start point. */}
      <div id="cosmo-workspace" className="workspace-stage" tabIndex={-1}>
        {workspace === "observe" && (
          <ObserveWorkspace
            snapshot={snapshot}
            sourceGroups={sourceGroups}
            fieldSignals={fieldSignals}
            selectedStratum={selectedStratum}
            selectedSignal={selectedSignal}
            onSelectStratum={setSelectedStratum}
            onSelectSignal={selectSignal}
          />
        )}

        {workspace === "patch" && (
          <PatchWorkspace
            snapshot={snapshot}
            routes={routes}
            previousOutputs={engineControlState}
            generatorEnabled={generatorEnabled}
            generatorRate={generatorRate}
            generatorSeed={generatorSeed}
            onGeneratorEnabled={updateGeneratorEnabled}
            onGeneratorRate={updateGeneratorRate}
            onGeneratorSeed={updateGeneratorSeed}
            onUpdateRoute={updateRoute}
          />
        )}

        {workspace === "transform" && (
          <TransformWorkspace
            selectedSignal={selectedSignal}
            audioArmed={outputs.audio}
            audioRunning={audioStatus.state === "running"}
            materialName={materialName}
            playing={materialPlaying}
            controls={materialControls}
            effectiveControls={effectiveMaterialControls}
            modulationDepth={materialModulationDepth}
            modulationMode={materialModulationMode}
            onLoad={loadMaterial}
            onPlay={playMaterial}
            onStop={stopMaterial}
            onChange={updateMaterial}
            onModulationDepth={updateMaterialModulationDepth}
            onModulationMode={updateMaterialModulationMode}
          />
        )}

        {workspace === "route" && (
          <RouteWorkspace
            snapshot={snapshot}
            outputs={outputs}
            onToggle={toggleOutput}
            onExportControl={exportControlFrame}
            onExportSnapshot={exportSnapshot}
            onExportMidi={exportMidi}
            onExportTriggers={exportTriggers}
            onExportMasa={() => void exportMasa()}
            triggerCount={recentTriggers.length}
            midiOutputs={midiOutputs}
            selectedMidiOutputId={selectedMidiOutputId}
            onSelectMidiOutput={selectMidiOutput}
            onConnectMidi={() => void connectMidi()}
            onSendMidi={() => sendSnapshotToMidi()}
          />
        )}

        {workspace === "archive" && (
          <ArchiveWorkspace
            snapshot={snapshot}
            entries={archive}
            onSave={saveSession}
            onLoad={loadSession}
            onRemove={removeSession}
          />
        )}
      </div>

      <footer className="system-rail">
        <div className="system-message" role="status" aria-live="polite">
          <span className="system-pulse" aria-hidden="true" />
          <span>{message}</span>
        </div>
        <div className="index-miniatures" role="group" aria-label="Derived index states">
          {indices.slice(0, 5).map((index) => (
            <span key={index.id} title={index.notes}>
              <b>{index.id}</b>
              <i style={{ "--level": index.normalized ?? 0 } as CSSProperties} />
              <em>{index.normalized === null ? "—" : index.normalized.toFixed(2)}</em>
            </span>
          ))}
        </div>
        <div className="armed-outputs">
          <span>{outputSummary(outputs)}</span>
          <b>{audioStatus.state}</b>
        </div>
      </footer>

      <nav className="mobile-nav" aria-label="Mobile instrument workspaces">
        {(Object.keys(workspaceLabels) as Workspace[]).map((item) => (
          <button
            key={item}
            type="button"
            className={workspace === item ? "active" : ""}
            aria-current={workspace === item ? "page" : undefined}
            onClick={() => setWorkspace(item)}
          >
            <span aria-hidden="true">
              {item === "observe" ? "◎" : item === "patch" ? "⌁" : item === "transform" ? "≋" : item === "route" ? "⇥" : "▤"}
            </span>
            {workspaceLabels[item]}
          </button>
        ))}
      </nav>
    </main>
  );
}

function ObserveWorkspace(props: {
  snapshot: ApiSnapshot | null;
  sourceGroups: SourceGroup[];
  fieldSignals: ObservedSignal[];
  selectedStratum: SourceStratum | "all";
  selectedSignal: ObservedSignal | null;
  onSelectStratum: (stratum: SourceStratum | "all") => void;
  onSelectSignal: (signal: ObservedSignal) => void;
}) {
  return (
    <div className="observe-layout">
      <aside className="source-strata" aria-labelledby="strata-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Observation aperture</p>
            <h2 id="strata-title">Source strata</h2>
          </div>
          <button
            type="button"
            className={props.selectedStratum === "all" ? "text-action active" : "text-action"}
            onClick={() => props.onSelectStratum("all")}
          >
            All
          </button>
        </div>

        <div className="strata-list">
          {props.sourceGroups.map((group, index) => (
            <button
              key={group.stratum}
              type="button"
              className={props.selectedStratum === group.stratum ? "stratum active" : "stratum"}
              onClick={() => props.onSelectStratum(group.stratum)}
            >
              <span className="stratum-index">0{index + 1}</span>
              <span className="stratum-copy">
                <strong>{sourceStratumLabels[group.stratum]}</strong>
                <small>{group.sourceIds.length} sources · {group.readyCount} values</small>
              </span>
              <span
                className={`health-mark ${group.readyCount > 0 ? "ready" : "absent"}`}
                aria-label={group.readyCount > 0 ? "observations available" : "no observation"}
              />
            </button>
          ))}
        </div>

        <div className="coverage-note">
          <span aria-hidden="true">⊘</span>
          <p>
            These feeds are situated apertures. Their coexistence does not make a complete
            planet or a universal cosmos.
          </p>
        </div>
      </aside>

      <section className="orbital-panel" aria-labelledby="field-title">
        <div className="panel-heading field-heading">
          <div>
            <p className="eyebrow">Relational time field</p>
            <h2 id="field-title">Current observation</h2>
          </div>
          <div className="field-time">
            <strong>{props.snapshot ? new Date(props.snapshot.generatedAt).toLocaleTimeString() : "—"}</strong>
            <span>{props.snapshot?.mode ?? "offline"}</span>
          </div>
        </div>

        <div className="orbital-field" data-testid="orbital-field">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="orbit orbit-three" />
          <div className="axis axis-x" />
          <div className="axis axis-y" />
          <div className="field-center">
            <span>{props.fieldSignals.length}</span>
            <small>visible signals</small>
          </div>
          {props.fieldSignals.map((signal, index) => {
            const ring = index % 3;
            const radius = [23, 34, 44][ring] ?? 34;
            const angle = (index / Math.max(1, props.fieldSignals.length)) * Math.PI * 2 - Math.PI / 2;
            const left = 50 + Math.cos(angle) * radius;
            const top = 50 + Math.sin(angle) * radius * 0.72;
            const kind = evidenceForSignal(signal);
            const selected = props.selectedSignal?.id === signal.id;
            return (
              <button
                key={`${signal.sourceId}:${signal.id}`}
                type="button"
                className={`signal-node ${kind} ${selected ? "selected" : ""}`}
                style={{ left: `${left}%`, top: `${top}%` }}
                aria-pressed={selected}
                aria-label={`${signal.label}: ${formatValue(signal.value, signal.unit)}, ${kind}`}
                onClick={() => props.onSelectSignal(signal)}
              >
                <span>{epistemicMarks[kind]}</span>
              </button>
            );
          })}
          {!props.snapshot && (
            <div className="field-empty">
              <strong>No observation loaded</strong>
              <span>Take a fixture observation to establish a reproducible field.</span>
            </div>
          )}
        </div>

        <div className="field-legend" role="group" aria-label="Evidence legend">
          {(["measured", "forecast", "event", "aggregate", "inferred", "unknown"] as EvidenceKind[]).map((kind) => (
            <span key={kind}><b>{epistemicMarks[kind]}</b>{kind}</span>
          ))}
        </div>
      </section>

      <SignalAccount signal={props.selectedSignal} snapshot={props.snapshot} />
    </div>
  );
}

function SignalAccount({ signal, snapshot }: { signal: ObservedSignal | null; snapshot: ApiSnapshot | null }) {
  const health = signal
    ? snapshot?.sources.find((source) => source.sourceId === signal.sourceId)
    : undefined;
  const mappings = signal
    ? mappingCatalog.filter((mapping) => mapping.signalId === signal.id)
    : [];
  const kind = signal ? evidenceForSignal(signal) : "unknown";

  return (
    <aside className="signal-account" aria-labelledby="signal-account-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Selected account</p>
          <h2 id="signal-account-title">Signal</h2>
        </div>
        <span className={`evidence-badge ${kind}`}>{epistemicMarks[kind]} {kind}</span>
      </div>

      {signal ? (
        <>
          <div className="signal-primary">
            <span>{sourceStratumLabels[stratumForSource(signal.sourceId)]}</span>
            <h3>{signal.label}</h3>
            <strong>{formatValue(signal.value, signal.unit)}</strong>
            <div className="normalization-meter" role="img" aria-label={`Normalized value ${signal.normalized ?? "unknown"}`}>
              <i style={{ width: `${Math.round((signal.normalized ?? 0) * 100)}%` }} />
            </div>
            <small>normalized {signal.normalized === null ? "—" : signal.normalized.toFixed(4)}</small>
          </div>

          <dl className="signal-facts">
            <div><dt>Provider field</dt><dd>{signal.sourceId} / {signal.id}</dd></div>
            <div><dt>Observed</dt><dd>{formatAge(signal.timestamp)}</dd></div>
            <div><dt>Fetched</dt><dd>{formatAge(health?.fetchedAt)}</dd></div>
            <div><dt>Health</dt><dd>{health?.status ?? "local"} / {signal.confidence}</dd></div>
            <div><dt>Stale after</dt><dd>{signal.staleAfterSeconds}s</dd></div>
          </dl>

          <div className="mapping-account">
            <p className="eyebrow">Authored transduction</p>
            {mappings.length > 0 ? mappings.map((mapping) => (
              <div key={mapping.id}>
                <strong>{mapping.target}</strong>
                <span>{mapping.scale} · {mapping.smoothingMs}ms smoothing</span>
                <small>{mapping.outputRange[0]} → {mapping.outputRange[1]}</small>
              </div>
            )) : <p>No active mapping. The observation remains inspectable.</p>}
          </div>

          <p className="epistemic-note">
            {mappings[0]?.epistemicNote ?? signal.notes ?? "No interpretive equivalence is asserted."}
          </p>
        </>
      ) : (
        <div className="account-empty">
          <span aria-hidden="true">○</span>
          <p>Select a node after taking an observation. Unknown values remain available as unknown state.</p>
        </div>
      )}
    </aside>
  );
}

function PatchWorkspace(props: {
  snapshot: ApiSnapshot | null;
  routes: Readonly<Record<string, RouteSetting>>;
  /**
   * The engine's last bounded output per mapping. Without it this inspector
   * recomputes every `hold-explicitly` mapping as `skipped` while the engine
   * reports `held`, which is the opposite of what this workspace is for.
   */
  previousOutputs: Readonly<Record<string, number>>;
  generatorEnabled: boolean;
  generatorRate: number;
  generatorSeed: number;
  onGeneratorEnabled: (enabled: boolean) => void;
  onGeneratorRate: (value: number) => void;
  onGeneratorSeed: (value: number) => void;
  onUpdateRoute: (mapping: SonicMapping, patch: Partial<RouteSetting>) => void;
}) {
  return (
    <section className="wide-workspace" aria-labelledby="patch-title">
      <div className="workspace-intro">
        <div>
          <p className="eyebrow">Executable relation</p>
          <h2 id="patch-title">Patch observations into control</h2>
        </div>
        <p>
          A route changes an engine parameter; it does not disclose an intrinsic sonic property of its source.
          Disabled, missing, and stale routes remain explicit decisions.
        </p>
      </div>

      <div className="causal-chain" role="group" aria-label="Causal patch chain">
        {[
          ["01", "Observation", "provider field"],
          ["02", "Feature", "window + unit"],
          ["03", "Control signal", "curve + smoothing"],
          ["04", "Processor", "named parameter"],
          ["05", "Output", "scheduled, not heard"]
        ].map(([number, title, note], index) => (
          <div key={number} className="chain-step">
            <span>{number}</span><strong>{title}</strong><small>{note}</small>
            {index < 4 && <i aria-hidden="true">→</i>}
          </div>
        ))}
      </div>

      <section className="generator-bank" aria-labelledby="generator-bank-title">
        <div className="generator-intro">
          <p className="eyebrow">Internal signal generator</p>
          <h3 id="generator-bank-title">Deterministic modulation bank</h3>
          <p>
            Clock, pulse, LFO, envelope, and sample-and-hold are computed locally from an explicit origin and seed. They never fill a missing provider value.
          </p>
        </div>
        <label className="switch-control">
          <input
            type="checkbox"
            checked={props.generatorEnabled}
            onChange={(event) => props.onGeneratorEnabled(event.target.checked)}
          />
          <span>{props.generatorEnabled ? "running" : "stopped"}</span>
        </label>
        <label>
          <span>Rate multiplier</span>
          <input
            type="range"
            min="0.05"
            max="8"
            step="0.05"
            value={props.generatorRate}
            onChange={(event) => props.onGeneratorRate(Number(event.target.value))}
          />
          <strong>{props.generatorRate.toFixed(2)}×</strong>
        </label>
        <label>
          <span>Integer seed</span>
          <input
            type="number"
            min="0"
            max="2147483647"
            step="1"
            value={props.generatorSeed}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isInteger(value) && value >= 0 && value <= 2147483647) {
                props.onGeneratorSeed(value);
              }
            }}
          />
        </label>
        <div className="generator-readout" role="group" aria-label="Current generator values">
          {(props.snapshot?.signals ?? [])
            .filter((signal) => signal.sourceId === "local_modulation_bank")
            .map((signal) => (
              <span key={signal.id}>
                <small>{signal.label}</small>
                <strong>{signal.value?.toFixed(3) ?? "—"}</strong>
              </span>
            ))}
        </div>
      </section>

      <div className="patch-list">
        <div className="patch-list-head">
          <span>Route</span><span>Observation</span><span>Decision</span><span>Amount</span><span>Destination</span>
        </div>
        {mappingCatalog.map((mapping) => {
          const signal = props.snapshot?.signals.find((candidate) => candidate.id === mapping.signalId);
          const route = props.routes[mapping.id] ?? { enabled: true, amount: 1 };
          const previousOutput = props.previousOutputs[mapping.id];
          const decision = executeMapping(mapping, signal, {
            enabled: route.enabled,
            amount: route.amount,
            ...(previousOutput === undefined ? {} : { previousOutput })
          });
          return (
            <article key={mapping.id} className={`patch-row ${route.enabled ? "enabled" : "disabled"}`}>
              <label className="route-toggle">
                <input
                  type="checkbox"
                  checked={route.enabled}
                  onChange={(event) => props.onUpdateRoute(mapping, { enabled: event.target.checked })}
                />
                <span>{mapping.id}</span>
              </label>
              <div><strong>{signal?.label ?? mapping.signalId}</strong><small>{signal ? formatValue(signal.value, signal.unit) : "not observed"}</small></div>
              <div><span className={`decision ${decision.status}`}>{decision.status}</span><small>{decision.reason} · {mapping.scale} / {mapping.smoothingMs}ms</small></div>
              <label className="amount-control">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={route.amount}
                  disabled={!route.enabled}
                  aria-label={`${mapping.id} amount`}
                  onChange={(event) => props.onUpdateRoute(mapping, { amount: Number(event.target.value) })}
                />
                <span className="control-value">{route.amount.toFixed(2)}</span>
              </label>
              <div className="destination"><strong>{mapping.target}</strong><small>{mapping.outputRange[0]} → {mapping.outputRange[1]}</small></div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function TransformWorkspace(props: {
  selectedSignal: ObservedSignal | null;
  audioArmed: boolean;
  audioRunning: boolean;
  materialName: string | null;
  playing: boolean;
  controls: MaterialControls;
  effectiveControls: MaterialControls;
  modulationDepth: number;
  modulationMode: MaterialModulationMode;
  onLoad: (event: ChangeEvent<HTMLInputElement>) => void;
  onPlay: () => void;
  onStop: () => void;
  onChange: (patch: Partial<MaterialControls>) => void;
  onModulationDepth: (value: number) => void;
  onModulationMode: (mode: MaterialModulationMode) => void;
}) {
  return (
    <section className="wide-workspace transform-workspace" aria-labelledby="transform-title">
      <div className="workspace-intro">
        <div>
          <p className="eyebrow">Sonic parent + situated control</p>
          <h2 id="transform-title">Transform imported matter</h2>
        </div>
        <p>
          The imported file stays local and remains the parent. Live processing is a performance state; it becomes a derivative only when explicitly recorded or exported.
        </p>
      </div>

      <div className="transform-grid">
        <aside className="material-loader">
          <p className="eyebrow">Parent representation</p>
          <div className="material-well">
            <span aria-hidden="true">≋</span>
            <strong>{props.materialName ?? "No material loaded"}</strong>
            <small>WAV, AIFF, MP3, FLAC, or browser-decodable audio</small>
            <label className="file-command">
              <input
                type="file"
                accept="audio/*"
                disabled={!props.audioArmed || !props.audioRunning}
                onChange={props.onLoad}
              />
              Choose local sound
            </label>
          </div>
          <div className="material-transport">
            <button type="button" disabled={!props.audioArmed || !props.audioRunning || !props.materialName || props.playing} onClick={props.onPlay}>▶ Play loop</button>
            <button type="button" disabled={!props.playing} onClick={props.onStop}>■ Stop material</button>
          </div>
          <p className="privacy-line">Private by default · bytes stay in this browser session</p>
        </aside>

        <div className="material-field">
          <div className="material-field-head">
            <div>
              <p className="eyebrow">Morphological control surface</p>
              <h3>{props.selectedSignal?.label ?? "Select an observation in Observe"}</h3>
            </div>
            <span>{props.selectedSignal ? formatValue(props.selectedSignal.value, props.selectedSignal.unit) : "unmapped"}</span>
          </div>
          <div className="material-visual" role="img" aria-label="Processor control surface, not a measured spectrogram">
            {Array.from({ length: 26 }, (_, index) => (
              <i
                key={index}
                style={{
                  height: `${18 + ((index * 17 + Math.round(props.controls.cutoffHz / 100)) % 74)}%`,
                  opacity: 0.18 + (index % 5) * 0.12
                }}
              />
            ))}
            <div className="material-window" style={{ width: `${35 + props.controls.delayMix * 45}%` }} />
          </div>
          <p className="visual-caveat">Processor control surface — not a measured sonogram.</p>
          <div className="processor-chain">
            <span>buffer source</span><b>→</b><span>rate</span><b>→</b><span>resonant filter</span><b>→</b><span>feedback delay</span><b>→</b><span>safe master</span>
          </div>
        </div>

        <aside className="processor-controls">
          <p className="eyebrow">Material operations</p>
          <label className="modulation-mode">
            <span>Control account</span>
            <select
              value={props.modulationMode}
              onChange={(event) => props.onModulationMode(event.target.value as MaterialModulationMode)}
            >
              <option value="catalog">Catalog routes / MASA mappings</option>
              <option value="selected">Selected signal / live performance</option>
            </select>
          </label>
          <MaterialControl label="Filter cutoff" value={props.controls.cutoffHz} min={120} max={12000} step={1} unit="Hz" onChange={(value) => props.onChange({ cutoffHz: value })} />
          <MaterialControl label="Filter resonance" value={props.controls.filterQ} min={0.1} max={18} step={0.1} unit="Q" onChange={(value) => props.onChange({ filterQ: value })} />
          <MaterialControl label="Playback rate" value={props.controls.playbackRate} min={0.25} max={2} step={0.01} unit="×" onChange={(value) => props.onChange({ playbackRate: value })} />
          <MaterialControl label="Delay field" value={props.controls.delayMix} min={0} max={0.7} step={0.01} unit="mix" onChange={(value) => props.onChange({ delayMix: value })} />
          <MaterialControl label="Delay time" value={props.controls.delayTimeSeconds} min={0.01} max={1.8} step={0.01} unit="s" onChange={(value) => props.onChange({ delayTimeSeconds: value })} />
          <MaterialControl label="Delay feedback" value={props.controls.delayFeedback} min={0} max={0.82} step={0.01} unit="ratio" onChange={(value) => props.onChange({ delayFeedback: value })} />
          <MaterialControl label="Material gain" value={props.controls.gain} min={0} max={0.5} step={0.01} unit="gain" onChange={(value) => props.onChange({ gain: value })} />
          <MaterialControl label="Observation depth" value={props.modulationDepth} min={0} max={1} step={0.01} unit="mix" onChange={props.onModulationDepth} />
          <div className="transform-account">
            <span>Operation</span><strong>matter.transform / live</strong>
            <span>Derivative</span><strong>not recorded</strong>
            <span>Control source</span><strong>{props.selectedSignal?.id ?? "none"}</strong>
            <span>Control mode</span><strong>{props.modulationMode}</strong>
            <span>Effective cutoff</span><strong>{props.effectiveControls.cutoffHz.toFixed(0)} Hz</strong>
            <span>Effective rate</span><strong>{props.effectiveControls.playbackRate.toFixed(3)} ×</strong>
          </div>
        </aside>
      </div>
    </section>
  );
}

function MaterialControl(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="material-control">
      <span>{props.label}</span>
      <strong>{props.value.toFixed(props.step < 1 ? 2 : 0)} {props.unit}</strong>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
    </label>
  );
}

function RouteWorkspace(props: {
  snapshot: ApiSnapshot | null;
  outputs: OutputState;
  onToggle: (key: keyof OutputState) => void;
  onExportControl: () => void;
  onExportSnapshot: () => void;
  onExportMidi: () => void;
  onExportTriggers: () => void;
  onExportMasa: () => void;
  triggerCount: number;
  midiOutputs: MidiOutputLike[];
  selectedMidiOutputId: string;
  onSelectMidiOutput: (id: string) => void;
  onConnectMidi: () => void;
  onSendMidi: () => void;
}) {
  const outputCopy: Record<keyof OutputState, [string, string, string]> = {
    audio: ["Internal audio", "Safe Web Audio field and material processor", "scheduled locally"],
    midi: ["MIDI", "Deterministic file or explicitly authorized device", "optional projection"],
    triggers: ["Trigger stream", "Deduplicated event pulses with source IDs", "event only"],
    controls: ["Control frames", "Normalized values, mappings, decisions, targets", "JSON"],
    masa: ["MASA account", "Bounded record, receipts, policies, lineage", "validated export"]
  };

  return (
    <section className="wide-workspace route-workspace" aria-labelledby="route-title">
      <div className="workspace-intro">
        <div>
          <p className="eyebrow">External consequence</p>
          <h2 id="route-title">Route signals and accounts</h2>
        </div>
        <p>
          Outputs are armed independently. A scheduled, downloaded, or transmitted value is not evidence that another system received it or that anyone heard it.
        </p>
      </div>

      <div className="output-grid">
        {(Object.keys(props.outputs) as (keyof OutputState)[]).map((key, index) => {
          const [title, description, state] = outputCopy[key];
          return (
            <article key={key} className={props.outputs[key] ? "output-card armed" : "output-card"}>
              <span className="output-number">0{index + 1}</span>
              <div><h3>{title}</h3><p>{description}</p></div>
              <button
                type="button"
                role="switch"
                aria-checked={props.outputs[key]}
                aria-label={`${title} output`}
                className="output-switch"
                onClick={() => props.onToggle(key)}
              >
                <i />{props.outputs[key] ? "armed" : "off"}
              </button>
              <small>{state}</small>
            </article>
          );
        })}
      </div>

      <div className="export-console">
        <div>
          <p className="eyebrow">Bounded exports</p>
          <h3>{props.snapshot ? `${props.snapshot.signals.length} observations ready` : "Take an observation first"}</h3>
          <p>Exports retain unknowns, units, timestamps, mapping decisions, and the distinction between fixture and live acquisition.</p>
        </div>
        <div className="export-actions">
          <button type="button" disabled={!props.snapshot} onClick={props.onExportSnapshot}>Observation JSON</button>
          <button type="button" disabled={!props.snapshot || !props.outputs.controls} onClick={props.onExportControl}>Control frames</button>
          <button type="button" disabled={!props.snapshot || !props.outputs.triggers || props.triggerCount === 0} onClick={props.onExportTriggers}>Triggers ({props.triggerCount})</button>
          <button type="button" disabled={!props.snapshot || !props.outputs.midi} onClick={props.onExportMidi}>MIDI file</button>
          <button type="button" className="primary" disabled={!props.snapshot || !props.outputs.masa} onClick={props.onExportMasa}>MASA record</button>
        </div>
      </div>

      <div className="midi-console" role="group" aria-label="Authorized live MIDI output">
        <div>
          <p className="eyebrow">Opt-in live MIDI</p>
          <p>Device permission is requested only after the button below is pressed. Continuous controls are transmitted; no device response or audition is inferred.</p>
        </div>
        <button type="button" disabled={!props.outputs.midi} onClick={props.onConnectMidi}>Authorize MIDI devices</button>
        <label>
          <span>Destination</span>
          <select
            value={props.selectedMidiOutputId}
            disabled={props.midiOutputs.length === 0}
            onChange={(event) => props.onSelectMidiOutput(event.target.value)}
          >
            {props.midiOutputs.length === 0 && <option value="">No authorized output</option>}
            {props.midiOutputs.map((output) => <option key={output.id} value={output.id}>{output.name ?? output.id}</option>)}
          </select>
        </label>
        <button type="button" disabled={!props.snapshot || !props.selectedMidiOutputId || !props.outputs.midi} onClick={props.onSendMidi}>Transmit current frame</button>
      </div>
    </section>
  );
}

function ArchiveWorkspace(props: {
  snapshot: ApiSnapshot | null;
  entries: SessionEntry[];
  onSave: () => void;
  onLoad: (entry: SessionEntry) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <section className="wide-workspace archive-workspace" aria-labelledby="archive-title">
      <div className="workspace-intro">
        <div>
          <p className="eyebrow">Local memory</p>
          <h2 id="archive-title">Bounded observations</h2>
        </div>
        <div className="archive-command">
          <span>{props.entries.length} / {MAX_ARCHIVE} private records</span>
          <button type="button" className="primary" disabled={!props.snapshot} onClick={props.onSave}>Save current observation</button>
        </div>
      </div>

      <div className="archive-ledger">
        {props.entries.length === 0 ? (
          <div className="archive-empty"><span>▤</span><strong>No observations archived</strong><p>Saving creates a browser-local replay entry; it does not publish or upload data.</p></div>
        ) : props.entries.map((entry, index) => (
          <article key={entry.id} className="archive-entry">
            <span className="archive-sequence">{String(index + 1).padStart(2, "0")}</span>
            <div><strong>{entry.title}</strong><small>{new Date(entry.capturedAt).toLocaleString()}</small></div>
            <div><strong>{entry.snapshot.signals.length}</strong><small>signals</small></div>
            <div><strong>{entry.snapshot.sources.length}</strong><small>sources</small></div>
            <div className="archive-actions"><button type="button" onClick={() => props.onLoad(entry)}>Load</button><button type="button" onClick={() => props.onRemove(entry.id)}>Remove</button></div>
          </article>
        ))}
      </div>

      <div className="archive-policy">
        <span aria-hidden="true">⊙</span>
        <div><strong>Private by default</strong><p>Browser storage can be cleared at any time. Public projection, redaction, and bundle publication are separate operations.</p></div>
      </div>
    </section>
  );
}
