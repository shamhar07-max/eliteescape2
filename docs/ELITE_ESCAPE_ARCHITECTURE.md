# Elite Escape — Architecture Decision

This document exists to get one decision made explicitly before any more
code is written: **which stack does the platform move forward on?** See
`ELITE_ESCAPE_GAP_ANALYSIS.md` §0 for why this can't be answered
implicitly.

## Option A — Rewrite on the spec's mandated stack

Next.js/React/TypeScript frontend, NestJS backend, PostgreSQL +
Drizzle-or-Prisma, Redis/BullMQ for background jobs, pgvector for AI
search, S3-compatible object storage, React Native mobile apps, Docker +
CI/CD across dev/staging/production.

**What this buys:** everything the spec assumes is possible at scale —
real background job processing (visa reminder emails, scheduled reports,
AI batch runs), typed end-to-end APIs (OpenAPI + generated client), a
real relational database with proper transactions and constraints beyond
what SQLite offers for concurrent multi-user write load, vector search
for AI knowledge retrieval, file storage for the entire document-
management module, and a path to real mobile apps.

**What it costs:**
- The 8 phases already built and running on `eliteescape2` (CRM,
  bookings/invoicing, HR/payroll, procurement, 2 AI agents, marketing
  campaigns, SEO auditor, platform admin — all tested end-to-end) get
  either retired or painstakingly ported. Nothing here auto-migrates:
  different language runtime idioms (Express handlers → NestJS
  controllers/modules/DI), different query layer (raw SQL → Drizzle/
  Prisma schema + migrations), different frontend paradigm entirely
  (server-rendered vanilla JS → React component tree with client-side
  state management).
- Real infrastructure this sandbox does not have and cannot provision on
  its own: a running PostgreSQL instance, Redis, S3-compatible storage,
  a container registry, CI/CD runners, and separate staging/production
  environments. Some of this can be simulated locally (e.g. Postgres and
  Redis can run in-process for dev), but "Docker + CI/CD +
  dev/staging/production" as stated is an infrastructure/DevOps
  commitment, not something this conversation can complete unilaterally.
- Mobile apps still can't be built *or verified* here — no Xcode/Android
  Studio/emulator — regardless of React Native vs. anything else. That
  constraint is independent of the backend stack choice.
- This is realistically many weeks to months of focused engineering work
  for the scope in the spec (79 sections, ~55 database tables, 3 mobile
  apps, an entirely new demand-intelligence subsystem). It should be
  planned and delivered in real phases with real review points, not
  attempted as one continuous session.

## Option B — Extend the current stack

Keep Express + SQLite + vanilla JS as the foundation. Close the feature
gaps in `ELITE_ESCAPE_GAP_ANALYSIS.md` module by module: add quotations,
visa cases, typed travel services, a real (if simpler) double-entry ledger
with decimal arithmetic, supplier bookings, document storage (even a
local-disk-backed one to start), and the remaining AI agents — all within
the existing architecture.

**What this buys:** continuity with 8 phases of already-shipped, tested
work; every new module follows a proven, working pattern (schema.js →
routes with `auth()` middleware → vanilla-JS admin tab), so progress stays
incremental and each piece stays independently verifiable the same way
every phase so far has been (curl + Playwright, real data, real
screenshots).

**What it costs:** this stack genuinely cannot do some things the spec
wants without workarounds — no real background job queue (the in-memory
rate limiter and console-log providers are a ceiling, not a foundation, for
scheduled reminders/digests at real volume), no vector search for AI
knowledge retrieval, no path to React Native mobile apps (a mobile app
needs a real API to call, which this can provide, but the app itself is a
separate codebase either way). SQLite is fine for single-tenant, moderate
write volume; it is not what a client-delivery "production-ready" claim
for a multi-user ERP would typically rest on.

## Recommendation

**Hybrid, decided per-module rather than all-or-nothing:**

1. Treat Option B as the default for anything that is a straightforward
   data-model + CRUD extension of what exists — quotations, visa cases,
   typed travel services, supplier bookings, a real decimal-based ledger.
   These don't need Postgres/Redis/React to be correct; they need correct
   schema design and the same phase-by-phase discipline already used.
2. Treat Option A's individual pieces as targeted additions, not a
   simultaneous full-stack swap, when a feature genuinely needs them:
   e.g. add real object storage (S3-compatible) specifically for document
   management rather than migrating the whole app to get it; add a real
   queue specifically for scheduled WhatsApp/email reminders rather than
   rewriting the API layer in NestJS to get it.
3. Money must move to decimal arithmetic regardless of path — this is a
   correctness bug today (SQLite `REAL`/floating point for AED amounts),
   not a stack question, and should be fixed early either way.
4. Mobile apps remain out of scope for this environment specifically
   (no build/verify toolchain) independent of backend framework — that
   constraint doesn't change by picking NestJS over Express.
5. Elite Reach and UAE eInvoicing both have non-engineering prerequisites
   (legal review for social scraping ToS; an accredited ASP account for
   eInvoicing) that block real implementation regardless of stack — flag
   these to the client now rather than building against assumptions.

**This is a recommendation, not a decision.** The client should confirm
before Phase 9 (visa case management, next in the spec's own phase order)
starts, since building it correctly depends on knowing whether the target
database is SQLite or PostgreSQL.
