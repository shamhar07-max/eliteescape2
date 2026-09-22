/* Integration smoke test, not a full suite — a comprehensive automated
 * test suite is its own separate, larger piece of work (see README
 * roadmap). This exists so CI actually verifies something real: the app
 * boots, the bootstrap-then-lock registration works, RBAC is enforced,
 * and the core Inquiry -> Lead -> Booking -> Invoice -> Payment pipeline
 * runs end-to-end against a real (temporary, throwaway) SQLite database.
 *
 * Runs the real Express app over real HTTP on an ephemeral port — no
 * mocked req/res — so it exercises the same code path a browser would.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Must be set before app.js (and therefore db.js) is ever imported — the DB
// path is read once at module load time.
const tmpDir = mkdtempSync(join(tmpdir(), "ee-smoke-"));
process.env.DB_PATH = join(tmpDir, "test.db");

const { app } = await import("../app.js");

let server, baseUrl;
let sessionCookie = "";

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(tmpDir, { recursive: true, force: true });
});

const request = (path, opts = {}) => fetch(`${baseUrl}${path}`, {
  ...opts,
  headers: { "content-type": "application/json", ...(sessionCookie ? { cookie: sessionCookie } : {}), ...opts.headers },
});

// Reads the body exactly once (a Response body can only be consumed once)
// and asserts on status, using the body as the failure message so a
// failing test still shows exactly what the API said.
async function expectStatus(res, expectedStatus) {
  const text = await res.text();
  const body = (() => { try { return JSON.parse(text); } catch { return text; } })();
  assert.equal(res.status, expectedStatus, typeof body === "string" ? body : JSON.stringify(body));
  return body;
}

test("health check responds ok", async () => {
  const res = await request("/api/health");
  const body = await expectStatus(res, 200);
  assert.equal(body.ok, true);
});

test("bootstrap registration creates the first user as owner", async () => {
  const res = await request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: "owner@smoketest.local", password: "smoke-test-password-1", fullName: "Smoke Test Owner" }),
  });
  await expectStatus(res, 201);
});

test("registration is locked after the bootstrap account exists", async () => {
  const res = await request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: "second@smoketest.local", password: "smoke-test-password-1", fullName: "Should Be Rejected" }),
  });
  assert.equal(res.status, 403, "a second /api/auth/register call must never succeed — this was a real privilege-escalation bug fixed in Phase 8");
});

test("login sets a session cookie", async () => {
  const res = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "owner@smoketest.local", password: "smoke-test-password-1" }),
  });
  await expectStatus(res, 200);
  const setCookie = res.headers.get("set-cookie");
  assert.ok(setCookie, "expected a Set-Cookie header");
  sessionCookie = setCookie.split(";")[0];
});

let customerId, leadId, bookingId, invoiceId;

test("owner can create a customer", async () => {
  const res = await request("/api/customers", {
    method: "POST",
    body: JSON.stringify({ fullName: "Smoke Test Customer", email: "customer@smoketest.local" }),
  });
  const body = await expectStatus(res, 201);
  ({ id: customerId } = body);
  assert.ok(customerId);
});

test("owner can create a lead for that customer", async () => {
  const res = await request("/api/leads", {
    method: "POST",
    body: JSON.stringify({ customerId, interestType: "holiday", interestDetail: "Smoke test package" }),
  });
  const body = await expectStatus(res, 201);
  ({ id: leadId } = body);
  assert.ok(leadId);
});

test("owner can create a booking with a typed service line and invoice it", async () => {
  const bookingRes = await request("/api/bookings", {
    method: "POST",
    body: JSON.stringify({ customerId, leadId, bookingType: "holiday", description: "Smoke test booking" }),
  });
  const booking = await expectStatus(bookingRes, 201);
  ({ id: bookingId } = booking);

  const itemRes = await request(`/api/bookings/${bookingId}/items`, {
    method: "POST",
    body: JSON.stringify({ serviceType: "hotel", description: "Test hotel", quantity: 1, unitPriceAed: 500, supplierCostAed: 350 }),
  });
  await expectStatus(itemRes, 201);

  const invoiceRes = await request("/api/invoices", { method: "POST", body: JSON.stringify({ bookingId }) });
  const invoice = await expectStatus(invoiceRes, 201);
  invoiceId = invoice.id;
  assert.equal(invoice.total, 525); // 500 + 5% VAT
});

test("sending the invoice posts a balanced journal entry to the GL", async () => {
  const sendRes = await request(`/api/invoices/${invoiceId}/status`, { method: "PATCH", body: JSON.stringify({ status: "sent" }) });
  await expectStatus(sendRes, 200);

  const tbRes = await request("/api/gl/trial-balance");
  const trialBalance = await expectStatus(tbRes, 200);
  assert.equal(trialBalance.balanced, true, "the GL must always balance after a posted journal entry");
});

test("recording a payment marks the invoice paid", async () => {
  const res = await request(`/api/invoices/${invoiceId}/payments`, {
    method: "POST",
    body: JSON.stringify({ amountAed: 525, method: "bank_transfer" }),
  });
  const body = await expectStatus(res, 201);
  assert.equal(body.invoiceStatus, "paid");
});

test("an unauthenticated request is rejected", async () => {
  const res = await fetch(`${baseUrl}/api/customers`);
  assert.equal(res.status, 401);
});

test("a logged-in user without the right permission is rejected with 403, not 401", async () => {
  // sales role only has crm.*, not accounting.* — register one via the
  // owner-only admin endpoint and confirm the accounting API refuses it.
  const createUserRes = await request("/api/admin/users", {
    method: "POST",
    body: JSON.stringify({ fullName: "Sales User", email: "sales@smoketest.local", password: "smoke-test-password-1", role: "sales" }),
  });
  await expectStatus(createUserRes, 201);

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "sales@smoketest.local", password: "smoke-test-password-1" }),
  });
  const salesCookie = loginRes.headers.get("set-cookie").split(";")[0];

  const res = await fetch(`${baseUrl}/api/invoices`, { headers: { cookie: salesCookie } });
  assert.equal(res.status, 403);
});
