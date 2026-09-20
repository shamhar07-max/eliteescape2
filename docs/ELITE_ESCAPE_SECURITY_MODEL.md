# Elite Escape — Security Model

## What's implemented today (verified, Phase 8)

- **Password storage:** bcrypt (cost 10), never plaintext, never reversible.
- **Session auth:** random-token cookie (`ee_session`, httpOnly, sameSite=lax,
  7-day expiry), validated server-side against a `sessions` table on every
  request. Deleted on logout.
- **Privilege escalation fix:** `POST /api/auth/register` previously let
  anyone self-register as `owner` at any time — a critical hole present
  since Phase 1. Now it only ever creates the first (bootstrap) account
  and permanently locks itself once any user exists; every subsequent
  account requires an authenticated admin (`POST /api/admin/users`).
- **Brute-force mitigation:** login is rate-limited (10 attempts/10min/IP)
  via an in-memory sliding-window limiter.
- **RBAC:** every route is gated with `auth(["permission.code"])`
  middleware; permissions are checked server-side, never trusted from the
  client. Confirmed by design (no route relies on hiding a UI button).
- **Self-service password change:** requires the current password to be
  re-verified, not just a valid session.
- **Force-logout:** admin can revoke all of a user's sessions (used
  automatically on deactivation, and available standalone).
- **Audit log:** every significant write (create/update-status/role
  change/activate/deactivate/revoke/send/pay) records actor, action,
  entity, and detail, with a full filterable viewer.
- **CORS:** the one public-facing endpoint the website calls
  (`/api/public/*`) uses a manual origin allowlist
  (`PUBLIC_WEBSITE_ORIGINS`), not a wildcard.
- **Rate limiting on public endpoints:** lead intake and the public AI
  chat endpoint are both rate-limited to blunt abuse.

## What the spec requires that's missing

| Requirement | Status | Note |
|---|---|---|
| MFA | Missing | No second factor of any kind |
| Record-level access | Missing | A `sales` role sees every lead, not just their own |
| Field-level restriction | Missing | No column ever gets hidden/masked based on role (e.g. a Travel Consultant seeing a passport number) |
| Approval workflows for sensitive actions | Missing | Nothing today requires a second person's sign-off (e.g. a large discount, a refund, an AI-drafted action) |
| Document encryption | N/A yet | No document storage exists at all (see Gap Analysis §14) — so nothing to encrypt yet, but this needs to be designed in from the start once it's built, not retrofitted |
| Device/session fingerprinting beyond the cookie | Missing | A stolen cookie is a stolen session; there's no secondary signal (IP/device change detection) |
| AI action approval gate | **Partial** | The two existing AI tools (`create_lead`, `get_customer_summary`, `request_human_handoff`) are all deliberately low-risk — none of them can modify money, send an external message, or change a status irreversibly. This becomes a real requirement, not a nice-to-have, the moment a Finance or Sales Assistant is built that can draft a quotation or a payment reminder — the spec is explicit that AI should never post ledger entries independently, and that pattern needs to extend to anything financially or externally consequential |
| Data-at-rest encryption for sensitive fields (passport, Emirates ID, bank details) | Missing | None of these fields exist in the database yet (see Gap Analysis §4, §12) — same "design in from day one" note as documents |

## Sensitive data inventory (per spec §7) and current exposure

| Data type | Exists in current schema? | Where |
|---|---|---|
| Passport details | No | — (would live on a `travelers` table, which doesn't exist) |
| Emirates ID | No | — |
| Visa documents | No | — |
| Customer financial information | Partial | Invoice/payment amounts exist (not sensitive in the same category, but still business-confidential) |
| Supplier rates | No | `vendors`/`purchase_orders` don't carry negotiated rate sheets |
| Employee salary | **Yes** | `employees.basic_salary_aed`, `payslips.*` — currently readable by anyone with `hr.read` or `accounting.read`; no additional restriction beyond that permission |
| Bank details | No | — |
| Customer payment records | **Yes** | `payments` table — method, amount, reference; no card/bank numbers are stored (payment methods recorded are cash/card/bank_transfer/stripe/telr as labels, not actual card/account numbers) |

## Recommendation before building the next sensitive-data module

Once travelers (passports), visa documents, or bank details are added to
the schema (per the Gap Analysis), each needs a threat-model pass before
launch: who can read it (permission code), whether it needs field-level
masking even within a permitted role, whether it needs encryption at rest,
and whether accessing it should itself generate an audit-log entry (the
spec explicitly lists "document access" as an auditable event — the
current audit log only records writes, not reads).

## Not evaluated (out of scope for this audit)

Penetration testing, dependency vulnerability scanning, infrastructure
security (this sandbox has no persistent server to scan), and third-party
integration security (WhatsApp Business API, UAE eInvoicing ASP, ad
platforms) — none of these integrations exist yet, so there's nothing to
assess.
