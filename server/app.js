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
import { router as hrRoutes } from "./routes/hr.routes.js";
import { router as payrollRoutes } from "./routes/payroll.routes.js";
import { router as procurementRoutes } from "./routes/procurement.routes.js";
import { router as marketingRoutes } from "./routes/marketing.routes.js";
import { router as seoRoutes } from "./routes/seo.routes.js";

// Grant every seeded role its module permissions. Owner/admin get everything;
// sales gets CRM; ops/finance/hr get their own module — this is the
// permission map every later phase (ERP, HRMS, Payroll) extends. INSERT OR
// IGNORE against the (role_id, permission_id) primary key makes this safe to
// re-run on every boot, so a later phase's new permission (e.g. procurement)
// reaches roles seeded by an earlier phase.
{
  const roleByName = Object.fromEntries(db.prepare("SELECT id, name FROM roles").all().map(r => [r.name, r.id]));
  const permByCode = Object.fromEntries(db.prepare("SELECT id, code FROM permissions").all().map(p => [p.code, p.id]));
  const grant = db.prepare("INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)");
  const grantAll = (roleName) => Object.values(permByCode).forEach(pid => grant.run(roleByName[roleName], pid));
  grantAll("owner");
  grantAll("admin");
  ["crm.read", "crm.write"].forEach(code => grant.run(roleByName.sales, permByCode[code]));
  ["ops.read", "ops.write", "crm.read", "procurement.read"].forEach(code => grant.run(roleByName.ops, permByCode[code]));
  ["accounting.read", "accounting.write", "procurement.read", "procurement.write"].forEach(code => grant.run(roleByName.finance, permByCode[code]));
  ["hr.read", "hr.write"].forEach(code => grant.run(roleByName.hr, permByCode[code]));
  ["marketing.read", "marketing.write", "crm.read"].forEach(code => grant.run(roleByName.marketing, permByCode[code]));
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
app.use(hrRoutes);
app.use(payrollRoutes);
app.use(procurementRoutes);
app.use(marketingRoutes);
app.use(seoRoutes);

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
app.use(express.static(webRoot));

app.use((req, res) => res.status(404).json({ error: "not found" }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "internal error" });
});
