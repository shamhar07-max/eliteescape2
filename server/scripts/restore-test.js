#!/usr/bin/env node
/* The disaster-recovery drill this project's backups don't get to call
 * "done" without (see master spec §66 and docs/BACKUP_AND_DR.md). Runs in
 * CI on every push — see .github/workflows/ci.yml — so a restore that
 * silently stops working fails the build, not a 3am incident. */
import { runRestoreTest } from "../lib/backup.js";

const result = await runRestoreTest();
console.log(`\nRestore test against backup ${result.backupFile} (${result.ranAt}):`);
for (const step of result.steps) {
  console.log(`  ${step.ok ? "PASS" : "FAIL"}  ${step.name}${step.detail ? ` (${step.detail})` : ""}`);
}
console.log(result.pass ? "\nRESTORE TEST: PASS" : "\nRESTORE TEST: FAIL");
process.exit(result.pass ? 0 : 1);
