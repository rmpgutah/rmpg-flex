-- 0171: fleet_expenses — per-vehicle expense tracking (registration,
-- tolls, parking, car wash, tickets, towing, permits, insurance,
-- equipment, decals/wraps, storage, roadside assistance, inspection,
-- electronics, accessories, misc). Backs FleetExpensesTab.tsx, which
-- was shipped with a complete UI but no matching table/routes
-- (broken-functionality audit, 2026-07-04). Category CHECK mirrors
-- FleetExpenseCategory in client/src/types.ts — keep the two in sync.
CREATE TABLE IF NOT EXISTS fleet_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL,
  expense_date TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN (
    'registration','tolls','parking','car_wash','tickets','towing','permits',
    'insurance','equipment','decals_wraps','storage','roadside_assistance',
    'inspection','electronics','accessories','misc'
  )),
  amount REAL NOT NULL,
  vendor TEXT,
  description TEXT,
  receipt_path TEXT,
  odometer_reading INTEGER,
  recurring INTEGER NOT NULL DEFAULT 0,
  recurring_frequency TEXT,
  notes TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  archived_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_fleet_expenses_vehicle ON fleet_expenses(vehicle_id, expense_date);
