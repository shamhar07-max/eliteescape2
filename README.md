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
- [x] **Phase 4 — First AI employees**: AI Receptionist + Travel Consultant,
      real tool-use (create_lead, get_customer_summary, request_human_handoff)
      wired to real CRM data, conversation persistence, staff oversight UI.
      Runs on a `mock`/`anthropic` provider switch (`AI_PROVIDER` env var) —
      mock mode is fully functional today with zero external dependency;
      drop in `ANTHROPIC_API_KEY` for real Claude intelligence, no code changes
- [x] **Phase 5 — HRMS / Payroll / Procurement**: employees + leave requests
      (approval auto-flips employee status to on_leave), monthly payroll runs
      (auto-generated payslips from basic salary, editable allowances/
      deductions while in draft, draft → processed → paid lifecycle),
      vendors + purchase orders with sequential PO numbering, dashboard UI
      for all four
- [ ] **Phase 6 — Mobile apps** (customer, employee, owner) — deferred; this
      sandbox has no native mobile toolchain (Xcode/Android Studio/emulator)
      to build or verify against, so it was skipped rather than shipped blind
- [x] **Phase 7 — Marketing automation / SEO tooling**: campaigns (email/
      WhatsApp) targeted at customers or leads by interest/status/source,
      live audience preview, send history — plus a dependency-free SEO
      auditor that crawls real pages (title/meta/H1/alt-text/word-count
      checks) and a content-calendar CRUD for planning SEO pages
- [ ] **Phase 8 — Platform administration** (multi-tenant, security, monitoring)
