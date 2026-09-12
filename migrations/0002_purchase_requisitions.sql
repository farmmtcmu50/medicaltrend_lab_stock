CREATE TABLE IF NOT EXISTS purchase_requisitions (
  pr_id TEXT PRIMARY KEY,
  pr_no TEXT NOT NULL UNIQUE,
  request_date TEXT NOT NULL,
  requester TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  approver TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PENDING',
  requested_by TEXT NOT NULL DEFAULT '',
  approved_by TEXT NOT NULL DEFAULT '',
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_requisition_items (
  line_id TEXT PRIMARY KEY,
  pr_id TEXT NOT NULL,
  item_id TEXT NOT NULL DEFAULT '',
  item_name TEXT NOT NULL DEFAULT '',
  supplier TEXT NOT NULL DEFAULT '',
  current_stock TEXT NOT NULL DEFAULT '',
  lot TEXT NOT NULL DEFAULT '',
  expiry TEXT NOT NULL DEFAULT '',
  order_qty REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT '',
  unit_price REAL NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (pr_id) REFERENCES purchase_requisitions(pr_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pr_status_created ON purchase_requisitions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_pr_requested_by ON purchase_requisitions(requested_by);
CREATE INDEX IF NOT EXISTS idx_pr_items_pr_id ON purchase_requisition_items(pr_id);
