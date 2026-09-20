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

const roleCount = db.prepare("SELECT COUNT(*) AS n FROM roles").get().n;
if (roleCount === 0) {
  const insertRole = db.prepare("INSERT INTO roles (name, description) VALUES (?, ?)");
  for (const [name, description] of SEED_ROLES) insertRole.run(name, description);
}

const permCount = db.prepare("SELECT COUNT(*) AS n FROM permissions").get().n;
if (permCount === 0) {
  const insertPerm = db.prepare("INSERT INTO permissions (code) VALUES (?)");
  for (const code of SEED_PERMISSIONS) insertPerm.run(code);
}

console.log(`[db] SQLite ready at ${dbPath}`);
