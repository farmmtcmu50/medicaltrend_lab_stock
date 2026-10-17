-- Used only by subscription-enabled tenant Workers. The legacy Worker ignores this table.
CREATE TABLE IF NOT EXISTS tenant_auth_attempts (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  resets_at INTEGER NOT NULL
);
