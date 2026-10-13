import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { importLocalObservation } from "@cosmoaudition/core";

/** Operator-configured offline input. Requests cannot supply a filename or URL. */
export async function localObservationSnapshot(now = new Date().toISOString()) {
  const path = process.env.COSMOAUDITION_LOCAL_OBSERVATION;
  if (!path)
    return {
      contract: "cosmo/local-import-snapshot/v1",
      status: "unavailable",
      reason: "No local observation configured",
      signals: [],
    };
  const stream = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await stream.stat();
    if (!info.isFile() || info.size > 2 * 1024 ** 2)
      throw new RangeError("Local observation exceeds bounds.");
    const buffer = Buffer.alloc(2 * 1024 ** 2 + 1);
    const { bytesRead } = await stream.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== info.size || bytesRead > 2 * 1024 ** 2)
      throw new RangeError("Local observation changed or exceeds bounds.");
    const bytes = buffer.subarray(0, bytesRead);
    const imported = importLocalObservation(
      JSON.parse(bytes.toString("utf8")),
      now,
    );
    return {
      contract: "cosmo/local-import-snapshot/v1",
      status: "caller-declared-import",
      ...imported,
      packetSha256: createHash("sha256").update(bytes).digest("hex"),
      liveQualification: "not-claimed",
    };
  } finally {
    await stream.close();
  }
}
