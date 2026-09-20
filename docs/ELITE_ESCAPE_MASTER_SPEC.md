# Elite Escape — Master Spec (target vision, as given)

> **Status note:** this document records the target vision exactly as
> specified by the client on 2026-09-20. It is the north star, not a
> description of what exists today — see `ELITE_ESCAPE_CURRENT_STATE.md` for
> the actual system, and `ELITE_ESCAPE_GAP_ANALYSIS.md` for the itemized gap
> between this spec and that reality. This spec mandates a technology stack
> (Next.js/NestJS/PostgreSQL/Redis/React Native/Docker) that is a full
> rewrite relative to the Express+SQLite+vanilla-JS platform built across
> Phases 1–8 of this project — that conflict is the single largest item in
> the gap analysis and needs an explicit decision before any of the sections
> below are built against it.

---

## 1. Project Identity

Client: Elite Escape Tourism — Dubai, UAE. Travel, tourism, holiday
packages, visa assistance, UAE attractions, flights, hotels, transfers,
travel insurance, corporate and customized travel planning.

The system combines: public website, CRM, travel ERP, visa case management,
customer/supplier management, accounting, UAE VAT, UAE eInvoicing
architecture, HRMS, payroll, document management, customer/supplier
portals, owner dashboard, workflow automation, AI employees, an AI
Executive Assistant, WhatsApp automation, email automation, Elite Reach
demand intelligence, SEO/AEO/AIO/GEO, social media management, paid
advertising, marketing analytics, customer/employee/owner mobile apps,
reporting/BI, platform administration, security, backups, monitoring, and
client-delivery documentation — as one connected system.

## 2. Core Business Principle

Data enters once and flows through its lifecycle:

```
Website Inquiry → CRM Lead → Qualified Opportunity → Travel Quotation →
Customer Acceptance → Travel Booking → Supplier Reservations →
Visa Processing → Customer Invoice → Payment → Booking Operations →
Travel Completion → Supplier Bills → Final Profitability →
Customer Follow-Up → Marketing Attribution
```

No re-entering the same information across unrelated systems.

## 3. Required Technology Stack

- **Frontend:** Next.js, React, TypeScript, Tailwind CSS, Radix UI,
  TanStack Query, TanStack Table, React Hook Form, Zod, Apache ECharts,
  Motion, next-intl
- **Backend:** NestJS, TypeScript, REST APIs, OpenAPI
- **Database:** PostgreSQL
- **ORM:** Drizzle **or** Prisma — pick one, don't mix without documented
  justification
- **Background processing:** Redis, BullMQ
- **AI/NLP:** provider-independent AI gateway; Python workers only for
  NLP/embeddings/classification/document extraction/AI evaluations
- **Vector search:** PostgreSQL + pgvector
- **Object storage:** S3-compatible
- **Search:** start with PostgreSQL search; add OpenSearch only when
  justified
- **Mobile:** React Native, TypeScript
- **Deployment:** Docker, CI/CD, dev/staging/production environments,
  modular monolith first (no premature microservices)

## 4. Existing Elite Escape Website

Preserve and deeply audit the existing website — logo, favicon, brand
identity, destination/package/visa/guide content, existing SEO value, and
URLs. Do not replace with a generic template or delete pages to simplify
development. Upgrade it into the public acquisition layer of the full OS.

## 5. System Architecture

```
Elite Escape OS
├── Acquisition (Website, Elite Reach, SEO/AEO/AIO/GEO, Social, Paid Ads)
├── CRM (Leads, Opportunities, Customers, Follow-Ups, Quotations, Comms)
├── Travel ERP (Packages, Flights, Hotels, Transfers, Attractions,
│               Insurance, Corporate, Custom)
├── Visa Operations (Cases, Applicants, Documents, Appointments,
│                     Submission Tracking, Case Updates)
├── Finance (Accounting, VAT, eInvoicing, Receivables, Payables, Refunds,
│            Profitability)
├── HRMS (Employees, Attendance, Leave, Payroll, Documents, Performance)
├── AI Workforce (Receptionist, Travel Consultant, Visa Assistant, Sales
│                  Assistant, Operations Assistant, Finance Assistant,
│                  Marketing Assistant, Executive Assistant)
├── Communications (WhatsApp, Email, Website Chat, Push, Internal)
├── Portals (Customer, Employee, Supplier, Management)
└── Intelligence (Elite Reach, Owner Dashboard, Demand Radar, Revenue
                   Attribution, Marketing Attribution, AI Strategy Engine)
```

## 6. Platform Foundation

Organization as tenant: legal entity, branch, department, team, employee,
user, role, permission, business/currency/language/tax/communication/brand
settings.

Core roles: Business Owner, Administrator, Sales Manager, Travel
Consultant, Visa Executive, Operations Manager, Finance Manager,
Accountant, HR Manager, Marketing Manager, Customer Support, Employee,
Read-only Auditor. Custom roles allowed.

## 7. Authentication and Security

Secure login, password reset, MFA, session management, device/session
revocation, role-based + record-level + field-level access, approval
permissions, audit logging. Sensitive data: passport, Emirates ID, visa
documents, customer financial info, supplier rates, salary, payroll, bank
details, payment records. Enforce permissions server-side only, never rely
on frontend hiding.

## 8. CRM

Lead sources: website, WhatsApp, email, phone, Instagram, Facebook, TikTok,
YouTube, Google Ads, Meta Ads, Elite Reach, referral, repeat customer,
walk-in, corporate.

Lead types: holiday, flight, hotel, visa, transfer, attraction, insurance,
corporate travel, group travel, honeymoon, family travel, custom itinerary.

Pipeline: New Inquiry → Assigned → Contacted → Requirements Collected →
Quote Preparing → Quote Sent → Negotiation → Accepted → Booking In Progress
→ Confirmed → Completed. Plus: Lost, Cancelled, On Hold, Invalid,
Duplicate. Sales status and travel operational status are kept separate.

## 9. Customer 360 Profile

ID, name, contacts, email, preferred channel, nationality/residency where
needed, communication/marketing consent, full inquiry/quotation/booking/
visa/payment/support history, notes, assigned consultant. Collect only
identity information that's actually required.

## 10. Travel Quotation System

Version-controlled quotations: destination, dates, travelers (adults/
children/infants), hotel/flight/transfers/attractions/visa/insurance,
supplier cost, selling price, discounts, service fees, currency, validity,
payment terms, inclusions/exclusions/cancellation terms. Maintain
revisions; never overwrite an accepted quotation; accepted → creates a
booking.

## 11. Travel Booking ERP

Unique booking reference per confirmed trip, connecting customer,
travelers, original inquiry, accepted quotation, consultant, ops owner,
suppliers, services, documents, invoices, payments, refunds, profitability.
Separate statuses: customer, commercial, supplier-confirmation,
operational, payment.

## 12. Traveler Management

Multiple travelers per booking: name, DOB, gender where required,
nationality, passport + expiry, visa status, special assistance, dietary
needs, emergency contact, assigned services. Collect only what's
legitimately required; encrypt/restrict sensitive documents.

## 13. Holiday Package Management

Package master: destination, duration, hotel, flight inclusion, transfers,
activities, visa support, meals, insurance, price, supplier cost, validity,
availability, inclusions/exclusions/terms/cancellation. Types: standard,
seasonal, honeymoon, family, group, corporate, custom.

## 14. Flight Operations

Inquiries, route, dates, passenger count, supplier, fare quotation +
validity, booking reference, ticket status, schedule changes, cancellation,
refund, reissue, additional charges. Don't claim direct airline ticketing
without an authorized integration.

## 15. Hotel Operations

Request, destination, check-in/out, rooms, occupancy, guest details,
supplier, rate, confirmation, cancellation, refund, modification.

## 16. Transfer Management

Date, pickup/drop-off, vehicle, supplier, passenger count, driver details
where available, confirmation, service status, waiting, extra charges,
completion.

## 17. Attractions

Dubai/UAE attractions, destination excursions, theme parks, tours,
tickets, activities. Track supplier, date, travelers, cost, selling price,
booking reference, confirmation, cancellation, refund.

## 18. Travel Insurance

Customer, travelers, insurance supplier, coverage dates, policy reference,
premium, customer charge, status, documents. Don't represent Elite Escape
as the insurer unless applicable.

## 19. Visa Case Management

Independent case per applicant. Status: New → Documents Requested →
Documents Received → Internal Review → Ready for Submission → Submitted →
Appointment Required → Additional Documents Requested → Under Processing →
Decision Received → Completed. Plus: Rejected, Withdrawn, Cancelled.

Stores: applicant, destination country, visa type, checklist version,
required/missing documents, submission reference, appointment, fees, case
notes, responsible employee, status history. Never promise approval or
invent processing time.

## 20. Supplier Management

Categories: airlines, hotels, DMCs, tour operators, visa partners, transfer
companies, attraction suppliers, insurance companies. Track profile,
contacts, rates, contract terms, currency, payment terms, quotations,
purchase orders, reservations, bills, refunds, credits, performance.

## 21. Accounting

Deterministic double-entry: chart of accounts, general ledger, journal
entries, receivables, payables, customer invoices, supplier bills,
payments, advances, partial payments, credit/debit notes, refunds,
multicurrency + exchange differences, bank reconciliation, cash, cost
centers, financial periods, P&L, balance sheet, cash flow, booking
profitability. Decimal arithmetic only — never floating point for money.
Every posted journal balances. AI never directly alters ledger entries.

## 22. Travel-Specific Finance

Customer deposit, balance payment, supplier advance/final payment, late
supplier bill, customer/supplier refund, additional cost, cancellation/
amendment/service fee, FX difference. Per booking:

```
Provisional Revenue − Provisional Cost = Provisional Profit
Final Revenue − Final Supplier Cost − Refunds − Additional Expenses = Final Profit
```

## 23. UAE VAT

Configurable, not one-size treatment. Customer/supplier TRN, tax codes, tax
invoice, credit note, input/output tax, VAT reporting, tax-period
reconciliation. Maintain regulatory references and verification dates.

## 24. UAE eInvoicing

Integration architecture: structured invoice data, validation, ASP
integration, submission, status tracking, rejection handling, duplicate
prevention, retry logic, audit trail, accounting reconciliation. PDF
invoices are not compliant eInvoices — use an accredited ASP where
required.

## 25. HRMS

Employee records, department, position, reporting hierarchy, attendance,
shift, leave, documents (passport, Emirates ID, visa, expiry tracking),
expense claims, performance, training, onboarding/offboarding.

## 26. Payroll

Basic salary, allowances, deductions, attendance/leave input, payroll
period, payslip, approval, salary payment record, accounting posting,
end-of-service support where applicable. Validate UAE payroll requirements
separately.

## 27. Customer Portal

Own-records-only: profile, inquiries, quotations, bookings, itineraries,
visa cases, missing/uploaded documents, invoices, payments, support,
notifications. Never expose supplier rates, internal margins, employee
notes, other customers, or sensitive internal records.

## 28. Employee Portal

Assigned leads/customers, follow-ups, bookings, visa cases, tasks,
approvals, attendance, leave, expense claims, notifications.

## 29. Supplier Portal

Booking/confirmation requests, supplier quotations, reservation
references, invoice/credit-note upload, refund status, document exchange.
Restrict access — a hotel supplier must never see unrelated airline or
customer financial data.

## 30. Owner Command Center

New inquiries today, unassigned leads, hot opportunities, quotes sent,
confirmed bookings, upcoming departures, active visa cases, pending
supplier confirmations, receivables, payables, cash collected, booking
profitability, marketing leads, Elite Reach opportunities, attendance,
pending approvals, critical exceptions. Every metric clickable to its
underlying records.

## 31. AI Workforce

One platform, specialized agents:

- **AI Receptionist** — answer basic questions, capture inquiries, create
  leads, route customer.
- **AI Travel Consultant** — collect requirements, suggest approved
  packages, create inquiry, summarize requirements. Never invent live
  pricing.
- **AI Visa Assistant** — approved visa content, checklist, missing-doc
  detection, visa inquiry creation. Never guarantee approval.
- **AI Sales Assistant** — summarize lead, suggest follow-up, draft
  quotation, detect overdue lead.
- **AI Operations Assistant** — summarize active bookings, detect missing
  confirmations, flag upcoming departures, incomplete tasks.
- **AI Finance Assistant** — summarize verified finance data, overdue
  invoices, possible missing expenses, draft payment reminders. Never post
  entries independently.
- **AI Marketing Assistant** — campaign performance, draft concepts,
  content opportunities, destination campaign suggestions.
- **AI Executive Assistant** — answer owner questions, daily summary,
  exceptions, priorities.

## 32. AI Security

```
User → Authentication → Permission check → AI request → Tool selection →
Backend API → Business validation → Optional human approval → Action →
Audit log
```

AI never has unrestricted DB access. High-risk actions always require
approval.

## 33. Workflow Automation

Website inquiry → CRM lead; lead → salesperson; untouched lead → reminder;
quote accepted → booking; booking → ops checklist; visa case → doc
request; missing doc → reminder; upcoming departure → reminder; overdue
supplier confirmation → escalation; overdue invoice → follow-up; payment
received → reconciliation; expiring employee document → HR reminder; daily
close → owner summary.

## 34. WhatsApp

Official WhatsApp Business integration. Inquiry ack, quote follow-up,
payment reminder, booking confirmation, departure reminder, visa doc
reminder, case update, support, owner updates. No auto-spam; track
consent, message status, templates.

## 35. Owner WhatsApp Assistant

Daily morning brief (new/hot leads, bookings, cash received, overdue
receivables, upcoming departures, visa/supplier issues, employee
exceptions, marketing performance, Elite Reach intel). Owner can ask
natural-language questions ("How much did we collect this month?"); every
answer comes from verified database data.

## 36–53. Elite Reach — Demand Intelligence & Organic Lead Discovery

Sits before CRM. Source connectors (each tracking access method, health,
commercial-use status, rate limits, last run/error, maturity — not all
sources are equally reliable). Signal pipeline: ingest → normalize →
dedupe → intent analysis → journey linking → opportunity classification →
scoring → human review → engagement → CRM push.

Travel Intent Graph extracts origin/destination/dates/duration/travelers/
budget/trip type/needs/urgency/purchase stage/B2C-B2B/group size/
constraints/confidence.

Purchase stage: Discovery, Research, Planning, Comparison, Ready to Buy,
After Purchase (not just Hot/Warm/Cold).

Elite Reach Score (100 pts): purchase intent, urgency, UAE/GCC relevance,
service fit, commercial value, destination fit, group value, engagement,
confidence — always explained.

Lead decay: priority decay, expiry vs. travel date, response urgency
("Hot — expires in 6 hours", "Warm — 4 days", long-term nurture, expired).

Opportunity types: Direct Lead, Early Intent, B2B, Partnership, Content
Gap, Product Opportunity, Market Trend, Customer Support, Reputation Risk,
Competitor Signal, Spam, Irrelevant — not every signal becomes a lead.

Content Gap Engine: repeated demand vs. website coverage → content
opportunity (e.g. "Japan visa from Dubai" weak on-site → recommend "Japan
Visa for UAE Residents" page, with SEO/AEO/commercial-intent scoring).

Product Opportunity Engine: repeated demand for an unlisted product (e.g.
"Georgia family package") → proposed package spec + target + budget
(derived from observed conversations) + requirements + recommended
package/landing-page/campaign.

Demand Radar: destination, signal volume, change, high-intent signals, B2B
demand, bookings, revenue, profit — always labeled as demand within
monitored sources, not total UAE demand.

Market Trigger Engine: Eid, UAE long weekends, school holidays, Christmas,
New Year, Diwali, cherry blossom, summer, ski season, major events, new
routes, regulation changes — combined with demand + existing packages +
historical conversions → campaign recommendations.

Engagement Copilot: signal → analysis → response strategy → draft →
brand/policy check → human review → publish/skip. No auto-DMing, no
harvesting public contact info into marketing lists.

Reputation Engine: recent brand replies, promotional-language density,
community saturation, negative responses, complaints → "Do Not Engage"
recommendation when risk is high.

CRM sync: qualified opportunity → `createLead()` → CRM lead ID stored back
on the Reach side; CRM later pushes status back (Qualified/Quote Sent/Won/
Lost/Booking Confirmed).

Revenue attribution: signal → engagement → CRM → quote → booking → invoice
→ payment → gross profit, broken down by source/destination/campaign/
Elite-Reach-specific/conversion-by-opportunity-type.

Feedback loop: human labels (Correct/Wrong/Wrong destination/Wrong intent/
Duplicate/Spam/Expired/Excellent lead/Converted/Lost) feed back into
scoring.

Strategy Engine: generates a daily "what Elite Escape should do today"
action list from all of the above.

## 54–58. Marketing

**SEO:** technical SEO, on-page, internal linking, structured data,
canonicals, sitemap, robots, image/content optimization, Search Console,
local/destination/package/visa SEO.

**AEO/AIO/GEO:** question-answering readiness, AI search discoverability,
entity clarity, brand authority, structured info, FAQ coverage, factual
consistency, freshness, source quality. No guaranteed AI citations.

**Social media:** content calendar, asset library, captions, reels,
carousels, approval workflow, scheduling, publishing where officially
supported, analytics, CRM lead attribution. Instagram, Facebook, TikTok,
YouTube, LinkedIn where relevant.

**Paid ads:** Google Ads, Meta Ads, retargeting where allowed, landing
pages, CRM attribution, conversion tracking (ad → landing page → lead →
quote → booking → revenue).

**Marketing analytics:** visitors, leads, qualified leads, quotes,
bookings, revenue, profit, by source/campaign/destination, cost per lead/
booking, ROAS where appropriate — avoid vanity metrics as the primary
success indicator.

## 59. Mobile Apps

**Customer app:** packages, inquiry, quotes, bookings, itinerary, visa,
documents, invoices, payments, support.

**Employee app:** leads, follow-ups, bookings, visa tasks, supplier
confirmations, attendance, leave, tasks.

**Owner app:** business dashboard, financial summary, sales, operations,
Elite Reach, AI Executive, approvals, alerts.

## 60. Document Management

Secure storage, categories (booking/visa/customer/employee/supplier docs),
version history, expiry, access control, audit, signed URLs. Never expose
object storage publicly.

## 61. Internal Task Management

Tasks/subtasks, assignment, priority, deadlines, comments, attachments,
reminders, escalations, dependencies. Originates from CRM, booking, visa,
finance, HR, marketing, or Elite Reach.

## 62. Notifications

Channels: in-app, email, WhatsApp, push. Priorities: routine, important,
critical. Avoid overload.

## 63. Reporting

Sales, lead conversion, booking, destination performance, visa, supplier,
receivables, payables, cash collection, profitability, employee
performance, marketing attribution, Elite Reach attribution, consultant
performance, customer repeat rate, cancellation/refund analysis.

## 64. Search

Global search across customer, booking reference, invoice, visa case,
traveler, passport reference where permitted, supplier, quotation, lead,
phone, email — respecting permissions.

## 65. Audit Log

Login, record creation, important changes, status changes, financial
approvals, document access, permission changes, AI tool actions, WhatsApp
actions, refunds, cancellations.

## 66. Backups

Automated DB + file backups, encryption, retention rules, restore testing,
disaster recovery procedure. Not "complete" until restore tests actually
pass.

## 67. Monitoring

API/DB/worker health, queue backlog, failed jobs, connector failures, AI/
WhatsApp/email failures, storage, CPU/RAM, error rate, slow queries.

## 68. AI Cost Control

Track usage per agent/employee/customer/feature/model/day/month. Cheap
models for simple classification, larger models only for complex
reasoning.

## 69. Database Structure (core tables)

```
organizations, branches, departments, users, roles, permissions,
employees, customers, contacts, leads, opportunities, activities,
quotations, quotation_versions, travelers, travel_bookings,
booking_services, holiday_packages, flight_services, hotel_services,
transfer_services, attraction_services, insurance_services, visa_cases,
visa_applicants, visa_documents, suppliers, supplier_rates,
supplier_bookings, supplier_bills, invoices, invoice_lines, payments,
refunds, journals, journal_entries, accounts, attendance, leave, payroll,
documents, tasks, notifications, audit_events, reach_connectors,
reach_campaigns, reach_signals, reach_journeys, reach_intents,
reach_opportunities, reach_engagements, marketing_campaigns,
content_items, seo_tasks, social_posts, ad_campaigns, ai_agents, ai_runs,
ai_feedback, ai_usage
```

## 70–71. UI Design Principles & Navigation

Premium, professional, calm, fast, enterprise-grade — optimized for
employees using it all day. Avoid cartoon UI, excessive gradients, random
icons, "AI-generated" aesthetic, oversized cards, decorative animation,
dashboard clutter.

Nav: Dashboard · Sales (Leads/Opportunities/Customers/Quotations) · Travel
(Bookings/Packages/Flights/Hotels/Transfers/Attractions/Insurance) · Visa
(Cases/Applicants/Documents) · Suppliers (Suppliers/Rates/Reservations/
Bills) · Finance (Invoices/Payments/Receivables/Payables/Banking/
Accounting/Reports) · HR (Employees/Attendance/Leave/Payroll) · Reach
(Command Center/Opportunities/Demand Radar/Journeys/Campaigns/Content
Gaps/Market Signals) · Marketing (SEO/AEO-GEO/Content/Social/Ads/
Analytics) · AI (AI Employees/Conversations/Approvals/Usage) ·
Administration (Users/Roles/Settings/Integrations/Audit/System).

## 72–73. Testing

Every module: unit, integration, E2E, permission, security, data-
validation, error, concurrency, accessibility tests. Finance additionally
needs accounting invariant tests. AI needs evaluation datasets. Elite Reach
needs labelled intent datasets.

Minimum real-world scenario: Japan honeymoon quote revised 3×, 50% advance
paid, hotel price change, flight schedule change, traveler added, missing
visa doc, delayed appointment, late supplier invoice, partial
cancellation + partial refund, FX change, trip completes, profit
reconciles, and the owner asks via WhatsApp "How much profit did Japan
bookings generate?" and gets a verified-data answer.

## 74. Development Phases (as specified)

1. Foundation (architecture, DB, auth, permissions, audit, org)
2. CRM (customer, lead, opportunity, quotation)
3. Travel ERP (booking, traveler, packages, flights, hotels, transfers,
   attractions, insurance)
4. Visa (cases, documents, status)
5. Finance (accounting, invoicing, payments, supplier bills, VAT)
6. HRMS (employees, attendance, leave, payroll)
7. Automation (events, workflows, notifications)
8. AI (agents, knowledge, tool execution, approvals)
9. WhatsApp (customer comms, owner assistant)
10. Elite Reach (production-grade demand intelligence)
11. Marketing (SEO, AEO, AIO, GEO, social, ads)
12. Portals (customer, supplier, employee)
13. Mobile (customer, employee, owner)
14. Production hardening (security, backups, performance, monitoring,
    documentation, client delivery)

## 75. Definition of Done

Backend works, frontend works, data persists, permissions work, validation
works, error states work, audit works, tests pass, production
configuration exists, documentation exists, a realistic scenario was
tested, no known critical security problem. A screen existing is not
"done."

## 76. Client Delivery Package

Production web app, public website, internal OS (CRM/ERP/Visa/Accounting/
HRMS/Elite Reach/AI/WhatsApp), customer/employee/supplier portals, mobile
apps where contracted, marketing systems, docs (admin manual, user manual,
architecture, API docs, backup/restore/deployment guides, security report,
test report, known limitations, support procedure, client acceptance
checklist).

## 77. Critical Build Rule

One module at a time: analyze real workflow → data model → roles →
exceptions → backend → frontend → connect related modules → audit → tests
→ real-scenario test → fix → document → mark production-ready only when
justified → continue.

## 78. First Execution Task

Deeply inspect existing Elite Escape and Elite Reach code before touching
anything. Produce: `ELITE_ESCAPE_MASTER_SPEC.md` (this file),
`ELITE_ESCAPE_ARCHITECTURE.md`, `ELITE_ESCAPE_CURRENT_STATE.md`,
`ELITE_ESCAPE_GAP_ANALYSIS.md`, `ELITE_ESCAPE_DATABASE_PLAN.md`,
`ELITE_ESCAPE_ROADMAP.md`, `ELITE_ESCAPE_SECURITY_MODEL.md`,
`ELITE_ESCAPE_INTEGRATION_MAP.md`. Identify what exists, works, is
prototype, needs migration, can be reused, must be rebuilt, should stay
separate, needs integration — then establish shared architecture. Don't
redesign the frontend yet, don't create fake dashboards, don't generate
placeholder modules. Foundation first.

## 79. Required Report After Every Development Session

Completed · Files Created · Files Modified · Database Changes · API
Changes · UI Changes · Tests (executed + actual result) · Security (checks
performed) · Outstanding Issues · Production Status (Not Ready / Partially
Ready / Ready) · Next Task. Never claim success without evidence.
