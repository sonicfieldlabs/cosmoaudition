import {
  confidenceGain,
  densityIntervalScale,
  getSignal,
  getSignalNormalized,
  normalizedToRange
} from "../params";
import type { AudioModule } from "./types";
import type { ObservedSignal } from "@cosmoaudition/core";

export class BrowserTicks implements AudioModule {
  readonly id = "browserTicks";
  readonly layer = "interface" as const;
  private context: AudioContext | null = null;
  private destination: AudioNode | null = null;
  private timer: number | null = null;
  private intervalMs = 520;
  // Silent until the first browser-latency signal arrives; a default level
  // would be hidden gain with no observation behind it.
  private gainScalar = 0;

  start(context: AudioContext, destination: AudioNode): void {
    this.context = context;
    this.destination = destination;
    this.restartTimer();
  }

  update(
    signals: readonly ObservedSignal[],
    _context: AudioContext,
    density = 0.5
  ): void {
    const signal = getSignal(signals, "browser_fetch_latency");
    const normalized = getSignalNormalized(signals, "browser_fetch_latency");
    this.gainScalar = confidenceGain(signal?.confidence);
    if (normalized === null) {
      this.gainScalar = 0;
      return;
    }

    // gainScalar is applied live inside tick(); only a changed interval needs a
    // reschedule. Stack density scales the microtick rate (denser -> faster).
    const nextInterval = Math.max(
      80,
      normalizedToRange(1 - normalized, [120, 760]) * densityIntervalScale(density)
    );
    const intervalChanged = Math.abs(nextInterval - this.intervalMs) > 0.5;
    this.intervalMs = nextInterval;

    if (intervalChanged) {
      this.restartTimer();
    }
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.context = null;
    this.destination = null;
  }

  private restartTimer(): void {
    if (!this.context || !this.destination) {
      return;
    }

    if (this.timer !== null) {
      window.clearInterval(this.timer);
    }

    this.timer = window.setInterval(() => this.tick(), this.intervalMs);
  }

  private tick(): void {
    if (!this.context || !this.destination) {
      return;
    }

    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();

    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(1300, now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.018 * this.gainScalar, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
    oscillator.connect(gain);
    gain.connect(this.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.04);
  }
}
