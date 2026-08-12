import { serve } from "@hono/node-server";
import { buildModulationFrame, MODULATION_CONTRACT } from "@cosmoaudition/core";
import { collectSnapshot, activeSourceIds } from "./adapters";
import { app } from "./app";
import { emitFrameOverOsc } from "./emit/frameEmitter";
import { OscEmitter } from "./emit/osc";
import { assertLoopbackHost, isLoopbackHost } from "./localOnly";

const rawPort = process.env.PORT ?? "8797";
if (!/^\d{1,5}$/.test(rawPort.trim())) {
  throw new Error(`Local-only mode refuses PORT=${rawPort}. Use an integer port.`);
}
const port = Number.parseInt(rawPort, 10);
if (port < 1 || port > 65_535) {
  throw new Error(`Local-only mode refuses PORT=${rawPort}. Use a port inside 1..65535.`);
}
// `[::1]` is the URL authority form; Node's bind expects the bare address.
const hostname = assertLoopbackHost(process.env.HOST ?? "127.0.0.1", "HOST").replace(
  /^\[|\]$/g,
  ""
);

serve({ fetch: app.fetch, hostname, port }, (info) => {
  console.log(`Cosmoaudition System API listening on http://${info.address}:${info.port}`);
  console.log(`Modulation contract ${MODULATION_CONTRACT} at /api/modulation`);
  console.log("Signal catalog at /api/signals");
});

startOscEmission();

/**
 * Headless OSC emission. Opt-in through COSMOAUDITION_OSC_TARGET so the
 * gateway keeps its existing behavior by default, and refused for non-loopback
 * targets: publishing modulation onto a network is a separate decision with
 * its own threat model, not something an environment variable should unlock.
 */
function startOscEmission(): void {
  const target = process.env.COSMOAUDITION_OSC_TARGET;
  if (!target) return;

  const match = /^(.+):(\d{1,5})$/.exec(target.trim());
  if (!match) {
    throw new Error(
      `COSMOAUDITION_OSC_TARGET must be host:port, for example 127.0.0.1:57120. Received ${target}.`
    );
  }
  const host = match[1]!.replace(/^\[|\]$/g, "");
  const oscPort = Number.parseInt(match[2]!, 10);
  if (!isLoopbackHost(host)) {
    throw new Error(
      `Local-only mode refuses OSC target ${host}. Emit to a loopback address; a networked target needs an explicit decision.`
    );
  }

  const mode = process.env.COSMOAUDITION_OSC_MODE === "fixture" ? "fixture" : "live";
  const intervalMs = parseOscInterval(process.env.COSMOAUDITION_OSC_INTERVAL_MS);
  const emitter = new OscEmitter({ host, port: oscPort });
  let running = false;

  const publish = async (): Promise<void> => {
    // Never overlap acquisitions: a slow provider must not queue frames.
    if (running) return;
    running = true;
    try {
      const snapshot = await collectSnapshot({ mode, sourceIds: [...activeSourceIds] });
      emitFrameOverOsc(
        emitter,
        buildModulationFrame({
          generatedAt: snapshot.generatedAt,
          mode,
          signals: snapshot.signals,
          sources: snapshot.sources
        })
      );
    } catch (error) {
      console.error(
        `OSC frame skipped: ${error instanceof Error ? error.message : "acquisition failed"}`
      );
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void publish(), intervalMs);
  timer.unref();
  void publish();

  console.log(
    `Emitting ${MODULATION_CONTRACT} over OSC to ${host}:${oscPort} every ${intervalMs} ms (${mode} mode)`
  );
}

function parseOscInterval(value: string | undefined): number {
  if (!value) return 60_000;
  if (!/^\d{1,7}$/.test(value.trim())) {
    throw new Error("COSMOAUDITION_OSC_INTERVAL_MS must be an integer number of milliseconds.");
  }
  const parsed = Number.parseInt(value, 10);
  if (parsed < 1_000 || parsed > 600_000) {
    throw new Error("COSMOAUDITION_OSC_INTERVAL_MS must be between 1000 and 600000.");
  }
  return parsed;
}
