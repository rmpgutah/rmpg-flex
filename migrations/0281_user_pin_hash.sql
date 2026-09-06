-- Add pin_hash column for PIN-based lock-screen authentication.
-- Separate from password_hash: PINs are short (4-6 digits), used only for
-- the desktop lock-screen quick-unlock flow, never for full login.
-- When NULL the verify-pin endpoint falls back to badge_number comparison.
ALTER TABLE users ADD COLUMN pin_hash TEXT DEFAULT NULL;
