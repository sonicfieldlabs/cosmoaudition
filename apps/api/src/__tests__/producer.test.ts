import { describe, expect, it } from "vitest";
import { app } from "../app";
import { producerEnvelope } from "../producer";

describe("owner producer boundary", () => {
  it("binds identical snapshots and separates source modes", () => {
    const snapshot = { mode: "fixture", signals: [{ id: "temperature", sourceId: "weather" }] };
    expect(producerEnvelope(snapshot)).toEqual(producerEnvelope(snapshot));
    expect(producerEnvelope({ ...snapshot, mode: "live" }).sources).not.toEqual(producerEnvelope(snapshot).sources);
  });
  it("serves fixture identity and refuses hostile authorities and origins", async () => {
    const identity = await (await app.request("http://localhost/api/identity")).json() as { producerId: string };
    const snapshot = await (await app.request("http://localhost/api/snapshot?mode=fixture&sources=usgs_earthquakes")).json() as { producer: ReturnType<typeof producerEnvelope> };
    expect(snapshot.producer.producerId).toBe(identity.producerId);
    expect(snapshot.producer.acquisitionMode).toBe("fixture");
    expect(snapshot.producer.sources.length).toBeGreaterThan(0);
    const frame = await (await app.request("http://localhost/api/frame?mode=fixture&sources=usgs_earthquakes")).json() as { producer: ReturnType<typeof producerEnvelope> };
    expect(frame.producer.producerId).toBe(identity.producerId);
    expect((await app.request("http://localhost/api/identity", { headers: { Origin: "https://example.com" } })).status).toBe(403);
    expect((await app.request("http://localhost/api/identity", { headers: { Host: "localhost#evil" } })).status).toBe(421);
    expect((await app.request("http://localhost/api/identity", { headers: { Host: "example.com" } })).status).toBe(421);
  });
});
