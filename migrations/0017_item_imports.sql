CREATE TABLE IF NOT EXISTS item_imports (
 import_id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL,
 rows_json TEXT NOT NULL,
 result_json TEXT,
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_item_imports_user ON item_imports(user_id,expires_at);
