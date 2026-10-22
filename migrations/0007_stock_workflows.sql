ALTER TABLE stock_units ADD COLUMN last_operation TEXT NOT NULL DEFAULT '';
ALTER TABLE movements ADD COLUMN unit TEXT NOT NULL DEFAULT '';
ALTER TABLE purchase_requisition_items ADD COLUMN received_qty REAL NOT NULL DEFAULT 0;
CREATE TABLE stock_operations (
 operation_id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, username TEXT NOT NULL,
 kind TEXT NOT NULL, created_at TEXT NOT NULL, item_id TEXT NOT NULL DEFAULT '',
 reason TEXT NOT NULL DEFAULT '', payload_hash TEXT NOT NULL, response_json TEXT NOT NULL,
 reverses_id TEXT UNIQUE, reversed_by TEXT NOT NULL DEFAULT '',
 pr_line_id TEXT REFERENCES purchase_requisition_items(line_id), pr_quantity REAL NOT NULL DEFAULT 0
);
CREATE INDEX idx_operations_created ON stock_operations(created_at,operation_id);
CREATE INDEX idx_operations_pr ON stock_operations(pr_line_id);
CREATE TABLE stock_operation_units (
 operation_id TEXT NOT NULL REFERENCES stock_operations(operation_id), barcode TEXT NOT NULL,
 before_json TEXT, after_status TEXT NOT NULL, PRIMARY KEY(operation_id,barcode)
);
CREATE TABLE stock_counts (
 count_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, created_by TEXT NOT NULL,
 item_id TEXT NOT NULL, lot TEXT NOT NULL, expiry_date TEXT NOT NULL,
 snapshot_signature TEXT NOT NULL, system_qty INTEGER NOT NULL, counted_qty INTEGER NOT NULL CHECK(counted_qty>=0),
 reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', approved_by TEXT NOT NULL DEFAULT '',
 approved_at TEXT, operation_id TEXT
);
CREATE INDEX idx_counts_created ON stock_counts(created_at);
CREATE TABLE workflow_guards (operation_id TEXT NOT NULL, ok INTEGER NOT NULL CHECK(ok=1));
