import { localObservationSnapshot } from "../apps/api/src/adapters/localObservation";

const [path, now] = process.argv.slice(2);
if (!path || !now)
  throw new Error(
    "Usage: tsx scripts/import-local-observation.mts packet.json timestamp-with-zone",
  );
process.env.COSMOAUDITION_LOCAL_OBSERVATION = path;
process.stdout.write(JSON.stringify(await localObservationSnapshot(now)) + "\n");
