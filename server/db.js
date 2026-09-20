import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA, SEED_ROLES, SEED_PERMISSIONS } from "./schema.js";

const root = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || join(root, "data", "elite-escape.db");
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec(SCHEMA);

// INSERT OR IGNORE against the UNIQUE name/code columns — safe to re-run on
// every boot, so a later phase's new role or permission reaches a database
// that was already seeded by an earlier phase.
const insertRole = db.prepare("INSERT OR IGNORE INTO roles (name, description) VALUES (?, ?)");
for (const [name, description] of SEED_ROLES) insertRole.run(name, description);

const insertPerm = db.prepare("INSERT OR IGNORE INTO permissions (code) VALUES (?)");
for (const code of SEED_PERMISSIONS) insertPerm.run(code);

console.log(`[db] SQLite ready at ${dbPath}`);
