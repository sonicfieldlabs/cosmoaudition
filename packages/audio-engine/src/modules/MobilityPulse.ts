import { clamp01, type ObservedSignal } from "@cosmoaudition/core";
import {
  confidenceGain,
  densityIntervalScale,
  getSignal,
  getSignalNormalized,
  normalizedToRange
} from "../params";
import type { AudioModule } from "./types";

export interface MobilityPulseParams {
  intervalMs: number | null;
  frequency: number | null;
  pulseGain: number;
  pulseWidthMs: number | null;
}

function activeConfidence(signal: ObservedSignal | undefined): number {
  if (
    !signal ||
    signal.value === null ||
    signal.normalized === null ||
    !Number.isFinite(signal.value) ||
    !Number.isFinite(signal.normalized)
  ) {
    return 0;
  }

  return confidenceGain(signal.confidence);
}

export function calculateMobilityPulseParams(
  signals: readonly ObservedSignal[],
  density = 0.5
): MobilityPulseParams {
  const availability = getSignal(signals, "bogota_bike_availability_ratio");
  const stations = getSignal(signals, "bogota_bike_stations_available");
  const availabilityLevel = getSignalNormalized(
    signals,
    "bogota_bike_availability_ratio"
  );
  const stationLevel = getSignalNormalized(
    signals,
    "bogota_bike_stations_available"
  );
  const staleLevel = getSignalNormalized(
    signals,
    "bogota_bike_stale_station_count"
  );
  const confidence = Math.min(
    activeConfidence(availability),
    activeConfidence(stations)
  );
  const staleDamping =
    staleLevel === null ? 1 : 1 - Math.min(staleLevel, 1) * 0.45;

  return {
    // Availability sets the base city tempo; the global Stack Pulse density then
    // scales it (denser stack -> shorter interval), clamped so it never runs away.
    intervalMs:
      availabilityLevel === null
        ? null
        : Math.max(
            110,
            normalizedToRange(availabilityLevel, [760, 180]) *
              densityIntervalScale(density)
          ),
    frequency:
      availabilityLevel === null
        ? null
        : normalizedToRange(availabilityLevel, [180, 520]),
    pulseGain:
      stationLevel === null || availabilityLevel === null
        ? 0
        : normalizedToRange(stationLevel, [0.004, 0.028]) *
          confidence *
          staleDamping,
    pulseWidthMs:
      staleLevel === null
        ? null
        : normalizedToRange(1 - staleLevel, [34, 76])
  };
}

export class MobilityPulse implements AudioModule {
  readonly id = "mobilityPulse";
  readonly layer = "city" as const;
  private context: AudioContext | null = null;
  private destination: AudioNode | null = null;
  private timer: number | null = null;
  private intervalMs = 760;
  private frequency = 180;
  private pulseGain = 0;
  private pulseWidthMs = 42;
  private density = 0.5;

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
    this.density = density;
    const params = calculateMobilityPulseParams(signals, density);

    // frequency, gain, and width are read live inside tick(), so only a changed
    // interval needs to reschedule the timer. Rescheduling on every update would
    // reset the pulse phase (and, if updates ever arrived faster than the
    // interval, prevent the pulse from ever firing).
    const intervalChanged =
      params.intervalMs !== null &&
      Math.abs(params.intervalMs - this.intervalMs) > 0.5;

    if (params.intervalMs !== null) {
      this.intervalMs = params.intervalMs;
    }
    if (params.frequency !== null) {
      this.frequency = params.frequency;
    }
    this.pulseGain = params.pulseGain;
    if (params.pulseWidthMs !== null) {
      this.pulseWidthMs = params.pulseWidthMs;
    }

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
    if (this.pulseGain <= 0) {
      return;
    }

    this.emitPulse(this.pulseGain, this.frequency, 0);

    // Higher stack density thickens the city pulse with an occasional softer
    // off-beat subdivision rather than only running faster.
    const subdivisionChance = clamp01((this.density - 0.55) * 1.6);
    if (subdivisionChance > 0 && Math.random() < subdivisionChance) {
      this.emitPulse(this.pulseGain * 0.6, this.frequency * 1.5, this.intervalMs / 2000);
    }
  }

  private emitPulse(gain: number, frequency: number, delaySeconds: number): void {
    if (!this.context || !this.destination || gain <= 0) {
      return;
    }

    const start = this.context.currentTime + Math.max(0, delaySeconds);
    const oscillator = this.context.createOscillator();
    const pulseGain = this.context.createGain();
    const pulseSeconds = this.pulseWidthMs / 1000;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    pulseGain.gain.setValueAtTime(0, start);
    pulseGain.gain.linearRampToValueAtTime(gain, start + 0.008);
    pulseGain.gain.exponentialRampToValueAtTime(0.0001, start + pulseSeconds);
    oscillator.connect(pulseGain);
    pulseGain.connect(this.destination);
    oscillator.start(start);
    oscillator.stop(start + pulseSeconds + 0.02);
  }
}
