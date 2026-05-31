-- 0046_warrants_null_out_sentinels.sql
-- One-time cleanup: convert legacy sentinel strings ('N/A', 'None', 'null',
-- 'undefined', plus the empty string) to actual SQL NULL on the warrants
-- table. The PDF renderer (PR #808) now masks these at render time via
-- pdfField(), but downstream consumers (filename sanitization, search
-- filters, JOINs that expected NULL semantics) still see the literal text.
-- This migration is the data-side companion fix.
--
-- The newly-ported CF Worker handlers in src/routes/warrants.ts use
-- ?? null semantics on every nullable column, so going forward no fresh
-- sentinel can be written. This UPDATE just sanitises historical drift
-- from the legacy era; re-applying on a clean table is a no-op.
--
-- Columns scoped intentionally:
--   - warrant_number   TEXT UNIQUE        → 'N/A' broke filename sanitisation
--                                            ("N_A_warrant.pdf")
--   - issuing_court    TEXT
--   - issuing_judge    TEXT
--   - charge_description TEXT NOT NULL    → never null, but empty/'N/A' is
--                                            still invalid for a required
--                                            field; left alone so we don't
--                                            silently violate the NOT NULL.
--   - expires_at       TEXT
--   - served_location  TEXT
--   - notes            TEXT
--   - source           TEXT (default 'manual'; sentinel here would override
--                            the default — null it so default re-applies on
--                            read)
--   - external_warrant_id  TEXT
--   - external_source_key  TEXT
--
-- Numeric / enum columns deliberately NOT touched:
--   - bail_amount   REAL — SQLite type-affinity would have stored 'N/A' as
--                          text in a REAL column, which is weird but does
--                          happen. If it's there we'd rather see the error
--                          than silently null it; flag via SELECT after deploy.
--   - offense_level TEXT CHECK(IN ('felony','misdemeanor','infraction','civil'))
--                       — the CHECK would have rejected 'N/A' on insert.
--   - entered_by    INTEGER NOT NULL — FK, cannot meaningfully hold 'N/A'.

UPDATE warrants
   SET warrant_number = NULL
 WHERE warrant_number IN ('', 'N/A', 'n/a', 'N/a', 'None', 'NONE', 'none', 'null', 'NULL', 'undefined');

UPDATE warrants
   SET issuing_court = NULL
 WHERE issuing_court IN ('', 'N/A', 'n/a', 'N/a', 'None', 'NONE', 'none', 'null', 'NULL', 'undefined');

UPDATE warrants
   SET issuing_judge = NULL
 WHERE issuing_judge IN ('', 'N/A', 'n/a', 'N/a', 'None', 'NONE', 'none', 'null', 'NULL', 'undefined');

UPDATE warrants
   SET expires_at = NULL
 WHERE expires_at IN ('', 'N/A', 'n/a', 'N/a', 'None', 'NONE', 'none', 'null', 'NULL', 'undefined');

-- NOTE: the served_location UPDATE was removed — that column does not exist on
-- the live warrants table (it uses served_at / served_by / service_date). The
-- ADD-COLUMN was never applied to live, so this UPDATE errored with
-- "no such column: served_location" and blocked every deploy (the migration
-- guardrail halts on any failure). The remaining sentinel cleanups all target
-- columns that DO exist on live (verified via pragma_table_info).

UPDATE warrants
   SET notes = NULL
 WHERE notes IN ('', 'N/A', 'n/a', 'N/a', 'None', 'NONE', 'none', 'null', 'NULL', 'undefined');

UPDATE warrants
   SET source = NULL
 WHERE source IN ('N/A', 'n/a', 'N/a', 'None', 'NONE', 'none', 'null', 'NULL', 'undefined');

UPDATE warrants
   SET external_warrant_id = NULL
 WHERE external_warrant_id IN ('', 'N/A', 'n/a', 'N/a', 'None', 'NONE', 'none', 'null', 'NULL', 'undefined');

UPDATE warrants
   SET external_source_key = NULL
 WHERE external_source_key IN ('', 'N/A', 'n/a', 'N/a', 'None', 'NONE', 'none', 'null', 'NULL', 'undefined');
