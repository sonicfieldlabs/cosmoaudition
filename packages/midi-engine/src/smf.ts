export interface MidiNoteEvent {
  type: "note";
  tick: number;
  durationTicks: number;
  channel: number;
  note: number;
  velocity: number;
}

export interface MidiControlChangeEvent {
  type: "control-change";
  tick: number;
  channel: number;
  controller: number;
  value: number;
}

export interface MidiPitchBendEvent {
  type: "pitch-bend";
  tick: number;
  channel: number;
  /** Signed MIDI pitch bend value in the -8192..8191 range. */
  value: number;
}

export interface MidiProgramChangeEvent {
  type: "program-change";
  tick: number;
  channel: number;
  program: number;
}

export type MidiEvent =
  | MidiNoteEvent
  | MidiControlChangeEvent
  | MidiPitchBendEvent
  | MidiProgramChangeEvent;

export interface MidiTrackDefinition {
  name: string;
  events: readonly MidiEvent[];
}

export interface CreateMidiFileOptions {
  tracks: readonly MidiTrackDefinition[];
  tempoBpm?: number;
  ticksPerQuarter?: number;
}

interface EncodedEvent {
  tick: number;
  order: number;
  sequence: number;
  bytes: readonly number[];
}

const textEncoder = new TextEncoder();
const MAX_TICK = 0x0fffffff;

function assertIntegerInRange(
  value: number,
  min: number,
  max: number,
  label: string
): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} must be an integer in ${min}..${max}.`);
  }
}

function encodeUint16(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function encodeUint32(value: number): number[] {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff
  ];
}

export function encodeVariableLength(value: number): number[] {
  assertIntegerInRange(value, 0, MAX_TICK, "MIDI delta time");

  let buffer = value & 0x7f;
  const bytes: number[] = [];
  while ((value >>>= 7) > 0) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }

  while (true) {
    bytes.push(buffer & 0xff);
    if ((buffer & 0x80) === 0) {
      break;
    }
    buffer >>>= 8;
  }

  return bytes;
}

function metaText(type: number, text: string): number[] {
  const encoded = [...textEncoder.encode(text)];
  return [0xff, type, ...encodeVariableLength(encoded.length), ...encoded];
}

function chunk(id: string, payload: readonly number[]): number[] {
  const idBytes = [...textEncoder.encode(id)];
  if (idBytes.length !== 4) {
    throw new Error("MIDI chunk ids must contain four ASCII bytes.");
  }
  return [...idBytes, ...encodeUint32(payload.length), ...payload];
}

function validateEvent(event: MidiEvent): void {
  assertIntegerInRange(event.tick, 0, MAX_TICK, "MIDI event tick");
  assertIntegerInRange(event.channel, 0, 15, "MIDI channel");

  switch (event.type) {
    case "note":
      assertIntegerInRange(event.durationTicks, 1, MAX_TICK, "MIDI note duration");
      if (event.tick + event.durationTicks > MAX_TICK) {
        throw new RangeError(`MIDI note end must not exceed ${MAX_TICK}.`);
      }
      assertIntegerInRange(event.note, 0, 127, "MIDI note");
      assertIntegerInRange(event.velocity, 1, 127, "MIDI note velocity");
      break;
    case "control-change":
      assertIntegerInRange(event.controller, 0, 127, "MIDI controller");
      assertIntegerInRange(event.value, 0, 127, "MIDI controller value");
      break;
    case "pitch-bend":
      assertIntegerInRange(event.value, -8192, 8191, "MIDI pitch bend");
      break;
    case "program-change":
      assertIntegerInRange(event.program, 0, 127, "MIDI program");
      break;
  }
}

function encodeTrack(track: MidiTrackDefinition): number[] {
  if (track.name.trim().length === 0) {
    throw new RangeError("MIDI track name must not be empty.");
  }

  const events: EncodedEvent[] = [
    { tick: 0, order: 0, sequence: -1, bytes: metaText(0x03, track.name) }
  ];

  track.events.forEach((event, sequence) => {
    validateEvent(event);
    switch (event.type) {
      case "note":
        events.push({
          tick: event.tick,
          order: 5,
          sequence,
          bytes: [0x90 | event.channel, event.note, event.velocity]
        });
        events.push({
          tick: event.tick + event.durationTicks,
          order: 1,
          sequence,
          bytes: [0x80 | event.channel, event.note, 0]
        });
        break;
      case "control-change":
        // Controls precede program changes on the same tick so bank-select
        // (CC0/CC32) configures the program change that follows it.
        events.push({
          tick: event.tick,
          order: 2,
          sequence,
          bytes: [0xb0 | event.channel, event.controller, event.value]
        });
        break;
      case "pitch-bend": {
        const unsigned = event.value + 8192;
        events.push({
          tick: event.tick,
          order: 4,
          sequence,
          bytes: [0xe0 | event.channel, unsigned & 0x7f, (unsigned >>> 7) & 0x7f]
        });
        break;
      }
      case "program-change":
        events.push({
          tick: event.tick,
          order: 3,
          sequence,
          bytes: [0xc0 | event.channel, event.program]
        });
        break;
    }
  });

  events.sort(
    (left, right) =>
      left.tick - right.tick ||
      left.order - right.order ||
      left.sequence - right.sequence
  );

  const payload: number[] = [];
  let previousTick = 0;
  for (const event of events) {
    payload.push(...encodeVariableLength(event.tick - previousTick), ...event.bytes);
    previousTick = event.tick;
  }
  payload.push(0x00, 0xff, 0x2f, 0x00);
  return chunk("MTrk", payload);
}

function encodeTempoTrack(tempoBpm: number): number[] {
  if (!Number.isFinite(tempoBpm) || tempoBpm < 20 || tempoBpm > 300) {
    throw new RangeError("MIDI tempo must be a finite value in 20..300 BPM.");
  }

  const microseconds = Math.round(60_000_000 / tempoBpm);
  const payload = [
    0x00,
    ...metaText(0x03, "COSMOAUDITION tempo"),
    0x00,
    0xff,
    0x51,
    0x03,
    (microseconds >>> 16) & 0xff,
    (microseconds >>> 8) & 0xff,
    microseconds & 0xff,
    0x00,
    0xff,
    0x2f,
    0x00
  ];
  return chunk("MTrk", payload);
}

/**
 * Create a deterministic Standard MIDI File (format 1). The returned bytes are
 * ready for a Blob, a download, a file write, or a MASA bundle asset.
 */
export function createMidiFile(options: CreateMidiFileOptions): Uint8Array {
  if (options.tracks.length === 0) {
    throw new RangeError("A MIDI file requires at least one musical track.");
  }
  if (options.tracks.length >= 0xffff) {
    throw new RangeError("Too many MIDI tracks.");
  }

  const ticksPerQuarter = options.ticksPerQuarter ?? 480;
  assertIntegerInRange(
    ticksPerQuarter,
    24,
    0x7fff,
    "MIDI ticks per quarter note"
  );

  const tempoTrack = encodeTempoTrack(options.tempoBpm ?? 120);
  const musicalTracks = options.tracks.flatMap(encodeTrack);
  const trackCount = options.tracks.length + 1;
  const header = chunk("MThd", [
    0x00,
    0x01,
    ...encodeUint16(trackCount),
    ...encodeUint16(ticksPerQuarter)
  ]);

  return Uint8Array.from([...header, ...tempoTrack, ...musicalTracks]);
}
