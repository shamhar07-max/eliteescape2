# Elite Escape — Business Management Platform

Internal platform for Elite Escape Tourism: CRM, operations, accounting, HR and
AI-employee modules, built separately from the public marketing website
(`elite-escape-tourism` repo) and connected to it only through one public API
endpoint.

## Architecture

- `server/` — Express API, SQLite (dev) via Node's built-in `node:sqlite`
- `web/` — plain HTML/CSS/JS admin dashboard, served as static files by the same server
- Session-cookie auth, role-based permissions (owner/admin/sales/ops/finance/hr)
- Every write action is recorded in `audit_log` — the compliance trail every
  later module (accounting, payroll) also writes to

## Quick start

```bash
cd server
npm install
node index.js
```

Open **http://localhost:4100** — you'll be redirected to `/login.html`.
Register your first user via the API before logging in:

```bash
curl -X POST http://localhost:4100/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"owner@eliteescapetourism.com","password":"YOUR_PASSWORD","fullName":"Your Name","role":"owner"}'
```

## Public website integration

The marketing website (a separate, static codebase with no backend of its own)
posts leads directly into this platform's CRM via one public, rate-limited
endpoint: `POST /api/public/leads`. See `server/routes/public.routes.js`.

Set `PUBLIC_WEBSITE_ORIGINS` (comma-separated) to the real website domain(s)
before deploying — it defaults to local dev ports only.

## Roadmap / phases

- [x] **Phase 1 — Foundation**: auth, RBAC, CRM data spine, audit log
- [x] **Phase 2 — Communications + CRM UI**: real dashboard, in-app + email
      notifications (console provider for now — swap in real SMTP via
      `EMAIL_PROVIDER` in `server/lib/notify.js`)
- [x] **Phase 3 — Travel Operations + Accounting core**: bookings/itineraries,
      sequential invoicing (UAE FTA-compliant numbering), 5% UAE VAT,
      payments with auto-paid-status, dashboard UI for both
- [ ] **Phase 4 — First AI employees**: Travel Consultant + Receptionist,
      wired to real CRM data
- [ ] **Phase 5 — HRMS / Payroll / Procurement**
- [ ] **Phase 6 — Mobile apps** (customer, employee, owner)
- [ ] **Phase 7 — Marketing automation / SEO tooling**
- [ ] **Phase 8 — Platform administration** (multi-tenant, security, monitoring)
