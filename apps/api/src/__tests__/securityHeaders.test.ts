import { describe, expect, it } from "vitest";
import { app } from "../app";
import { apiSecurityHeaders } from "../securityHeaders";

describe("local API security headers", () => {
  it("sets local security headers on health responses", async () => {
    const response = await app.request("/health");

    expect(response.status).toBe(200);
    for (const [name, value] of Object.entries(apiSecurityHeaders)) {
      expect(response.headers.get(name)).toBe(value);
    }
  });

  it("sets local security headers on snapshot responses", async () => {
    const response = await app.request("/api/snapshot?mode=fixture");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Permissions-Policy")).toContain("geolocation=()");
  });
});
