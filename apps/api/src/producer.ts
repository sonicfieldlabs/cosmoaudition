import { createHash, randomUUID } from "node:crypto";
import { stableStringify } from "@cosmoaudition/masa";

/** Process identity is not a durable public replay epoch. */
export const producerId = `cosmoaudition:${randomUUID()}`;
export function producerEnvelope(snapshot: { mode: string; signals: readonly { id: string; sourceId: string }[] }) {
  const digest = createHash("sha256").update(stableStringify(snapshot)).digest("hex");
  return {
    contract: "cosmoaudition/producer-event/v1",
    producerId,
    eventId: `sha256:${digest}`,
    acquisitionMode: snapshot.mode,
    sources: [...new Set(snapshot.signals.map(signal => signal.sourceId))].sort().map(sourceId => ({
      sourceId, sourceRef: `cosmoaudition:${snapshot.mode}:source:${encodeURIComponent(sourceId)}`
    })),
    signals: snapshot.signals.map(signal => ({ signalId: signal.id,
      sourceRef: `cosmoaudition:${snapshot.mode}:source:${encodeURIComponent(signal.sourceId)}` })),
    replay: "not_available; reconnect obtains a fresh snapshot",
    healthMeaning: "provider transport state; inspect each observation freshness independently"
  };
}
