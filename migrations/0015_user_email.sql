-- Cloudflare Access (One-time PIN) identifies users by email.
-- Existing users get their email set by an admin (Settings > users) or by a one-off UPDATE.
ALTER TABLE users ADD COLUMN email TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_active_email ON users(lower(email)) WHERE email IS NOT NULL AND is_active = 1;
