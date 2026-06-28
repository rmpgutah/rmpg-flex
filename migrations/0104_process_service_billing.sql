-- ============================================================
-- 0104_process_service_billing.sql
-- Process Service Contracts billing: dynamic pricing rate card,
-- per-contract PS terms, computed serve charges + review state.
-- All idempotent. serve_queue is NOT on the column-cap watch list,
-- so the single ALTER is safe.
-- ============================================================

-- ── Dynamic pricing rate card (the rmpgutahps.us pricing source of truth) ──
CREATE TABLE IF NOT EXISTS ps_pricing_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  code              TEXT NOT NULL UNIQUE,
  label             TEXT NOT NULL,
  unit              TEXT NOT NULL DEFAULT 'per_serve'
                      CHECK(unit IN ('per_serve','per_attempt','per_mile','per_hour','flat')),
  amount            REAL NOT NULL DEFAULT 0,
  taxable           INTEGER NOT NULL DEFAULT 1,
  attempts_included INTEGER NOT NULL DEFAULT 0,
  is_active         INTEGER NOT NULL DEFAULT 1,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_by        INTEGER
);

-- ── Per-contract process-service terms (1:1 ext of client_contracts) ──
CREATE TABLE IF NOT EXISTS ps_contract_terms (
  contract_id         INTEGER PRIMARY KEY REFERENCES client_contracts(id) ON DELETE CASCADE,
  billing_trigger     TEXT NOT NULL DEFAULT 'on_completion'
                        CHECK(billing_trigger IN ('on_completion','on_service','per_attempt','manual')),
  sla_days            INTEGER,
  retainer_amount     REAL,
  doc_types_json      TEXT,
  rate_overrides_json TEXT,
  notes               TEXT,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_by          INTEGER
);

-- ── Computed charge header (one per billable job) ──
CREATE TABLE IF NOT EXISTS serve_charges (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  serve_queue_id INTEGER NOT NULL UNIQUE REFERENCES serve_queue(id) ON DELETE CASCADE,
  contract_id    INTEGER,
  status         TEXT NOT NULL DEFAULT 'pending_review'
                   CHECK(status IN ('pending_review','approved','invoiced','void')),
  subtotal       REAL NOT NULL DEFAULT 0,
  tax_amount     REAL NOT NULL DEFAULT 0,
  computed_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  reviewed_by    INTEGER,
  reviewed_at    TEXT,
  invoice_id     INTEGER,
  notes          TEXT
);
CREATE INDEX IF NOT EXISTS idx_serve_charges_status ON serve_charges(status);
CREATE INDEX IF NOT EXISTS idx_serve_charges_contract ON serve_charges(contract_id);

-- ── Charge line breakdown (mirrors invoice_line_items) ──
CREATE TABLE IF NOT EXISTS serve_charge_lines (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  serve_charge_id INTEGER NOT NULL REFERENCES serve_charges(id) ON DELETE CASCADE,
  pricing_code    TEXT,
  description     TEXT NOT NULL,
  quantity        REAL NOT NULL DEFAULT 1,
  unit_price      REAL NOT NULL DEFAULT 0,
  line_total      REAL NOT NULL DEFAULT 0,
  taxable         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_serve_charge_lines_charge ON serve_charge_lines(serve_charge_id);

-- ── Link serve jobs to their contract (single ALTER; no IF NOT EXISTS on ADD COLUMN in D1) ──
ALTER TABLE serve_queue ADD COLUMN contract_id INTEGER;

-- ── Seed standard pricing codes at amount 0 (owner sets real prices in the UI) ──
INSERT OR IGNORE INTO ps_pricing_items (code, label, unit, amount, taxable, attempts_included, sort_order) VALUES
  ('flat_serve',    'Standard Service',        'per_serve',   0, 1, 0, 10),
  ('rush',          'Rush / Same-Day',         'flat',        0, 1, 0, 20),
  ('extra_attempt', 'Additional Attempt',      'per_attempt', 0, 1, 3, 30),
  ('skip_trace',    'Skip Trace',              'flat',        0, 1, 0, 40),
  ('mileage',       'Mileage',                 'per_mile',    0, 0, 0, 50),
  ('wait',          'Stakeout / Wait Time',    'per_hour',    0, 1, 0, 60);
