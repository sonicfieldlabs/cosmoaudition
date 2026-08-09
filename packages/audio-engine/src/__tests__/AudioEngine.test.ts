import { describe, expect, it } from "vitest";
import { AudioEngine } from "../AudioEngine";

describe("AudioEngine output arming", () => {
  it("keeps the configured volume while the complete output is disarmed", () => {
    const engine = new AudioEngine();

    expect(engine.setOutputArmed(false)).toMatchObject({
      outputArmed: false,
      masterVolume: 0.38
    });
    expect(engine.setMasterVolume(0.24)).toMatchObject({
      outputArmed: false,
      masterVolume: 0.24
    });
    expect(engine.setOutputArmed(true)).toMatchObject({
      outputArmed: true,
      masterVolume: 0.24
    });
  });

  it("never starts audio implicitly while loading material", async () => {
    const engine = new AudioEngine();
    await expect(engine.loadMaterial(new ArrayBuffer(1))).rejects.toThrow(
      "Press Listen before loading material."
    );

    engine.panic();
    await expect(engine.loadMaterial(new ArrayBuffer(1))).rejects.toThrow(
      "Panic is active"
    );
  });
});
