import { Router } from "express";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";

export const router = Router();

// Global search across the record types named in the master spec's Search
// section — each category gated by the same permission that already
// protects its own module, so a search never leaks records a user
// couldn't otherwise open. `auth()` with no args just requires login;
// the owner role bypasses every permission check (see middleware/auth.js),
// same as everywhere else in the app.
const can = (req, perm) => req.user.role === "owner" || req.user.permissions.includes(perm);

router.get("/api/search", auth(), (req, res) => {
  const q = (req.query.q || "").trim();
  if (q.length < 2) return res.json({ query: q, results: [] });
  const like = `%${q}%`;
  const results = [];

  if (can(req, "crm.read")) {
    const customers = db.prepare(`
      SELECT id, full_name, email, phone, whatsapp FROM customers
      WHERE full_name LIKE ? COLLATE NOCASE OR email LIKE ? COLLATE NOCASE OR phone LIKE ? OR whatsapp LIKE ?
      LIMIT 8
    `).all(like, like, like, like);
    for (const c of customers) results.push({ category: "customer", id: c.id, tab: "customers", label: c.full_name, subtitle: c.email || c.whatsapp || c.phone || "" });

    const leads = db.prepare(`
      SELECT l.id, l.interest_type, l.interest_detail, c.full_name AS customer_name FROM leads l
      LEFT JOIN customers c ON c.id = l.customer_id
      WHERE l.interest_detail LIKE ? COLLATE NOCASE OR c.full_name LIKE ? COLLATE NOCASE
      LIMIT 8
    `).all(like, like);
    for (const l of leads) results.push({ category: "lead", id: l.id, tab: "leads", label: `${l.interest_type}: ${l.interest_detail || "—"}`, subtitle: l.customer_name || "" });

    const quotations = db.prepare(`
      SELECT q.id, q.quotation_number, q.status, c.full_name AS customer_name FROM quotations q
      LEFT JOIN customers c ON c.id = q.customer_id
      WHERE q.quotation_number LIKE ? COLLATE NOCASE LIMIT 8
    `).all(like);
    for (const item of quotations) results.push({ category: "quotation", id: item.id, tab: "quotations", label: item.quotation_number, subtitle: `${item.customer_name || ""} — ${item.status}` });
  }

  if (can(req, "ops.read")) {
    const bookings = db.prepare(`
      SELECT b.id, b.description, b.booking_type, c.full_name AS customer_name FROM bookings b
      LEFT JOIN customers c ON c.id = b.customer_id
      WHERE b.description LIKE ? COLLATE NOCASE OR CAST(b.id AS TEXT) = ? LIMIT 8
    `).all(like, q);
    for (const b of bookings) results.push({ category: "booking", id: b.id, tab: "bookings", label: `#${b.id} — ${b.description}`, subtitle: b.customer_name || "" });

    const visaCases = db.prepare(`
      SELECT vc.id, vc.case_number, vc.destination_country, vc.status, c.full_name AS customer_name FROM visa_cases vc
      LEFT JOIN customers c ON c.id = vc.customer_id
      WHERE vc.case_number LIKE ? COLLATE NOCASE OR vc.destination_country LIKE ? COLLATE NOCASE LIMIT 8
    `).all(like, like);
    for (const v of visaCases) results.push({ category: "visa_case", id: v.id, tab: "visa", label: `${v.case_number} — ${v.destination_country}`, subtitle: `${v.customer_name || ""} — ${v.status}` });

    // Traveler passport lookups stay behind the same ops.read gate that
    // already protects the booking they belong to — never a separate,
    // looser check, per the spec's "passport reference where permitted".
    const travelers = db.prepare(`
      SELECT t.id, t.full_name, t.passport_number, t.booking_id FROM travelers t
      WHERE t.full_name LIKE ? COLLATE NOCASE OR t.passport_number LIKE ? COLLATE NOCASE LIMIT 8
    `).all(like, like);
    for (const t of travelers) results.push({ category: "traveler", id: t.booking_id, tab: "bookings", label: t.full_name, subtitle: t.passport_number ? `Passport ${t.passport_number} — Booking #${t.booking_id}` : `Booking #${t.booking_id}` });
  }

  if (can(req, "accounting.read")) {
    const invoices = db.prepare(`
      SELECT i.id, i.invoice_number, i.status, c.full_name AS customer_name FROM invoices i
      LEFT JOIN customers c ON c.id = i.customer_id
      WHERE i.invoice_number LIKE ? COLLATE NOCASE LIMIT 8
    `).all(like);
    for (const inv of invoices) results.push({ category: "invoice", id: inv.id, tab: "invoices", label: inv.invoice_number, subtitle: `${inv.customer_name || ""} — ${inv.status}` });
  }

  if (can(req, "procurement.read")) {
    const suppliers = db.prepare(`
      SELECT id, name, category, email, phone FROM vendors
      WHERE name LIKE ? COLLATE NOCASE OR email LIKE ? COLLATE NOCASE OR phone LIKE ? LIMIT 8
    `).all(like, like, like);
    for (const s of suppliers) results.push({ category: "supplier", id: s.id, tab: "procurement", label: s.name, subtitle: s.category });
  }

  if (can(req, "hr.read")) {
    const employees = db.prepare(`
      SELECT id, full_name, job_title, email, phone FROM employees
      WHERE full_name LIKE ? COLLATE NOCASE OR email LIKE ? COLLATE NOCASE OR phone LIKE ? LIMIT 8
    `).all(like, like, like);
    for (const e of employees) results.push({ category: "employee", id: e.id, tab: "employees", label: e.full_name, subtitle: e.job_title });
  }

  res.json({ query: q, results });
});
