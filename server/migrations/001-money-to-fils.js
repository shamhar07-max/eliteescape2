/* One-time migration: money columns move from REAL (floating point AED)
 * to INTEGER (fils, 1 AED = 100 fils) — see lib/money.js for why. SQLite
 * has no ALTER COLUMN TYPE, so each affected table is rebuilt: create the
 * new shape, copy+round old REAL values into fils, drop the old table,
 * rename the new one into place. Idempotent — skips a table that's
 * already been migrated (detected by the presence of its new `_fils`
 * column), so this is safe to run on every boot. */

const hasColumn = (db, table, column) =>
  db.prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name = ?`).get(table, column) !== undefined;

const tableExists = (db, table) =>
  db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table) !== undefined;

export const migrateMoneyToFils = (db) => {
  db.exec("PRAGMA foreign_keys = OFF");

  // leads.budget_aed -> budget_aed_fils
  if (tableExists(db, "leads") && hasColumn(db, "leads", "budget_aed") && !hasColumn(db, "leads", "budget_aed_fils")) {
    db.exec(`
      CREATE TABLE leads_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
        interest_type TEXT NOT NULL,
        interest_detail TEXT,
        status TEXT NOT NULL DEFAULT 'new',
        owner_user_id INTEGER REFERENCES users(id),
        budget_aed_fils INTEGER,
        travel_date TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO leads_new SELECT id, customer_id, interest_type, interest_detail, status, owner_user_id,
        CASE WHEN budget_aed IS NULL THEN NULL ELSE CAST(ROUND(budget_aed * 100) AS INTEGER) END,
        travel_date, created_at, updated_at FROM leads;
      DROP TABLE leads;
      ALTER TABLE leads_new RENAME TO leads;
      CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
      CREATE INDEX IF NOT EXISTS idx_leads_owner ON leads(owner_user_id);
    `);
    console.log("[migration] leads.budget_aed -> budget_aed_fils");
  }

  // booking_items.unit_price_aed -> unit_price_aed_fils
  if (tableExists(db, "booking_items") && hasColumn(db, "booking_items", "unit_price_aed") && !hasColumn(db, "booking_items", "unit_price_aed_fils")) {
    db.exec(`
      CREATE TABLE booking_items_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 1,
        unit_price_aed_fils INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO booking_items_new SELECT id, booking_id, description, quantity,
        CAST(ROUND(unit_price_aed * 100) AS INTEGER), created_at FROM booking_items;
      DROP TABLE booking_items;
      ALTER TABLE booking_items_new RENAME TO booking_items;
      CREATE INDEX IF NOT EXISTS idx_booking_items_booking ON booking_items(booking_id);
    `);
    console.log("[migration] booking_items.unit_price_aed -> unit_price_aed_fils");
  }

  // invoices.{subtotal,vat_amount,total}_aed -> *_aed_fils
  if (tableExists(db, "invoices") && hasColumn(db, "invoices", "subtotal_aed") && !hasColumn(db, "invoices", "subtotal_aed_fils")) {
    db.exec(`
      CREATE TABLE invoices_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_number TEXT UNIQUE NOT NULL,
        booking_id INTEGER REFERENCES bookings(id),
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        issue_date TEXT NOT NULL DEFAULT (date('now')),
        due_date TEXT,
        subtotal_aed_fils INTEGER NOT NULL,
        vat_rate_bps INTEGER NOT NULL DEFAULT 500,
        vat_amount_aed_fils INTEGER NOT NULL,
        total_aed_fils INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO invoices_new SELECT id, invoice_number, booking_id, customer_id, issue_date, due_date,
        CAST(ROUND(subtotal_aed * 100) AS INTEGER), vat_rate_bps, CAST(ROUND(vat_amount_aed * 100) AS INTEGER),
        CAST(ROUND(total_aed * 100) AS INTEGER), status, created_at, updated_at FROM invoices;
      DROP TABLE invoices;
      ALTER TABLE invoices_new RENAME TO invoices;
      CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
      CREATE INDEX IF NOT EXISTS idx_invoices_booking ON invoices(booking_id);
      CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
    `);
    console.log("[migration] invoices.*_aed -> *_aed_fils");
  }

  // invoice_items.{unit_price,line_total}_aed -> *_aed_fils
  if (tableExists(db, "invoice_items") && hasColumn(db, "invoice_items", "unit_price_aed") && !hasColumn(db, "invoice_items", "unit_price_aed_fils")) {
    db.exec(`
      CREATE TABLE invoice_items_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 1,
        unit_price_aed_fils INTEGER NOT NULL,
        line_total_aed_fils INTEGER NOT NULL
      );
      INSERT INTO invoice_items_new SELECT id, invoice_id, description, quantity,
        CAST(ROUND(unit_price_aed * 100) AS INTEGER), CAST(ROUND(line_total_aed * 100) AS INTEGER) FROM invoice_items;
      DROP TABLE invoice_items;
      ALTER TABLE invoice_items_new RENAME TO invoice_items;
    `);
    console.log("[migration] invoice_items.*_aed -> *_aed_fils");
  }

  // payments.amount_aed -> amount_aed_fils
  if (tableExists(db, "payments") && hasColumn(db, "payments", "amount_aed") && !hasColumn(db, "payments", "amount_aed_fils")) {
    db.exec(`
      CREATE TABLE payments_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        amount_aed_fils INTEGER NOT NULL,
        method TEXT NOT NULL,
        reference TEXT,
        paid_at TEXT NOT NULL DEFAULT (datetime('now')),
        recorded_by_user_id INTEGER REFERENCES users(id)
      );
      INSERT INTO payments_new SELECT id, invoice_id, CAST(ROUND(amount_aed * 100) AS INTEGER), method, reference, paid_at, recorded_by_user_id FROM payments;
      DROP TABLE payments;
      ALTER TABLE payments_new RENAME TO payments;
      CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
    `);
    console.log("[migration] payments.amount_aed -> amount_aed_fils");
  }

  // employees.basic_salary_aed -> basic_salary_aed_fils
  if (tableExists(db, "employees") && hasColumn(db, "employees", "basic_salary_aed") && !hasColumn(db, "employees", "basic_salary_aed_fils")) {
    db.exec(`
      CREATE TABLE employees_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id),
        full_name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        job_title TEXT NOT NULL,
        department TEXT NOT NULL,
        employment_type TEXT NOT NULL DEFAULT 'full_time',
        basic_salary_aed_fils INTEGER NOT NULL DEFAULT 0,
        join_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO employees_new SELECT id, user_id, full_name, email, phone, job_title, department, employment_type,
        CAST(ROUND(basic_salary_aed * 100) AS INTEGER), join_date, status, created_at, updated_at FROM employees;
      DROP TABLE employees;
      ALTER TABLE employees_new RENAME TO employees;
      CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
    `);
    console.log("[migration] employees.basic_salary_aed -> basic_salary_aed_fils");
  }

  // payslips.{basic_salary,allowances,deductions,net_pay}_aed -> *_aed_fils
  if (tableExists(db, "payslips") && hasColumn(db, "payslips", "basic_salary_aed") && !hasColumn(db, "payslips", "basic_salary_aed_fils")) {
    db.exec(`
      CREATE TABLE payslips_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payroll_run_id INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
        employee_id INTEGER NOT NULL REFERENCES employees(id),
        basic_salary_aed_fils INTEGER NOT NULL,
        allowances_aed_fils INTEGER NOT NULL DEFAULT 0,
        deductions_aed_fils INTEGER NOT NULL DEFAULT 0,
        net_pay_aed_fils INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        paid_at TEXT
      );
      INSERT INTO payslips_new SELECT id, payroll_run_id, employee_id,
        CAST(ROUND(basic_salary_aed * 100) AS INTEGER), CAST(ROUND(allowances_aed * 100) AS INTEGER),
        CAST(ROUND(deductions_aed * 100) AS INTEGER), CAST(ROUND(net_pay_aed * 100) AS INTEGER), status, paid_at FROM payslips;
      DROP TABLE payslips;
      ALTER TABLE payslips_new RENAME TO payslips;
      CREATE INDEX IF NOT EXISTS idx_payslips_run ON payslips(payroll_run_id);
      CREATE INDEX IF NOT EXISTS idx_payslips_employee ON payslips(employee_id);
    `);
    console.log("[migration] payslips.*_aed -> *_aed_fils");
  }

  // purchase_orders.amount_aed -> amount_aed_fils
  if (tableExists(db, "purchase_orders") && hasColumn(db, "purchase_orders", "amount_aed") && !hasColumn(db, "purchase_orders", "amount_aed_fils")) {
    db.exec(`
      CREATE TABLE purchase_orders_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        po_number TEXT UNIQUE NOT NULL,
        vendor_id INTEGER NOT NULL REFERENCES vendors(id),
        description TEXT NOT NULL,
        amount_aed_fils INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        requested_by_user_id INTEGER REFERENCES users(id),
        approved_by_user_id INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO purchase_orders_new SELECT id, po_number, vendor_id, description,
        CAST(ROUND(amount_aed * 100) AS INTEGER), status, requested_by_user_id, approved_by_user_id, created_at, updated_at FROM purchase_orders;
      DROP TABLE purchase_orders;
      ALTER TABLE purchase_orders_new RENAME TO purchase_orders;
      CREATE INDEX IF NOT EXISTS idx_purchase_orders_vendor ON purchase_orders(vendor_id);
      CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);
    `);
    console.log("[migration] purchase_orders.amount_aed -> amount_aed_fils");
  }

  db.exec("PRAGMA foreign_keys = ON");
};
