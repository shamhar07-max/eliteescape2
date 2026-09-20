# Elite Escape — Integration Map

External integrations the spec calls for, what exists today, and — for
each missing one — what's needed from the client before it can be built
for real (most of these need an account/credential decision that is not
an engineering task).

| Integration | Spec section | Current status | What's needed to build it for real |
|---|---|---|---|
| Email delivery | §21, §34, §62 | **Stub only** — `EMAIL_PROVIDER=console` logs to stdout | A real provider account (SMTP, SendGrid, SES, etc.) and its API key/credentials |
| WhatsApp Business API | §34-35 | **Missing** — website has `wa.me` deep links only, no API integration | A Meta Business account, WhatsApp Business API access (usually via a BSP like Twilio/360dialog/MessageBird), approved message templates, and a phone number registered for the API |
| UAE eInvoicing (FTA ASP) | §24 | **Missing** | An accredited Access Service Provider account for UAE eInvoicing — this is a compliance/business decision, not something to build against without one |
| Anthropic / LLM provider | §31 (AI Workforce) | **Built, unverified** | The `anthropic` provider code path exists (Messages API, tool-use loop) but has never run — needs an `ANTHROPIC_API_KEY` to test and use in production |
| Google Search Console | §54 | **Missing** | A verified Search Console property + API credentials |
| Google Ads | §57 | **Missing** | A Google Ads account + API access (developer token, OAuth credentials) |
| Meta Ads | §57 | **Missing** | A Meta Business/Ads account + API access |
| Social platforms (Instagram/Facebook/TikTok/YouTube/LinkedIn) — publishing | §56 | **Missing** | Per-platform developer app + API access; note several platforms' APIs for automated publishing are restricted/require business verification |
| Social platforms — Elite Reach signal ingestion | §37-38 | **Missing** | Each platform needs its own reachability/ToS assessment — the spec itself flags "not all connectors are equally reliable," and several platforms' terms of service restrict automated scraping of public content for commercial lead generation. **This needs a legal review before engineering work starts**, not just API credentials |
| S3-compatible object storage | §24 (target stack), §60 | **Missing** | An S3-compatible bucket (AWS S3, Cloudflare R2, MinIO self-hosted, etc.) and its credentials — blocks the entire document-management module |
| PostgreSQL | Target stack §3 | **Missing** | Only relevant if Option A (rewrite) is chosen per `ELITE_ESCAPE_ARCHITECTURE.md` — needs a managed Postgres instance or self-hosted server for anything beyond local dev |
| Redis | Target stack §3 | **Missing** | Same — needed for BullMQ background jobs (reminders, scheduled digests, AI batch runs) |

## What's already real and working (no external account needed)

- The AI agents' **mock provider** — genuinely functional today, zero
  external dependency, does real tool-use against the real database.
- The **SEO auditor** — crawls the website's own pages directly over
  HTTP; no third-party API involved.
- The **marketing campaign send** — writes to the database and logs to
  console; correct end-to-end except for the final external delivery hop.
- The **website ↔ platform integration** — the one integration that does
  exist for real: the website's forms/chat POST to the platform's public
  API today, CORS-locked and rate-limited.

## Recommendation

Before Elite Reach or WhatsApp automation gets engineering time, get
explicit client answers on: (1) which social platforms are actually
in-scope given ToS/legal constraints, (2) which WhatsApp BSP to use, (3)
which UAE eInvoicing ASP to use, and (4) whether an `ANTHROPIC_API_KEY`
(or another LLM provider) will be provided so the AI agents can move past
mock mode. None of these are blocked by the architecture decision in
`ELITE_ESCAPE_ARCHITECTURE.md` — they can be resolved in parallel.
