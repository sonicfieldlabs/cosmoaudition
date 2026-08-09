import { describe, expect, it } from "vitest";
import { createMidiFile, encodeVariableLength } from "../smf";

describe("deterministic Standard MIDI File export", () => {
  it("creates stable format-1 bytes with a tempo and musical track", () => {
    const options = {
      tempoBpm: 100,
      ticksPerQuarter: 480,
      tracks: [
        {
          name: "Planetary controls",
          events: [
            {
              type: "control-change" as const,
              tick: 0,
              channel: 1,
              controller: 74,
              value: 63
            },
            {
              type: "note" as const,
              tick: 120,
              durationTicks: 240,
              channel: 1,
              note: 48,
              velocity: 72
            }
          ]
        }
      ]
    };

    const first = createMidiFile(options);
    const second = createMidiFile(options);

    expect(Array.from(first.slice(0, 14))).toEqual([
      0x4d,
      0x54,
      0x68,
      0x64,
      0x00,
      0x00,
      0x00,
      0x06,
      0x00,
      0x01,
      0x00,
      0x02,
      0x01,
      0xe0
    ]);
    expect(first).toEqual(second);
  });

  it("encodes MIDI variable-length quantities", () => {
    expect(encodeVariableLength(0)).toEqual([0]);
    expect(encodeVariableLength(127)).toEqual([0x7f]);
    expect(encodeVariableLength(128)).toEqual([0x81, 0x00]);
    expect(encodeVariableLength(16_383)).toEqual([0xff, 0x7f]);
  });

  it("refuses invalid events instead of clamping or wrapping them", () => {
    expect(() =>
      createMidiFile({
        tracks: [
          {
            name: "invalid",
            events: [
              {
                type: "control-change",
                tick: 0,
                channel: 0,
                controller: 12,
                value: 128
              }
            ]
          }
        ]
      })
    ).toThrow(/controller value/);
  });

  it("emits a same-tick bank select before the program change it configures", () => {
    const bytes = createMidiFile({
      tracks: [
        {
          name: "bank",
          events: [
            { type: "program-change", tick: 0, channel: 0, program: 5 },
            { type: "control-change", tick: 0, channel: 0, controller: 0, value: 1 }
          ]
        }
      ]
    });
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

    expect(hex.indexOf("b00001")).toBeGreaterThan(-1);
    expect(hex.indexOf("c005")).toBeGreaterThan(-1);
    expect(hex.indexOf("b00001")).toBeLessThan(hex.indexOf("c005"));
  });
});
