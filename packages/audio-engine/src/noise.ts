// A single white-noise buffer is shared across every noise-based module instead
// of each module allocating its own 2-second buffer. At 48 kHz that is one
// ~384 KB buffer rather than four or five, and the buffer is reused for the life
// of the AudioContext.

const noiseBuffers = new WeakMap<BaseAudioContext, Map<number, AudioBuffer>>();

function getNoiseBuffer(
  context: BaseAudioContext,
  seconds = 2
): AudioBuffer {
  const lengthSamples = Math.max(1, Math.floor(context.sampleRate * seconds));
  let byLength = noiseBuffers.get(context);
  if (!byLength) {
    byLength = new Map();
    noiseBuffers.set(context, byLength);
  }
  const cached = byLength.get(lengthSamples);
  if (cached) {
    return cached;
  }

  const buffer = context.createBuffer(1, lengthSamples, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = Math.random() * 2 - 1;
  }

  byLength.set(lengthSamples, buffer);
  return buffer;
}

/**
 * Create a looping noise source that reads the shared buffer. Each source gets a
 * slightly detuned playback rate so that modules sharing one buffer drift apart
 * instead of phase-locking into an audible correlated hiss. The caller still
 * owns connecting and starting the node.
 */
export function createNoiseSource(
  context: AudioContext,
  seconds = 2
): AudioBufferSourceNode {
  const source = context.createBufferSource();
  source.buffer = getNoiseBuffer(context, seconds);
  source.loop = true;
  source.playbackRate.value = 0.97 + Math.random() * 0.06;
  return source;
}
