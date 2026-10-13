/** Offline normalized sample buffer. No DAC output, volts, playback or device access. */
export interface CvPoint {
  frame: number;
  value: number | null;
  status: "applied" | "held" | "missing" | "refused";
}
export function renderCvPreview(
  points: readonly CvPoint[],
  frames: number,
  sampleRate: number,
  allowHeld = false,
): {
  samples: Float32Array;
  receipt: {
    contract: "cosmo/cv-preview/v1";
    frames: number;
    sampleRate: number;
    interpolation: "linear";
    unit: "normalized-digital";
    voltageCalibration: "unknown";
    deviceOutput: false;
    heldPermitted: boolean;
  };
} {
  if (
    !Number.isInteger(sampleRate) ||
    sampleRate < 8000 ||
    sampleRate > 96000 ||
    !Number.isInteger(frames) ||
    frames < 2 ||
    frames > sampleRate ||
    !Array.isArray(points) ||
    points.length < 2 ||
    points.length > 256 ||
    points[0].frame !== 0 ||
    points.at(-1)?.frame !== frames - 1 ||
    typeof allowHeld !== "boolean"
  )
    throw new RangeError("CV preview bounds refused.");
  points.forEach((point, index) => {
    if (
      !Number.isInteger(point.frame) ||
      point.frame < 0 ||
      point.frame >= frames ||
      (index > 0 && point.frame <= points[index - 1].frame) ||
      typeof point.value !== "number" ||
      !Number.isFinite(point.value) ||
      Math.abs(point.value) > 1 ||
      (point.status !== "applied" && !(point.status === "held" && allowHeld))
    )
      throw new RangeError(
        "Missing, refused or unpermitted CV point; no buffer produced.",
      );
  });
  const samples = new Float32Array(frames);
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1],
      b = points[index];
    for (let frame = a.frame; frame <= b.frame; frame++) {
      samples[frame] =
        a.value! +
        ((b.value! - a.value!) * (frame - a.frame)) / (b.frame - a.frame);
    }
  }
  return {
    samples,
    receipt: {
      contract: "cosmo/cv-preview/v1",
      frames,
      sampleRate,
      interpolation: "linear",
      unit: "normalized-digital",
      voltageCalibration: "unknown",
      deviceOutput: false,
      heldPermitted: allowHeld,
    },
  };
}
