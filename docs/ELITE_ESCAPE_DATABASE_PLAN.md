# Elite Escape — Database Plan

Maps the spec's target table list (§69) against the current SQLite schema
(`server/schema.js`). Assumes Option B/hybrid from
`ELITE_ESCAPE_ARCHITECTURE.md` unless the client picks the full rewrite —
if Postgres is chosen instead, every "exists" row below still describes
the correct target shape, just in a different engine + ORM.

## Legend
- **Exists** — table is in `schema.js` today, in current use
- **Rename/reshape** — a table exists but doesn't match the target shape
- **New** — no equivalent exists

| Spec table | Status | Note |
|---|---|---|
| `organizations` | New | No tenant model at all today |
| `branches` | New | — |
| `departments` | New | `employees.department` is a free-text enum column, not a table |
| `users` | Exists | `users` — email, password_hash, full_name, role_id, is_active |
| `roles` | Exists | 7 seeded roles vs. spec's 13 |
| `permissions` | Exists | Module-level codes (`crm.read` etc.), no record/field-level model |
| `employees` | Exists | Missing attendance, documents, performance, training fields |
| `customers` | Exists | — |
| `contacts` | New | No separate contacts-per-customer (e.g. corporate account with multiple travelers) |
| `leads` | Exists | 5-status pipeline vs. spec's 11 |
| `opportunities` | New | Leads go straight to won/lost; no intermediate opportunity stage |
| `activities` | Exists | `lead_activities` — timeline notes on a lead |
| `quotations` | New | No quote entity — bookings are created directly |
| `quotation_versions` | New | Depends on `quotations` existing first |
| `travelers` | New | No traveler records distinct from the customer |
| `travel_bookings` | Rename/reshape | `bookings` exists but is generic (one `booking_type` enum + free-text `booking_items`), no reference number, no per-stage status split |
| `booking_services` | Rename/reshape | `booking_items` exists but is untyped free-text lines, not typed per-service records |
| `holiday_packages` | New | No package catalog in the database — packages exist only as static website content |
| `flight_services` | New | — |
| `hotel_services` | New | — |
| `transfer_services` | New | — |
| `attraction_services` | New | — |
| `insurance_services` | New | — |
| `visa_cases` | New | Entire module missing |
| `visa_applicants` | New | — |
| `visa_documents` | New | — |
| `suppliers` | Rename/reshape | `vendors` exists (Phase 5 procurement) but is generic, not travel-supplier-specific (no rates, contract terms) |
| `supplier_rates` | New | — |
| `supplier_bookings` | New | No link between a vendor and a specific booking service |
| `supplier_bills` | New | Only generic `purchase_orders` exist, not booking-linked payables |
| `invoices` | Exists | Sequential numbering, VAT calc — solid foundation, but `REAL` money columns need to move to fixed-point/decimal |
| `invoice_lines` | Exists | `invoice_items` |
| `payments` | Exists | Linked to invoices; no distinction between deposit/balance/advance |
| `refunds` | New | No refund entity — would currently be modeled as a manual negative payment, which isn't supported |
| `journals` | New | No general ledger at all |
| `journal_entries` | New | — |
| `accounts` (chart of accounts) | New | — |
| `attendance` | New | — |
| `leave` | Exists | `leave_requests` |
| `payroll` | Exists | `payroll_runs` + `payslips` |
| `documents` | New | No file/document storage module exists for any entity |
| `tasks` | New | No generic task system |
| `notifications` | Exists | In-app only; no push (no mobile app), no WhatsApp delivery |
| `audit_events` | Exists | `audit_log` |
| `reach_connectors` | New | Elite Reach doesn't exist |
| `reach_campaigns` | New | — |
| `reach_signals` | New | — |
| `reach_journeys` | New | — |
| `reach_intents` | New | — |
| `reach_opportunities` | New | — |
| `reach_engagements` | New | — |
| `marketing_campaigns` | Exists | `campaigns` (Phase 7) — email/WhatsApp only, console-provider sends |
| `content_items` | Exists | `seo_content_items` (Phase 7) — SEO content calendar |
| `seo_tasks` | Partial | Folded into `seo_content_items` today rather than a separate task type; `seo_audits`/`seo_audit_pages` also exist for the auditor |
| `social_posts` | New | — |
| `ad_campaigns` | New | — |
| `ai_agents` | Partial | Agent definitions live in code (`lib/ai/agents.js`), not a database table — fine for 2 agents, worth moving to a table if the full 8-agent roster is built |
| `ai_runs` | New | Conversation/message history exists (`conversations`/`messages`) but there's no per-tool-call run log or cost tracking |
| `ai_feedback` | New | — |
| `ai_usage` | New | — |

## Tables that exist today with no equivalent in the spec's list

`counters` (atomic sequence generator for invoice/PO numbering — an
implementation detail, not a business entity, so absence from the spec's
list is expected and fine to keep either way).

## Immediate correctness fix, independent of stack decision

All money columns (`bookings`/`invoices`/`payslips`/`purchase_orders`/etc.)
are SQLite `REAL` — IEEE 754 floating point. The spec is explicit
("Do not use floating point for money. Use decimal arithmetic.") and this
is simply correct: floating point can misrepresent currency amounts after
enough arithmetic. Fix path: store money as integer minor units (fils,
1 AED = 100 fils) or as fixed-point decimal strings, with all arithmetic
going through a shared helper rather than native `+`/`-`/`*`. This should
happen before the accounting/GL module is built, not after, since every
new financial table would otherwise inherit the same bug.

## Migration sequencing if Option A (Postgres) is chosen

1. Stand up Postgres + chosen ORM (Drizzle or Prisma) with schema derived
   from the "Exists"/"Rename/reshape" rows above first — this recreates
   current functionality on the new engine before adding anything new.
2. Port existing route logic module by module (auth → CRM → ops/
   accounting → HR/payroll/procurement → AI → marketing/SEO → admin),
   verifying each against the same curl/Playwright checks used originally,
   before starting on any "New" table.
3. Only then start the genuinely new modules (visa, quotations, typed
   travel services, supplier bookings, GL, Elite Reach, portals) —
   building them against Postgres from day one rather than retrofitting
   SQLite versions.
