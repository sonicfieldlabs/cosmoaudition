import type {
  ControlDecision,
  DerivedIndex,
  ObservedSignal,
  StackLayer
} from "@cosmoaudition/core";

export interface AudioModule {
  id: string;
  layer: StackLayer;
  start(context: AudioContext, destination: AudioNode): void;
  // `density` is the smoothed global rhythmic density (0..1) derived from the
  // Stack Pulse Index. `indices` is the full derived-index set (so a module can
  // be driven by its index rather than a single raw signal). Continuous modules
  // ignore both; implementations may omit trailing parameters they do not use.
  update(
    signals: readonly ObservedSignal[],
    context: AudioContext,
    density: number,
    indices: readonly DerivedIndex[],
    decisions: readonly ControlDecision[]
  ): void;
  stop(context: AudioContext): void;
}
