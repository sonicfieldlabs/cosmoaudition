import { describe, expect, it } from "vitest";
import { app } from "../app";
import {
  assertLoopbackHost,
  defaultLocalCorsOrigins,
  isLoopbackRequestHost,
  parseLocalCorsOrigins
} from "../localOnly";

describe("local-only runtime policy", () => {
  it("defaults CORS to local development and preview origins", () => {
    expect(parseLocalCorsOrigins(undefined)).toEqual([...defaultLocalCorsOrigins]);
    expect(parseLocalCorsOrigins("")).toEqual([...defaultLocalCorsOrigins]);
  });

  it("accepts explicit loopback CORS origins", () => {
    expect(
      parseLocalCorsOrigins("http://127.0.0.1:4173,http://localhost:5175")
    ).toEqual(["http://127.0.0.1:4173", "http://localhost:5175"]);
    expect(parseLocalCorsOrigins("http://127.0.0.1:4274")).toEqual([
      "http://127.0.0.1:4274"
    ]);
  });

  it("rejects public CORS origins", () => {
    expect(() => parseLocalCorsOrigins("https://public.example")).toThrow(
      /Local-only mode refuses CORS origin/
    );
  });

  it("rejects non-loopback host binds", () => {
    expect(assertLoopbackHost("127.0.0.1", "HOST")).toBe("127.0.0.1");
    expect(assertLoopbackHost("localhost", "HOST")).toBe("localhost");
    expect(() => assertLoopbackHost("0.0.0.0", "HOST")).toThrow(
      /Local-only mode refuses HOST/
    );
  });

  it("accepts only loopback request authorities", () => {
    expect(isLoopbackRequestHost("127.0.0.1:8797")).toBe(true);
    expect(isLoopbackRequestHost("localhost:8797")).toBe(true);
    expect(isLoopbackRequestHost("[::1]:8797")).toBe(true);
    expect(isLoopbackRequestHost("rebind.example.test:8797")).toBe(false);
    expect(isLoopbackRequestHost("127.0.0.1.evil.test")).toBe(false);
    expect(isLoopbackRequestHost(undefined)).toBe(false);
    expect(isLoopbackRequestHost(undefined, "http://127.0.0.1:8797/api/snapshot")).toBe(
      true
    );
    expect(isLoopbackRequestHost(undefined, "http://evil.test/api/snapshot")).toBe(false);
  });

  it("refuses a rebound Host header before any route runs", async () => {
    const rebound = await app.request("http://127.0.0.1:8797/health", {
      headers: { host: "rebind.example.test:8797" }
    });
    expect(rebound.status).toBe(421);

    const local = await app.request("http://127.0.0.1:8797/health", {
      headers: { host: "127.0.0.1:8797" }
    });
    expect(local.status).toBe(200);
  });
});
