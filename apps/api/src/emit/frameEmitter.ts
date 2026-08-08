import type { ModulationFrame } from "@cosmoaudition/core";
import { OscEmitter, oscInteger } from "./osc";

/**
 * Publish a ModulationFrame over OSC.
 *
 * The framework's first rule is that a number never travels without its
 * status, and OSC carries only bare arguments. The rule is preserved by
 * publishing a parallel address space: every executable control appears at
 * `/cosmo/control/<target>` *and* `/cosmo/status/<target>`, while an absent
 * target is announced at `/cosmo/absent/<target>` and emits no control value
 * at all. Consuming a control float without reading its status discards the
 * evidence the frame exists to carry.
 */
export function emitFrameOverOsc(emitter: OscEmitter, frame: ModulationFrame): void {
  emitter.send("/cosmo/frame", [frame.frameId, frame.generatedAt, frame.acquisitionMode]);

  for (const control of frame.controls) {
    const address = oscAddressSegment(control.target);
    if (control.outputValue !== null && Number.isFinite(control.outputValue)) {
      emitter.send(`/cosmo/control/${address}`, [control.outputValue]);
    }
    emitter.send(`/cosmo/status/${address}`, [control.status, control.reason]);
  }

  for (const absence of frame.absences) {
    emitter.send(`/cosmo/absent/${oscAddressSegment(absence.target)}`, [
      absence.status,
      absence.reason
    ]);
  }

  emitter.send("/cosmo/frame/end", [
    oscInteger(frame.controls.length),
    oscInteger(frame.absences.length)
  ]);
}

/**
 * Map a mapping target onto an OSC address path.
 *
 * A target such as `synth.filter.cutoff` becomes `synth/filter/cutoff`. OSC
 * address parts may not contain the reserved characters of the pattern
 * language, so anything outside the safe set is escaped as `_<hex>` rather
 * than replaced by a single placeholder — replacing would let two distinct
 * targets collapse onto one address, silently merging two controls. The
 * escape character itself is escaped so the mapping stays reversible.
 */
export function oscAddressSegment(target: string): string {
  return target
    .split(".")
    .map((part) =>
      part.replace(/[^A-Za-z0-9-]/g, (character) =>
        `_${character.codePointAt(0)!.toString(16)}`
      )
    )
    .join("/");
}
