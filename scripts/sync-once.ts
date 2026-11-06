/** Runs one data sync immediately (same code the scheduler runs).  npm run sync:once */
import { closePool } from "../src/lib/db/pg";
import { runSync } from "../src/lib/sync/run";

runSync()
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exitCode = r.status === "failed" ? 1 : 0;
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
