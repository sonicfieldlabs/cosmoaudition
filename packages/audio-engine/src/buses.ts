import type { StackLayer } from "@cosmoaudition/core";
import { clamp01 } from "@cosmoaudition/core";
import { safeParamRamp } from "./params";

export const stackLayers: readonly StackLayer[] = [
  "earth",
  "cloud",
  "city",
  "address",
  "interface",
  "user"
] as const;

// Default master volume, shared by the engine and the UI so the displayed value
// and the audible value never drift apart.
export const DEFAULT_MASTER_VOLUME = 0.38;

// Safety ceiling: even at master "100%" the output gain stays below unity so a
// dense mix cannot slam the limiter or reach unsafe listening levels.
export const MASTER_OUTPUT_HEADROOM = 0.7;

// Static stereo placement per layer turns the mixer into an actual field rather
// than a mono sum. Earth stays centred (the ground under everything); the other
// layers spread around it.
const layerPan: Record<StackLayer, number> = {
  earth: 0,
  cloud: -0.4,
  city: 0.45,
  address: 0.15,
  interface: -0.6,
  user: 0.3
};

// Each derived index biases the timbre of its own layer at the bus level, so the
// index gives the whole layer a character without touching any module internals
// or any gain. earth: BNI closes a lowpass (spectrum reduction / loss). cloud &
// city: CTI / LPI lift a high shelf (thermal-metallic / mechanical presence).
type CharacterMode = "lowpass" | "highshelf" | "neutral";

const layerCharacterMode: Record<StackLayer, CharacterMode> = {
  earth: "lowpass",
  cloud: "highshelf",
  city: "highshelf",
  address: "neutral",
  interface: "neutral",
  user: "neutral"
};

const LOWPASS_OPEN_HZ = 18000;
const LOWPASS_CLOSED_HZ = 700;
const HIGHSHELF_HZ = 3200;
const HIGHSHELF_MAX_DB = 6;

function configureCharacterFilter(
  filter: BiquadFilterNode,
  mode: CharacterMode
): void {
  if (mode === "lowpass") {
    filter.type = "lowpass";
    filter.frequency.value = LOWPASS_OPEN_HZ;
    filter.Q.value = 0.6;
  } else if (mode === "highshelf") {
    filter.type = "highshelf";
    filter.frequency.value = HIGHSHELF_HZ;
    filter.gain.value = 0;
  } else {
    // A single allpass biquad is magnitude-flat: audibly transparent, so the
    // chain stays uniform for layers no index drives.
    filter.type = "allpass";
  }
}

export interface MasterBus {
  input: GainNode;
  highpass: BiquadFilterNode;
  limiter: DynamicsCompressorNode;
  analyser: AnalyserNode;
  output: GainNode;
  setVolume(value: number): void;
}

export interface LayerBus {
  layer: StackLayer;
  input: GainNode;
  gain: GainNode;
  character: BiquadFilterNode;
  panner: StereoPannerNode;
  analyser: AnalyserNode;
  volume: number;
  muted: boolean;
  setVolume(value: number): void;
  setMuted(muted: boolean): void;
  // Bias the layer timbre from its derived index (0..1). Neutral layers ignore it.
  setCharacter(value: number): void;
  level(): number;
}

export function createMasterBus(context: AudioContext): MasterBus {
  const input = context.createGain();
  const highpass = context.createBiquadFilter();
  const limiter = context.createDynamicsCompressor();
  const analyser = context.createAnalyser();
  const output = context.createGain();

  input.gain.value = 1;
  // Clear sub-sonic energy and DC offset from the 42-55 Hz sub modules before
  // the limiter so they do not eat headroom or stress speakers inaudibly.
  highpass.type = "highpass";
  highpass.frequency.value = 24;
  highpass.Q.value = 0.7;
  limiter.threshold.value = -18;
  limiter.knee.value = 9;
  limiter.ratio.value = 16;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.18;
  analyser.fftSize = 1024;
  output.gain.value = DEFAULT_MASTER_VOLUME * MASTER_OUTPUT_HEADROOM;

  input.connect(highpass);
  highpass.connect(limiter);
  limiter.connect(analyser);
  analyser.connect(output);
  output.connect(context.destination);

  return {
    input,
    highpass,
    limiter,
    analyser,
    output,
    setVolume(value: number) {
      safeParamRamp(
        output.gain,
        clamp01(value) * MASTER_OUTPUT_HEADROOM,
        context.currentTime,
        80
      );
    }
  };
}

export function createLayerBus(
  context: AudioContext,
  layer: StackLayer,
  masterInput: AudioNode
): LayerBus {
  const input = context.createGain();
  const gain = context.createGain();
  const character = context.createBiquadFilter();
  const panner = context.createStereoPanner();
  const analyser = context.createAnalyser();
  const characterMode = layerCharacterMode[layer];

  analyser.fftSize = 512;
  const levelData = new Uint8Array(analyser.fftSize);
  gain.gain.value = 0.55;
  configureCharacterFilter(character, characterMode);
  panner.pan.value = layerPan[layer];
  input.connect(gain);
  gain.connect(character);
  character.connect(panner);
  panner.connect(analyser);
  analyser.connect(masterInput);

  const bus: LayerBus = {
    layer,
    input,
    gain,
    character,
    panner,
    analyser,
    volume: 0.55,
    muted: false,
    setVolume(value: number) {
      bus.volume = clamp01(value);
      updateLayerGain(context, bus);
    },
    setMuted(muted: boolean) {
      bus.muted = muted;
      updateLayerGain(context, bus);
    },
    setCharacter(value: number) {
      const amount = clamp01(value);
      if (characterMode === "lowpass") {
        // Higher index -> lower cutoff -> spectrum closes (BNI).
        const cutoff =
          LOWPASS_OPEN_HZ * Math.pow(LOWPASS_CLOSED_HZ / LOWPASS_OPEN_HZ, amount);
        safeParamRamp(character.frequency, cutoff, context.currentTime, 600);
      } else if (characterMode === "highshelf") {
        // Higher index -> brighter shelf (CTI thermal, LPI mechanical presence).
        safeParamRamp(character.gain, amount * HIGHSHELF_MAX_DB, context.currentTime, 600);
      }
    },
    level() {
      return readAnalyserLevel(analyser, levelData);
    }
  };

  return bus;
}

function updateLayerGain(context: AudioContext, bus: LayerBus): void {
  safeParamRamp(bus.gain.gain, bus.muted ? 0 : bus.volume, context.currentTime, 80);
}

// RMS of the time-domain buffer, lightly scaled so quiet-but-present layers
// still register on a meter. Reuses a scratch buffer to avoid per-frame churn.
function readAnalyserLevel(
  analyser: AnalyserNode,
  scratch: Uint8Array<ArrayBuffer>
): number {
  analyser.getByteTimeDomainData(scratch);

  let sumSquares = 0;
  for (let index = 0; index < scratch.length; index += 1) {
    const centered = ((scratch[index] ?? 128) - 128) / 128;
    sumSquares += centered * centered;
  }

  const rms = Math.sqrt(sumSquares / scratch.length);
  return clamp01(rms * 3.2);
}
