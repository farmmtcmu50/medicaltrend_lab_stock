INSERT OR IGNORE INTO users (user_id, username, password_hash, salt, role, is_active, created_at, updated_at)
VALUES (
  'USR-ADMIN',
  'admin',
  'AUTO_CREATE_ON_FIRST_LOGIN',
  'AUTO_CREATE_ON_FIRST_LOGIN',
  'admin',
  1,
  datetime('now'),
  datetime('now')
);
