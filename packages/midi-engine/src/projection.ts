import {
  isExecutableControlDecision,
  type ControlDecision,
  type ControlDecisionStatus
} from "@cosmoaudition/core";
import type { MidiControlChangeEvent } from "./smf";

export interface MidiControlRoute {
  target: string;
  channel: number;
  controller: number;
  sourceRange: readonly [number, number];
  /** Held values are silent by default; enable this for stateful device sync. */
  transmitHeld?: boolean;
}

export interface ProjectedMidiControl {
  mappingId: string;
  target: string;
  decisionStatus: Extract<
    ControlDecisionStatus,
    "applied" | "held" | "uncertainty"
  >;
  event: MidiControlChangeEvent;
}

export interface MidiOutputLike {
  id: string;
  name?: string | null;
  send(data: readonly number[] | Uint8Array, timestamp?: number): void;
}

export interface MidiAccessLike {
  outputs: {
    values?: () => IterableIterator<MidiOutputLike>;
    forEach?: (
      callback: (output: MidiOutputLike, key: string) => void
    ) => void;
  };
}

export interface MidiNavigatorLike {
  requestMIDIAccess?: () => Promise<MidiAccessLike>;
}

function assertRoute(route: MidiControlRoute): void {
  if (!Number.isInteger(route.channel) || route.channel < 0 || route.channel > 15) {
    throw new RangeError("MIDI route channel must be an integer in 0..15.");
  }
  if (
    !Number.isInteger(route.controller) ||
    route.controller < 0 ||
    route.controller > 127
  ) {
    throw new RangeError("MIDI route controller must be an integer in 0..127.");
  }
  const [start, end] = route.sourceRange;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) {
    throw new RangeError("MIDI route sourceRange must contain two finite values.");
  }
}

function toMidiValue(value: number, sourceRange: readonly [number, number]): number {
  const [start, end] = sourceRange;
  const normalized = Math.min(1, Math.max(0, (value - start) / (end - start)));
  return Math.round(normalized * 127);
}

export function projectControlDecision(
  decision: ControlDecision,
  route: MidiControlRoute,
  tick = 0
): ProjectedMidiControl | null {
  assertRoute(route);
  if (!Number.isInteger(tick) || tick < 0) {
    throw new RangeError("Projected MIDI tick must be a non-negative integer.");
  }
  if (route.target !== decision.target || !isExecutableControlDecision(decision)) {
    return null;
  }
  if (decision.status === "held" && route.transmitHeld !== true) {
    return null;
  }

  return {
    mappingId: decision.mappingId,
    target: decision.target,
    decisionStatus: decision.status,
    event: {
      type: "control-change",
      tick,
      channel: route.channel,
      controller: route.controller,
      value: toMidiValue(decision.outputValue, route.sourceRange)
    }
  };
}

export function projectControlDecisions(
  decisions: readonly ControlDecision[],
  routes: readonly MidiControlRoute[],
  tick = 0
): ProjectedMidiControl[] {
  const routeByTarget = new Map<string, MidiControlRoute>();
  for (const route of routes) {
    // Validate every route up front and refuse duplicate targets instead of
    // silently letting the last declaration win.
    assertRoute(route);
    if (routeByTarget.has(route.target)) {
      throw new RangeError(`Duplicate MIDI control route target: ${route.target}`);
    }
    routeByTarget.set(route.target, route);
  }
  const projected: ProjectedMidiControl[] = [];

  for (const decision of decisions) {
    const route = routeByTarget.get(decision.target);
    if (!route) {
      continue;
    }
    const control = projectControlDecision(decision, route, tick);
    if (control) {
      projected.push(control);
    }
  }

  return projected;
}

export async function requestBrowserMidiAccess(
  navigatorLike: MidiNavigatorLike = globalThis.navigator as unknown as MidiNavigatorLike
): Promise<MidiAccessLike> {
  if (typeof navigatorLike?.requestMIDIAccess !== "function") {
    throw new Error("Web MIDI API is not available in this browser.");
  }
  return navigatorLike.requestMIDIAccess();
}

export function listMidiOutputs(access: MidiAccessLike): MidiOutputLike[] {
  if (typeof access.outputs.values === "function") {
    return [...access.outputs.values()];
  }
  if (typeof access.outputs.forEach === "function") {
    const outputs: MidiOutputLike[] = [];
    access.outputs.forEach((output) => outputs.push(output));
    return outputs;
  }
  throw new Error("Web MIDI output collection is not enumerable.");
}

export function sendMidiControlChange(
  output: MidiOutputLike,
  event: MidiControlChangeEvent,
  timestamp?: number
): void {
  if (
    !Number.isInteger(event.channel) ||
    event.channel < 0 ||
    event.channel > 15 ||
    !Number.isInteger(event.controller) ||
    event.controller < 0 ||
    event.controller > 127 ||
    !Number.isInteger(event.value) ||
    event.value < 0 ||
    event.value > 127
  ) {
    throw new RangeError("Invalid MIDI control-change event.");
  }
  if (timestamp !== undefined && (!Number.isFinite(timestamp) || timestamp < 0)) {
    throw new RangeError("Web MIDI timestamp must be a non-negative finite value.");
  }

  const bytes = [0xb0 | event.channel, event.controller, event.value];
  if (timestamp === undefined) {
    output.send(bytes);
  } else {
    output.send(bytes, timestamp);
  }
}

export function sendProjectedControls(
  output: MidiOutputLike,
  controls: readonly ProjectedMidiControl[],
  timestamp?: number
): void {
  for (const control of controls) {
    sendMidiControlChange(output, control.event, timestamp);
  }
}
