# Elite Escape — Gap Analysis

Comparing `ELITE_ESCAPE_MASTER_SPEC.md` (target) against
`ELITE_ESCAPE_CURRENT_STATE.md` (what's actually built and verified today).

## 0. The one gap that determines everything else

**The master spec mandates a technology stack the current platform does not
use.** Spec: Next.js + React + TypeScript + NestJS + PostgreSQL +
Drizzle/Prisma + Redis + BullMQ + pgvector + S3 + React Native + Docker/
CI-CD. Current platform: Express + `node:sqlite` + vanilla HTML/CSS/JS, no
build step, no queue, no object storage, no containers.

This is not a "gap" that gets closed by adding features on top of what
exists — it's a fork in the road:

- **Rewrite path:** treat the spec's stack as binding, start a new
  NestJS/Next.js/Postgres codebase, and either port or retire the 8 phases
  already shipped to `eliteescape2`. This is the only way to get the
  spec's Redis/BullMQ background jobs, pgvector search, S3 documents, and
  React Native apps, since none of those have an equivalent in `node:
  sqlite` + Express.
- **Extend path:** keep the current stack, and close feature gaps
  (double-entry ledger, visa cases, quotations, supplier bookings,
  document storage, etc.) within it. SQLite can be swapped for Postgres
  later without a full rewrite if the schema is designed with that in
  mind; a real queue can replace the in-memory rate limiter later; but
  NestJS/Next.js/React Native are not incremental additions to an Express+
  vanilla-JS codebase — they're a different frontend and backend
  framework entirely.

Every other line item below assumes one of these two paths is chosen
first. **This decision needs the client's explicit sign-off before any of
Phases 9+ below are started** — it determines whether "Phase 9" means "add
a table to the existing SQLite schema" or "stand up a new Postgres+NestJS
service."

---

## 1. Platform Foundation (spec §6-7)

| Item | Status | Note |
|---|---|---|
| Organization/tenant model | **Missing** | Single implicit tenant; no `organizations`, `branches`, `departments` tables |
| Roles (owner/admin/sales/ops/finance/hr/marketing) | **Partial** | 7 of the spec's 13 roles exist; no Sales Manager vs. Travel Consultant distinction, no Visa Executive, no Read-only Auditor |
| Custom roles | Missing | Roles are a fixed seed list |
| MFA | Missing | Password + session cookie only |
| Record-level / field-level permissions | Missing | Permissions are module-level (`crm.read` sees all leads, not "my leads") |
| Session/device revocation | **Exists** | Built in Phase 8 — admin can force-revoke a user's sessions |
| Audit logging | **Exists** | `audit_log` table, populated since Phase 1, full viewer added Phase 8 |
| Approval permissions (workflow gates) | Missing | No approval-required action exists anywhere (e.g. refunds, high-value discounts) |

## 2. CRM (spec §8-10)

| Item | Status | Note |
|---|---|---|
| Lead sources | **Partial** | website/whatsapp/referral/walk-in exist as free-text `source`; no per-source connector, no Elite Reach source |
| Lead pipeline | **Partial** | 5 statuses (new/contacted/quoted/won/lost) vs. spec's 11-status pipeline with separate Lost/Cancelled/On Hold/Invalid/Duplicate |
| Opportunity as distinct stage | Missing | Lead goes straight to won/lost, no separate "qualified opportunity" entity |
| Quotation system with versioning | **Missing** | No quotation entity at all — bookings are created directly, with no quote/accept step |
| Customer 360 | **Partial** | Customer record + linked leads/bookings/invoices/conversations exists; no consent tracking, no "assigned consultant" field |

## 3. Travel ERP (spec §11-18)

| Item | Status | Note |
|---|---|---|
| Booking with unique reference | **Partial** | `bookings` table exists but has no human-readable reference number (unlike invoices/POs, which do) |
| Separate service types (flight/hotel/transfer/attraction/insurance) | **Missing** | One generic `booking_items` free-text line-item table, not typed service tables with their own fields (route, check-in date, supplier, confirmation number) |
| Traveler records | **Missing** | No travelers distinct from the customer — no passport, DOB, nationality fields anywhere |
| Holiday package master data | **Missing** | No `holiday_packages` catalog — the website has static package pages, but nothing in the platform database represents them as sellable, prices-and-inventory-tracked products |
| Multiple statuses (customer/commercial/supplier/operational/payment) | **Missing** | Bookings have one `status` field |

## 4. Visa Case Management (spec §19)

| Item | Status |
|---|---|
| Everything | **Missing.** Visa is currently just one `interest_type` value on a lead. No case entity, no applicant, no document checklist, no status history, no appointment tracking. This is a from-scratch module. |

## 5. Supplier Management (spec §20)

| Item | Status | Note |
|---|---|---|
| Supplier profile | **Partial** | `vendors` table exists (generic procurement, Phase 5) — name/contact/category/email/phone only, no rates, no contract terms, no currency/payment terms |
| Supplier quotations/reservations | Missing | No linkage between a vendor and a specific booking's service |
| Supplier bills/payables | Missing | Only `purchase_orders` (generic spend, not booking-linked) exist — no AP ledger |
| Supplier performance tracking | Missing | — |

## 6. Accounting (spec §21-24)

| Item | Status | Note |
|---|---|---|
| Customer invoicing | **Exists** | Sequential numbering, 5% VAT calc, payment recording, auto-paid-status |
| Double-entry GL (chart of accounts, journals, trial balance, P&L, balance sheet) | **Missing** | Current accounting is invoice/payment tracking only — there is no ledger at all |
| Decimal money arithmetic | **Gap** | Money stored as SQLite `REAL` (floating point) — spec explicitly requires fixed-point decimal; this needs fixing regardless of which stack path is chosen |
| Multicurrency / FX | Missing | Everything is AED-only |
| Bank reconciliation | Missing | — |
| Supplier bills / payables | Missing | (see §5) |
| Refunds / credit notes / debit notes | Missing | No refund entity — a "refund" today would have to be a manual negative payment, which isn't supported |
| Booking profitability (provisional vs. final) | Missing | No cost-vs-revenue calculation exists per booking |
| UAE VAT — TRN, tax codes, credit notes, VAT reporting | **Partial** | Flat 5% rate is applied; no TRN capture, no tax-code table, no VAT return report |
| UAE eInvoicing (FTA ASP integration) | **Missing** | Invoices are internal-only records; nothing is submitted to any authority. This requires a real accredited ASP account — a client/business decision, not just code |

## 7. HRMS / Payroll (spec §25-26)

| Item | Status | Note |
|---|---|---|
| Employee records | **Exists** | Job title, department, salary, join date, status |
| Attendance / shifts | Missing | — |
| Leave | **Exists** | Request/approve/reject, auto-flips employee status |
| Employee documents (passport, Emirates ID, visa, expiry alerts) | Missing | No document storage module exists for anyone (employees, customers, or suppliers) |
| Payroll | **Exists** | Draft → processed → paid, editable payslips, correct locking |
| End-of-service calculation | Missing | — |
| Performance / training / onboarding | Missing | — |

## 8. AI Workforce (spec §31-32)

| Item | Status | Note |
|---|---|---|
| AI Receptionist | **Exists** | Real tool-use, functional in mock mode |
| AI Travel Consultant | **Exists** | Same |
| AI Visa Assistant | Missing | No visa case data exists to ground it in |
| AI Sales/Operations/Finance/Marketing/Executive Assistants | Missing | 5 of 8 spec'd agents don't exist |
| Real LLM connection | **Built but unverified** | `anthropic` provider path is fully coded (tool-use loop against the Messages API) but has never run — no API key available in this environment |
| Approval gate for high-risk AI actions | **Partial** | The existing tools are all low-risk by design (create lead, read summary, flag human) so this hasn't been needed yet — a Finance Assistant that drafts reminders or a Sales Assistant that drafts quotations would need this before going live |
| AI usage/cost tracking | Missing | — |

## 9. Communications (spec §34-35)

| Item | Status | Note |
|---|---|---|
| Email sending | **Stubbed** | `console` provider only — logs to stdout, no real SMTP/SendGrid/SES |
| WhatsApp | **Missing** | No WhatsApp Business API integration at all — the website's "WhatsApp" links are just `wa.me` deep links, not an API integration; this requires a Meta Business account and WhatsApp Business API access, a client-side credential/account decision |
| Owner WhatsApp Assistant (natural-language Q&A) | Missing | Depends on WhatsApp integration existing first |
| In-app notifications | **Exists** | Since Phase 2 |
| Push notifications | Missing | No mobile app to push to |

## 10. Elite Reach (spec §36-53)

**Entirely missing — confirmed no such code exists in any repo accessible
to this project.** This is a from-scratch, ~18-section system (source
connectors, signal pipeline, intent graph, scoring, decay, opportunity
classification, content-gap engine, product-opportunity engine, demand
radar, market triggers, engagement copilot, reputation engine, CRM sync,
attribution, feedback loop, strategy engine). It is realistically the
single largest module in the entire spec, and carries real legal/ToS risk
(most social platforms' terms of service restrict automated scraping of
public content for commercial lead generation — this needs a legal review
before any connector is built, not just an engineering one).

## 11. Marketing (spec §54-58)

| Item | Status | Note |
|---|---|---|
| Campaigns (email/WhatsApp) | **Exists** | Console-provider sends only, not real delivery |
| SEO auditing | **Exists** | Real, dependency-free crawler; verified against the live site |
| Content calendar | **Exists** | — |
| AEO/AIO/GEO tooling | Missing | — |
| Search Console integration | Missing | Needs a Google account + API credentials |
| Social scheduling/publishing | Missing | Needs per-platform API credentials (Meta, TikTok, YouTube) |
| Paid ads integration | Missing | Needs Google Ads / Meta Ads API credentials |
| Attribution beyond campaign sends | Missing | No visitor/session tracking exists on the website |

## 12. Portals (spec §27-29)

**All three missing.** There is exactly one UI today — the internal admin
dashboard. Customers and suppliers have no login of any kind.

## 13. Mobile (spec §59)

**Missing — explicitly deferred by the client's own decision earlier in
this project**, because this sandbox has no Xcode/Android Studio/emulator
to build or verify against. Still true today; unchanged by this spec.

## 14. Document Management (spec §60)

**Missing entirely.** No file upload exists anywhere in the platform — not
for visa documents, employee documents, customer documents, or supplier
documents. This blocks large parts of §12 (traveler passports), §19 (visa
documents), §25 (employee documents), and the customer/supplier portals.
Requires object storage (S3-compatible), which the current stack has no
equivalent for.

## 15. Task Management (spec §61)

**Missing.** No generic task/subtask/assignment entity exists. The closest
analogues are single-purpose: leave requests, purchase-order approvals,
lead follow-up activities — none of which is a general task system other
modules can create tasks in.

## 16. Reporting / BI (spec §63)

**Partial.** The Phase 8 metrics endpoint gives point-in-time counts
(open leads, revenue this month, pending approvals) but none of the
spec's actual reports (conversion funnels, destination performance,
consultant performance, cancellation analysis) exist as queryable,
exportable reports.

## 17. Global Search (spec §64)

**Missing.** Each module has its own list/filter UI; there's no
cross-entity search.

## 18. Backups / Monitoring (spec §66-67)

| Item | Status | Note |
|---|---|---|
| Automated backups | Missing | SQLite file exists on local disk only, no backup job, no offsite copy |
| Restore-tested DR procedure | Missing | — |
| Request/error monitoring | **Exists** | In-memory counters from Phase 8 — adequate for a single process, not a substitute for real APM |
| Queue/worker/connector health | N/A | No queue or workers exist yet |

## Summary by spec phase (§74)

| Spec phase | Status |
|---|---|
| 1. Foundation | Partial — auth/RBAC/audit exist; org/tenant model, MFA, field-level perms don't |
| 2. CRM | Partial — leads/customers exist; opportunities and quotations don't |
| 3. Travel ERP | Partial — generic bookings exist; typed services, travelers, packages don't |
| 4. Visa | Missing |
| 5. Finance | Partial — invoicing/VAT exist; GL, payables, refunds, eInvoicing don't |
| 6. HRMS | Partial — employees/leave/payroll exist; attendance, documents don't |
| 7. Automation | Partial — a few auto-transitions exist (lead→won, leave→on_leave); no general workflow engine |
| 8. AI | Partial — 2 of 8 agents exist, real LLM path unverified |
| 9. WhatsApp | Missing |
| 10. Elite Reach | Missing |
| 11. Marketing | Partial — SEO auditor + campaigns exist; AEO/social/ads don't |
| 12. Portals | Missing |
| 13. Mobile | Missing (deferred by client decision) |
| 14. Production hardening | Partial — security fixes + audit + basic monitoring exist (Phase 8); backups, CI/CD, Docker, real test suite don't |

No phase is at 100%. Phases 1, 2, 5, 6, 8, 11, 14 have real, working partial
implementations worth preserving regardless of which architecture path is
chosen. Phases 4, 9, 10, 12, 13 are entirely greenfield.
