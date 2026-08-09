-- Device + network detail for sessions and login attempts. Both tables
-- previously only carried a bare ip_address (sessions also had a raw
-- user_agent nobody parsed into columns, and login_attempts had no
-- user_agent at all — GET /auth/security/login-history hardcoded
-- `'' AS user_agent` for that exact reason). D1 has no ADD COLUMN IF NOT
-- EXISTS; this migration is only meant to run once, so plain ALTERs are
-- fine per migrations/README.md convention.

ALTER TABLE sessions ADD COLUMN device_type TEXT;
ALTER TABLE sessions ADD COLUMN browser TEXT;
ALTER TABLE sessions ADD COLUMN os TEXT;
ALTER TABLE sessions ADD COLUMN country TEXT;
ALTER TABLE sessions ADD COLUMN region TEXT;
ALTER TABLE sessions ADD COLUMN city TEXT;
ALTER TABLE sessions ADD COLUMN postal_code TEXT;
ALTER TABLE sessions ADD COLUMN timezone TEXT;
ALTER TABLE sessions ADD COLUMN latitude TEXT;
ALTER TABLE sessions ADD COLUMN longitude TEXT;
ALTER TABLE sessions ADD COLUMN asn TEXT;
ALTER TABLE sessions ADD COLUMN isp TEXT;

ALTER TABLE login_attempts ADD COLUMN user_agent TEXT;
ALTER TABLE login_attempts ADD COLUMN device_type TEXT;
ALTER TABLE login_attempts ADD COLUMN browser TEXT;
ALTER TABLE login_attempts ADD COLUMN os TEXT;
ALTER TABLE login_attempts ADD COLUMN country TEXT;
ALTER TABLE login_attempts ADD COLUMN region TEXT;
ALTER TABLE login_attempts ADD COLUMN city TEXT;
ALTER TABLE login_attempts ADD COLUMN postal_code TEXT;
ALTER TABLE login_attempts ADD COLUMN timezone TEXT;
ALTER TABLE login_attempts ADD COLUMN latitude TEXT;
ALTER TABLE login_attempts ADD COLUMN longitude TEXT;
ALTER TABLE login_attempts ADD COLUMN asn TEXT;
ALTER TABLE login_attempts ADD COLUMN isp TEXT;

CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_created ON login_attempts(ip_address, created_at);
