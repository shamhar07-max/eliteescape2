/* Elite Escape Business Platform — Phase 1 schema.
 * SQLite for local dev (node:sqlite, Node 22+). Designed so later phases
 * (ERP, Accounting, HRMS, AI employees) extend this via new tables rather
 * than rewriting the core: users/roles/permissions is the auth spine every
 * later module authorizes against, and customers/leads is the CRM spine
 * every later module (bookings, invoices, AI conversations) references.
 */
export const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ===== Auth & access control =====
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,          -- 'owner', 'admin', 'sales', 'ops', 'finance', 'hr'
  description TEXT
);

CREATE TABLE IF NOT EXISTS permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,          -- 'crm.read', 'crm.write', 'accounting.read', ...
  description TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- ===== CRM spine =====
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  whatsapp TEXT,
  nationality TEXT,
  source TEXT,                        -- 'website', 'whatsapp', 'referral', 'walk-in'
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  interest_type TEXT NOT NULL,        -- 'holiday', 'visa', 'attraction', 'flight', 'hotel', 'insurance'
  interest_detail TEXT,               -- free text: 'Japan 7-day', 'USA visa', etc.
  status TEXT NOT NULL DEFAULT 'new', -- 'new', 'contacted', 'quoted', 'won', 'lost'
  owner_user_id INTEGER REFERENCES users(id),
  budget_aed REAL,
  travel_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lead_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  actor_user_id INTEGER REFERENCES users(id),
  channel TEXT NOT NULL,              -- 'whatsapp', 'email', 'call', 'note', 'ai_agent'
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===== Audit (every later module writes here — non-negotiable for a business platform) =====
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===== Communications: internal notifications (Phase 2) =====
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                 -- 'new_lead', 'lead_status_change', 'system'
  title TEXT NOT NULL,
  body TEXT,
  entity_type TEXT,
  entity_id INTEGER,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_owner ON leads(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_lead_activities_lead ON lead_activities(lead_id);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
`;

export const SEED_ROLES = [
  ["owner", "Full access to every module"],
  ["admin", "Platform administration"],
  ["sales", "CRM and lead management"],
  ["ops", "Travel operations"],
  ["finance", "Accounting and payroll"],
  ["hr", "HR and staff management"],
];

export const SEED_PERMISSIONS = [
  "crm.read", "crm.write",
  "ops.read", "ops.write",
  "accounting.read", "accounting.write",
  "hr.read", "hr.write",
  "admin.read", "admin.write",
];
