import { Router } from "express";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { createBackup, listBackups, runRestoreTest } from "../lib/backup.js";

export const router = Router();

const audit = (req, action, detail) => db.prepare(
  "INSERT INTO audit_log (actor_user_id, action, entity_type, detail) VALUES (?, ?, 'backup', ?)"
).run(req.user.id, action, detail);

router.get("/api/admin/backups", auth(["admin.read"]), (req, res) => {
  res.json(listBackups());
});

router.post("/api/admin/backups", auth(["admin.write"]), async (req, res) => {
  try {
    const manifest = await createBackup({ label: req.body?.label || null });
    audit(req, "backup", manifest.fileName);
    res.status(201).json(manifest);
  } catch (err) {
    res.status(500).json({ error: `backup failed: ${err.message}` });
  }
});

// The real disaster-recovery drill (master spec §66): backs up, restores
// into an isolated temp dir, verifies integrity + row/file counts, cleans
// up, and reports pass/fail — never just "a backup file exists somewhere".
router.post("/api/admin/backups/restore-test", auth(["admin.write"]), async (req, res) => {
  try {
    const result = await runRestoreTest();
    audit(req, "restore_test", `${result.pass ? "PASS" : "FAIL"} — ${result.backupFile}`);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: `restore test failed: ${err.message}` });
  }
});
