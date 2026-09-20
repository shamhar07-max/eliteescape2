# Elite Escape — Roadmap

Reconciles the master spec's 14 phases (§74) with the 8 phases already
built and shipped under the *previous* project framing (this repo's
`README.md` roadmap), and proposes a realistic path forward. **Everything
past "Decision point" below is provisional on the architecture choice in
`ELITE_ESCAPE_ARCHITECTURE.md`.**

## Where things actually stand

| Spec phase | Prior project's equivalent phase | Status |
|---|---|---|
| 1. Foundation | Phase 1 (Foundation) | Partial — see Gap Analysis §1 |
| 2. CRM | Phase 2 (CRM UI) | Partial — see Gap Analysis §2 |
| 3. Travel ERP | Phase 3 (Travel Operations) | Partial — see Gap Analysis §3 |
| 4. Visa | — | Not started |
| 5. Finance | Phase 3 (Accounting core) | Partial — invoicing exists, no GL — see Gap Analysis §6 |
| 6. HRMS | Phase 5 (HRMS/Payroll) | Partial — see Gap Analysis §7 |
| 7. Automation | — (a few ad-hoc auto-transitions exist) | Minimal |
| 8. AI | Phase 4 (AI employees) | Partial — 2 of 8 agents — see Gap Analysis §8 |
| 9. WhatsApp | — | Not started (needs BSP account — see Integration Map) |
| 10. Elite Reach | — | Not started (needs legal review — see Integration Map) |
| 11. Marketing | Phase 7 (Marketing/SEO) | Partial — see Gap Analysis §11 |
| 12. Portals | — | Not started |
| 13. Mobile | — (explicitly deferred, Phase 6 of prior framing) | Deferred — no build/verify toolchain in this environment |
| 14. Production hardening | Phase 8 (Platform admin) | Partial — security + audit + basic monitoring exist; backups/CI-CD/Docker/tests don't |

**Nothing is at zero, and nothing is at done.** The realistic framing is:
close out the partials before adding the fully-missing modules, since a
"Visa Case" module built on top of an incomplete CRM/quotation flow would
just create more rework later.

## Decision point (blocking)

Before any further phase starts: which architecture path from
`ELITE_ESCAPE_ARCHITECTURE.md` — extend the current Express+SQLite stack,
or begin the NestJS+Postgres rewrite the spec mandates? This changes what
"next phase" means concretely (a SQLite migration vs. a new service).

## Proposed sequence once the decision is made

Following the spec's own Critical Build Rule (§77) — one module at a time,
real backend, real frontend, real tests, real scenario, then continue —
and its Definition of Done (§75):

1. **Decimal money fix** — correctness bug, blocks everything financial,
   independent of architecture choice. Do this first regardless.
2. **Quotations + Opportunities** — completes the CRM pipeline the spec
   requires (§8-10) and is the prerequisite for a proper booking flow
   (quote accepted → booking, not booking created directly).
3. **Typed travel services + travelers** — replaces the generic
   `booking_items` free-text lines with real Flight/Hotel/Transfer/
   Attraction/Insurance/Package records and traveler entities (§11-18).
4. **Visa case management** (§19) — greenfield module, now has real
   customer/booking data to attach to.
5. **General ledger / double-entry accounting** (§21-22) — the current
   invoice/payment tracking becomes the AR side of a real ledger; add AP
   (supplier bills), refunds, and booking profitability calculation.
6. **Supplier management** (§20) — rates, contract terms, supplier
   bookings linked to specific travel services, supplier bills feeding
   the new AP ledger.
7. **Document management** (§60) — needs object storage decided first
   (Integration Map); unblocks visa documents, employee documents,
   traveler passports.
8. **Remaining AI agents** (§31) — Visa/Sales/Operations/Finance/
   Marketing/Executive Assistants, each gated by the approval-workflow
   pattern noted in `ELITE_ESCAPE_SECURITY_MODEL.md` where they touch
   money or send anything external.
9. **WhatsApp integration** (§34-35) — after a BSP account is chosen
   (Integration Map).
10. **UAE VAT hardening + eInvoicing** (§23-24) — after an ASP account is
    chosen (Integration Map).
11. **Portals** (§27-29) — customer, employee, supplier — each is mostly
    a read-scoped view over data that now exists from steps 2-7.
12. **Elite Reach** (§36-53) — after the legal/ToS review (Integration
    Map) scopes which sources are actually usable; likely the largest
    single module in the entire spec.
13. **Marketing expansion** (§54-58) — AEO/GEO tooling, social scheduling,
    paid ads — each gated by its own platform credentials.
14. **Mobile apps** (§59) — stays deferred in this environment
    specifically; can proceed elsewhere once a stack decision is made,
    since the backend API these apps call is the same regardless of where
    they're built.
15. **Production hardening** (§14/§66-68) — backups with tested restores,
    real CI/CD, Docker, and a real automated test suite (unit/integration/
    E2E/security/accessibility per §72) — some of this (audit logging,
    RBAC, basic monitoring) is already done from the prior Phase 8 and
    doesn't need repeating, but backups/CI-CD/Docker/tests are all new.

## What this roadmap deliberately does not do

It does not promise dates or effort estimates — the spec's own scope (79
sections, ~55 database tables, 8 AI agents, an entirely new demand-
intelligence subsystem, 3 mobile apps, multiple third-party integrations
each requiring a separate account/legal decision) is large enough that
committing to a timeline before the architecture decision and the
integration prerequisites are resolved would be a guess, not a plan.
