PRAGMA foreign_keys = ON;
CREATE TABLE admins (
  id TEXT PRIMARY KEY CHECK(id = 'owner'), email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES admins(id), expires_at TEXT NOT NULL
);
CREATE TABLE auth_attempts (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, resets_at INTEGER NOT NULL);
CREATE TABLE plans (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, monthly_price_satang INTEGER NOT NULL CHECK(monthly_price_satang >= 0),
  description TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
INSERT INTO plans VALUES ('standard', 'Standard', 0, 'กำหนดราคาตามข้อตกลงกับลูกค้า', 1);
INSERT INTO plans VALUES ('professional', 'Professional', 0, 'กำหนดราคาตามข้อตกลงกับลูกค้า', 1);
CREATE TABLE tenants (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, contact_email TEXT NOT NULL,
  plan_id TEXT NOT NULL REFERENCES plans(id), status TEXT NOT NULL CHECK(status IN ('trial','active','suspended')),
  expires_at TEXT NOT NULL, provision_status TEXT NOT NULL DEFAULT 'pending' CHECK(provision_status IN ('pending','provisioning','ready','failed')),
  database_id TEXT UNIQUE, database_name TEXT UNIQUE, worker_name TEXT UNIQUE, app_url TEXT NOT NULL DEFAULT '',
  service_token_hash TEXT, version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE payments (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
  request_key TEXT NOT NULL UNIQUE, amount_satang INTEGER NOT NULL CHECK(amount_satang >= 0),
  months INTEGER NOT NULL CHECK(months BETWEEN 1 AND 36), reference TEXT NOT NULL,
  starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, plan_id TEXT NOT NULL REFERENCES plans(id),
  recorded_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY, tenant_id TEXT REFERENCES tenants(id), actor TEXT NOT NULL,
  action TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX idx_payments_tenant ON payments(tenant_id, created_at);
CREATE INDEX idx_audit_tenant ON audit_events(tenant_id, created_at);
