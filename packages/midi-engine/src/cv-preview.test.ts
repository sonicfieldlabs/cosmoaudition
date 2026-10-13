import { expect, it } from "vitest";
import { renderCvPreview } from "./cv-preview";

it("renders a bounded normalized digital ramp, with no voltage or device claim", () => {
  const points = [
    { frame: 0, value: -1, status: "applied" as const },
    { frame: 2, value: 1, status: "applied" as const },
  ];
  const result = renderCvPreview(points, 3, 48000);
  expect([...result.samples]).toEqual([-1, 0, 1]);
  expect(result.receipt).toMatchObject({
    deviceOutput: false,
    voltageCalibration: "unknown",
  });
  expect(() =>
    renderCvPreview([{ ...points[0]!, value: null }, points[1]!], 3, 48000),
  ).toThrow();
  expect(() =>
    renderCvPreview([{ ...points[0]!, status: "held" }, points[1]!], 3, 48000),
  ).toThrow();
  expect(
    renderCvPreview(
      [{ ...points[0]!, status: "held" }, points[1]!],
      3,
      48000,
      true,
    ).receipt.heldPermitted,
  ).toBe(true);
  expect(() => renderCvPreview(points, 96001, 96000)).toThrow();
});
