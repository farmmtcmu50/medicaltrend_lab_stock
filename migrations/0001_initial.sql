PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS items (
  item_id TEXT PRIMARY KEY,
  reagent_name TEXT NOT NULL,
  machine TEXT NOT NULL DEFAULT '',
  main_unit TEXT NOT NULL DEFAULT '',
  sub_unit TEXT NOT NULL DEFAULT '',
  sub_per_main INTEGER NOT NULL DEFAULT 1,
  supplier TEXT NOT NULL DEFAULT '',
  unit_price REAL NOT NULL DEFAULT 0,
  main_unit_price REAL NOT NULL DEFAULT 0,
  lead_time_days INTEGER NOT NULL DEFAULT 0,
  reorder_point_sub INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  is_deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stock_units (
  barcode TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  reagent_name TEXT NOT NULL,
  lot TEXT NOT NULL DEFAULT '',
  expiry_date TEXT NOT NULL,
  machine TEXT NOT NULL DEFAULT '',
  sub_unit TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'IN_STOCK',
  received_at TEXT NOT NULL,
  used_at TEXT,
  note TEXT NOT NULL DEFAULT '',
  parent_barcode TEXT NOT NULL DEFAULT '',
  received_by TEXT NOT NULL DEFAULT '',
  used_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS package_barcodes (
  package_barcode TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  reagent_name TEXT NOT NULL,
  lot TEXT NOT NULL DEFAULT '',
  expiry_date TEXT NOT NULL,
  machine TEXT NOT NULL DEFAULT '',
  main_unit TEXT NOT NULL DEFAULT '',
  sub_unit TEXT NOT NULL DEFAULT '',
  sub_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'IN_STOCK',
  received_at TEXT NOT NULL,
  used_at TEXT,
  note TEXT NOT NULL DEFAULT '',
  received_by TEXT NOT NULL DEFAULT '',
  used_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS movements (
  movement_id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  type TEXT NOT NULL,
  barcode TEXT NOT NULL DEFAULT '',
  item_id TEXT NOT NULL DEFAULT '',
  reagent_name TEXT NOT NULL DEFAULT '',
  lot TEXT NOT NULL DEFAULT '',
  quantity_sub INTEGER NOT NULL DEFAULT 0,
  operator_note TEXT NOT NULL DEFAULT '',
  operator_username TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  audit_id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  username TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT 'SUCCESS',
  details TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_items_name ON items(reagent_name);
CREATE INDEX IF NOT EXISTS idx_stock_item_status ON stock_units(item_id, status);
CREATE INDEX IF NOT EXISTS idx_stock_expiry ON stock_units(expiry_date);
CREATE INDEX IF NOT EXISTS idx_stock_parent ON stock_units(parent_barcode);
CREATE INDEX IF NOT EXISTS idx_packages_item_status ON package_barcodes(item_id, status);
CREATE INDEX IF NOT EXISTS idx_packages_expiry ON package_barcodes(expiry_date);
CREATE INDEX IF NOT EXISTS idx_movements_timestamp ON movements(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_username ON audit_logs(username);

INSERT OR IGNORE INTO settings (key, value, updated_at)
VALUES ('expiring_days', '90', datetime('now'));
