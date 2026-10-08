import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { localObservationSnapshot } from "./localObservation";

it("keeps absent and malformed local imports unavailable and never accepts a request path", async () => {
  const prior = process.env.COSMOAUDITION_LOCAL_OBSERVATION;
  const directory = await mkdtemp(join(tmpdir(), "cosmo-local-import-"));
  try {
    delete process.env.COSMOAUDITION_LOCAL_OBSERVATION;
    expect((await localObservationSnapshot()).status).toBe("unavailable");
    const path = join(directory, "packet.json");
    await writeFile(
      path,
      JSON.stringify({ secret: "never echoed", kind: "account-report" }),
    );
    process.env.COSMOAUDITION_LOCAL_OBSERVATION = path;
    await expect(localObservationSnapshot()).rejects.toThrow();
    const link = join(directory, "link.json");
    await symlink(path, link);
    process.env.COSMOAUDITION_LOCAL_OBSERVATION = link;
    await expect(localObservationSnapshot()).rejects.toThrow();
  } finally {
    if (prior === undefined) delete process.env.COSMOAUDITION_LOCAL_OBSERVATION;
    else process.env.COSMOAUDITION_LOCAL_OBSERVATION = prior;
    await rm(directory, { recursive: true, force: true });
  }
});
