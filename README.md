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
Register your first user via the API before logging in — this only ever
works once: it creates the sole bootstrap account as `owner`, then locks
itself. Every user after that is created by an owner/admin from the
**Platform Admin** tab (or `POST /api/admin/users`).

```bash
curl -X POST http://localhost:4100/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"owner@eliteescapetourism.com","password":"YOUR_PASSWORD","fullName":"Your Name"}'
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
- [x] **Phase 8 — Platform administration**: security + monitoring (scoped
      down from multi-tenant, which this single-company platform doesn't
      need). Fixes a real privilege-escalation hole — `/api/auth/register`
      let anyone self-register as `owner`; it now only ever creates the
      first (bootstrap) account, and every user after that is admin-created
      via `POST /api/admin/users`. Adds login rate-limiting, self-service
      password change, user management (role changes, activate/deactivate,
      force-logout by revoking sessions), a full audit-log viewer, and a
      system health dashboard (business KPIs + request/error counters)
- [x] **Phase 9 — Quotations + Visa Case Management**: version-controlled
      quotations (never overwritten — a revision creates a new version and
      marks the prior one `superseded`), accepting a quotation creates a
      booking directly from its line items (closing the spec's own
      Inquiry→Lead→Quote→Booking pipeline) and flips the source lead to
      `won`. Visa case management is a from-scratch module: cases,
      applicants, a per-applicant document checklist (status tracking —
      actual file storage still needs object storage, see
      `docs/ELITE_ESCAPE_INTEGRATION_MAP.md`), and full status history
      across the real 14-state lifecycle (new → ... → completed/rejected/
      withdrawn/cancelled). Also fixes the decimal-money bug flagged in
      `docs/ELITE_ESCAPE_GAP_ANALYSIS.md` §6 — every AED column moved from
      floating-point to integer fils, with a lossless migration for
      existing data
- [x] **Phase 10 — Full AI workforce**: 6 new staff-facing AI assistants
      (Visa, Sales, Operations, Finance, Marketing, Executive) alongside
      the existing customer-facing Receptionist/Travel Consultant. Unlike
      the customer agents, every staff assistant's tools are strictly
      read-only (`AGENT_TOOL_NAMES` in `server/lib/ai/tools.js`) — they
      summarize real CRM/ops/finance/marketing data for a human to act on
      and never post a ledger entry, change a status, or contact a
      customer themselves, per the master spec's AI Security principle.
      New authenticated `POST /api/ai/staff-chat` endpoint (any logged-in
      staff member — no separate `ai.*` permission gate exists yet) plus
      an **AI Assistants** dashboard tab with one card per assistant.
      Runs on the same `mock`/`anthropic` provider switch as Phase 4;
      mock mode is genuinely functional today via `mockStaffReply`.
- [x] **Phase 11 — Typed travel services + double-entry accounting**:
      `booking_items` gains a `service_type` (flight/hotel/transfer/
      attraction/insurance/visa/holiday/other), a supplier + supplier cost,
      and a service-confirmation status, plus a sparse `booking_item_details`
      table holding each type's own fields (PNR/cabin class for flights,
      room type/meal plan for hotels, etc.) and a `travelers` table (name,
      DOB, passport, nationality, special assistance) linked to the
      services they're on — the master spec's Traveler Management +
      typed Flight/Hotel/Transfer/Attraction/Insurance Operations sections.
      Alongside it, a real deterministic double-entry GL
      (`server/lib/gl.js`): a seeded chart of accounts, balanced journal
      entries idempotent on `(source_type, source_id)` so re-firing an
      event never double-posts, and auto-posting hooked into every money
      event that already existed — invoice sent, payment received, PO
      received/paid, payroll disbursed — plus a new supplier/customer
      refunds module. New `/api/gl/*` reporting endpoints (trial balance,
      P&L, balance sheet, journal drill-down) and a per-booking
      profitability endpoint (sell − supplier cost − paid refunds, per
      the spec's Provisional/Final Profit formula). Nothing in
      `server/lib/ai/` imports the GL module — the AI workforce has no
      path to alter a ledger entry, per the master spec's AI Security
      principle. New **Accounting / GL** dashboard tab; the Bookings tab
      gains traveler management and a typed-service form with per-type
      detail fields. Verified end-to-end via curl (full lifecycle: typed
      booking → invoice → payment → PO → payroll → refund → all four GL
      reports, confirmed balanced) and Playwright (both new UI surfaces).
- [x] **Phase 12 — Supplier management + document management**: `vendors`
      gains TRN, currency, payment terms, contract dates, address/website
      and an active/inactive status, plus travel-specific categories
      (airline/hotel/DMC/tour operator/visa partner/transfer company/
      attraction supplier/insurance company) alongside the original
      procurement ones. New `supplier_contacts` (multiple contacts per
      supplier) and `supplier_rates` (a real rate card: service type,
      cost, validity window) tables, plus a computed performance endpoint
      (spend and PO count, services actually fulfilled from
      `booking_items.supplier_id`, refunds received) — no separate
      tracking table, it's all derived from data these modules already
      write. A generic `documents` module (`server/lib/documents.js`,
      `server/routes/documents.routes.js`) gives every entity type
      (customer, employee, supplier, traveler, booking, visa document)
      real file storage on local disk under `server/data/documents/`
      (never served statically — only reachable through the authenticated
      download route), with expiry-date tracking for passports/Emirates
      IDs/visas and an `/api/documents/expiring` endpoint. New
      **Documents** widget embedded in the Employees and Suppliers
      (Procurement) tabs; the Suppliers list gained a full detail view
      (contacts, rate card, performance, contract documents, editable
      details). Along the way, fixed a real bug in this phase's own first
      draft: zod's `.partial()` does not clear a field's `.default()`, so
      a PATCH that omitted `category`/`currency` (vendors) or
      `travelerType` (travelers) was silently resetting them — caught by
      testing a partial update and comparing before/after, fixed by
      moving the defaults out of the shared schema and into the POST
      handlers only. Verified end-to-end via curl (supplier CRUD,
      contacts, rates, performance, document upload/download/delete,
      expiring-documents query) and Playwright (Suppliers and Employees
      document UI, including a real file upload through the browser).
