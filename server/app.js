import express from "express";
import cookieParser from "cookie-parser";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";
import { router as authRoutes } from "./routes/auth.routes.js";
import { router as crmRoutes } from "./routes/crm.routes.js";
import { router as publicRoutes } from "./routes/public.routes.js";
import { router as notificationRoutes } from "./routes/notifications.routes.js";
import { router as opsRoutes } from "./routes/ops.routes.js";
import { router as accountingRoutes } from "./routes/accounting.routes.js";
import { router as aiRoutes } from "./routes/ai.routes.js";

// Grant every seeded role its module permissions. Owner/admin get everything;
// sales gets CRM; ops/finance/hr get their own module — this is the
// permission map every later phase (ERP, HRMS, Payroll) extends.
const grantCount = db.prepare("SELECT COUNT(*) AS n FROM role_permissions").get().n;
if (grantCount === 0) {
  const roleByName = Object.fromEntries(db.prepare("SELECT id, name FROM roles").all().map(r => [r.name, r.id]));
  const permByCode = Object.fromEntries(db.prepare("SELECT id, code FROM permissions").all().map(p => [p.code, p.id]));
  const grant = db.prepare("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)");
  const grantAll = (roleName) => Object.values(permByCode).forEach(pid => grant.run(roleByName[roleName], pid));
  grantAll("owner");
  grantAll("admin");
  ["crm.read", "crm.write"].forEach(code => grant.run(roleByName.sales, permByCode[code]));
  ["ops.read", "ops.write", "crm.read"].forEach(code => grant.run(roleByName.ops, permByCode[code]));
  ["accounting.read", "accounting.write"].forEach(code => grant.run(roleByName.finance, permByCode[code]));
  ["hr.read", "hr.write"].forEach(code => grant.run(roleByName.hr, permByCode[code]));
  console.log("[db] role permissions seeded");
}

export const app = express();
app.use(express.json());
app.use(cookieParser());

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "elite-escape-platform-api", phase: 1, time: new Date().toISOString() });
});

app.use(authRoutes);
app.use(crmRoutes);
app.use(publicRoutes);
app.use(notificationRoutes);
app.use(opsRoutes);
app.use(accountingRoutes);
app.use(aiRoutes);

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
app.use(express.static(webRoot));

app.use((req, res) => res.status(404).json({ error: "not found" }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "internal error" });
});
