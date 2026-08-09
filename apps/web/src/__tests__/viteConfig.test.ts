import { describe, expect, it } from "vitest";
import { resolveLocalApiBaseUrl } from "../../vite.config";

describe("web build API boundary", () => {
  it("uses and normalizes only credential-free loopback HTTP origins", () => {
    expect(resolveLocalApiBaseUrl(undefined)).toBe("http://127.0.0.1:8797");
    expect(resolveLocalApiBaseUrl(" http://localhost:9000 ")).toBe(
      "http://localhost:9000"
    );
    expect(resolveLocalApiBaseUrl("http://[::1]:8797")).toBe(
      "http://[::1]:8797"
    );
  });

  it.each([
    "https://127.0.0.1:8797",
    "http://example.test:8797",
    "http://user:secret@localhost:8797",
    "http://localhost:8797/api",
    "http://localhost:8797/?token=secret"
  ])("refuses a non-local or credential-bearing build URL: %s", (value) => {
    expect(() => resolveLocalApiBaseUrl(value)).toThrow(
      /credential-free loopback HTTP origin/
    );
  });
});
