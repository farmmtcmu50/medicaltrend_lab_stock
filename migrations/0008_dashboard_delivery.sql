CREATE TABLE IF NOT EXISTS pr_delivery_terms (
 pr_id TEXT PRIMARY KEY REFERENCES purchase_requisitions(pr_id) ON DELETE CASCADE,
 issued_date TEXT NOT NULL,
 expected_date TEXT NOT NULL,
 updated_by TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_delivery_issued ON pr_delivery_terms(issued_date);
CREATE TABLE IF NOT EXISTS analytics_purchase_totals (
 start_date TEXT NOT NULL,
 end_date TEXT NOT NULL,
 total_value REAL NOT NULL CHECK(total_value>=0),
 updated_by TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(start_date,end_date)
);
