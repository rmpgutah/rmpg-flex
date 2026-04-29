import type Database from 'better-sqlite3';

// Court Tracker — extended schema for admin-editable lookups + witnesses +
// sentence/plea/restitution detail. Run as part of database init.
//
// Convention: each CREATE/INDEX is its own prepare().run() so the security
// hook (CLAUDE.md gotcha #42) doesn't choke on the bulk-execute literal.
//
// The court_lookups table is the architectural payoff — every dropdown in
// the Court Tracker UI (courts, judges, prosecutors, defense attorneys,
// event types, outcomes, charge codes) becomes admin-editable. Adding a new
// dropdown category is a single INSERT into court_lookups; no schema or
// code change required.

export function ensureCourtSchema(db: Database.Database): void {
  const stmts: string[] = [
    // ─── Admin-editable lookups ─────────────────────────────────
    // Single table that holds every editable enum-like list in the
    // Court Tracker. Categories are free strings (e.g. 'court',
    // 'judge', 'prosecutor', 'event_type', 'outcome'). Sort by
    // display_order for predictable dropdown UX.
    `CREATE TABLE IF NOT EXISTS court_lookups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      value TEXT NOT NULL,
      display_label TEXT,
      meta TEXT,
      display_order INTEGER DEFAULT 100,
      is_active INTEGER DEFAULT 1,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(category, value)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_court_lookups_cat ON court_lookups(category, display_order)`,
    `CREATE INDEX IF NOT EXISTS idx_court_lookups_active ON court_lookups(category, is_active)`,

    // ─── Witnesses ──────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS court_witnesses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      person_id INTEGER,
      witness_name TEXT NOT NULL,
      witness_type TEXT,
      contact_phone TEXT,
      contact_email TEXT,
      address TEXT,
      subpoena_served INTEGER DEFAULT 0,
      served_at TEXT,
      served_by_user_id INTEGER,
      appearance_required INTEGER DEFAULT 1,
      appeared INTEGER DEFAULT 0,
      testified INTEGER DEFAULT 0,
      witness_fee REAL,
      mileage_miles REAL,
      reimbursement_total REAL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (event_id) REFERENCES court_events(id) ON DELETE CASCADE,
      FOREIGN KEY (person_id) REFERENCES persons(id),
      FOREIGN KEY (served_by_user_id) REFERENCES users(id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_court_witnesses_event ON court_witnesses(event_id)`,

    // ─── Sentence detail (one-to-one with court_events for sentenced cases) ─
    `CREATE TABLE IF NOT EXISTS court_sentences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL UNIQUE,
      incarceration_days INTEGER,
      incarceration_facility TEXT,
      probation_months INTEGER,
      probation_terms TEXT,
      community_service_hours INTEGER,
      fine_amount REAL,
      court_costs REAL,
      restitution_amount REAL,
      restitution_payee TEXT,
      protective_order INTEGER DEFAULT 0,
      no_contact_order INTEGER DEFAULT 0,
      treatment_required TEXT,
      license_suspended INTEGER DEFAULT 0,
      license_suspension_months INTEGER,
      additional_terms TEXT,
      sentenced_at TEXT,
      sentencing_judge TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (event_id) REFERENCES court_events(id) ON DELETE CASCADE
    )`,

    // ─── Plea history (chronological — defendant can change pleas) ─
    `CREATE TABLE IF NOT EXISTS court_pleas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      plea TEXT NOT NULL,
      plea_date TEXT NOT NULL,
      charge TEXT,
      notes TEXT,
      entered_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (event_id) REFERENCES court_events(id) ON DELETE CASCADE,
      FOREIGN KEY (entered_by_user_id) REFERENCES users(id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_court_pleas_event ON court_pleas(event_id, plea_date)`,

    // ─── Restitution payments ledger ────────────────────────────
    `CREATE TABLE IF NOT EXISTS court_restitution_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      paid_at TEXT NOT NULL,
      method TEXT,
      reference_number TEXT,
      received_by_user_id INTEGER,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (event_id) REFERENCES court_events(id) ON DELETE CASCADE,
      FOREIGN KEY (received_by_user_id) REFERENCES users(id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_court_rest_event ON court_restitution_payments(event_id, paid_at)`,

    // ─── Per-officer appearance tracking ────────────────────────
    // Replaces the JSON officers_required array on court_events with a
    // proper one-to-many table. Each row tracks whether that officer
    // confirmed, appeared, testified, and any travel reimbursement.
    `CREATE TABLE IF NOT EXISTS court_officer_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT,
      confirmed INTEGER DEFAULT 0,
      confirmed_at TEXT,
      appeared INTEGER DEFAULT 0,
      testified INTEGER DEFAULT 0,
      mileage_miles REAL,
      hours_billed REAL,
      reimbursement_total REAL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(event_id, user_id),
      FOREIGN KEY (event_id) REFERENCES court_events(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_court_assignments_event ON court_officer_assignments(event_id)`,
    `CREATE INDEX IF NOT EXISTS idx_court_assignments_user ON court_officer_assignments(user_id)`,

    // ─── Reminders queue (one event can have multiple) ──────────
    `CREATE TABLE IF NOT EXISTS court_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      remind_at TEXT NOT NULL,
      target_user_id INTEGER,
      method TEXT DEFAULT 'in_app',
      message TEXT,
      sent INTEGER DEFAULT 0,
      sent_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (event_id) REFERENCES court_events(id) ON DELETE CASCADE,
      FOREIGN KEY (target_user_id) REFERENCES users(id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_court_reminders_due ON court_reminders(remind_at, sent)`,
  ];

  for (const sql of stmts) db.prepare(sql).run();

  seedDefaultLookups(db);
}

/**
 * Seed default lookup values from the previously-hardcoded enums so the
 * UI has options on day one. Idempotent — only inserts if the category
 * is currently empty for that value.
 */
function seedDefaultLookups(db: Database.Database): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO court_lookups (category, value, display_label, display_order)
     VALUES (?, ?, ?, ?)`
  );
  const seeds: Array<[string, string, string, number]> = [
    // event types — mirror the hardcoded EVENT_TYPES in CourtTrackerPage.tsx
    ['event_type', 'arraignment', 'Arraignment', 10],
    ['event_type', 'hearing', 'Hearing', 20],
    ['event_type', 'trial', 'Trial', 30],
    ['event_type', 'sentencing', 'Sentencing', 40],
    ['event_type', 'motion', 'Motion', 50],
    ['event_type', 'subpoena', 'Subpoena', 60],
    ['event_type', 'continuance', 'Continuance', 70],
    ['event_type', 'disposition', 'Disposition', 80],
    ['event_type', 'pre_trial', 'Pre-Trial Conference', 25],
    ['event_type', 'settlement', 'Settlement Conference', 26],
    ['event_type', 'appeal', 'Appeal Hearing', 90],
    // outcomes
    ['outcome', 'guilty', 'Guilty', 10],
    ['outcome', 'not_guilty', 'Not Guilty', 20],
    ['outcome', 'no_contest', 'No Contest', 30],
    ['outcome', 'dismissed', 'Dismissed', 40],
    ['outcome', 'continued', 'Continued', 50],
    ['outcome', 'plea_bargain', 'Plea Bargain', 60],
    ['outcome', 'mistrial', 'Mistrial', 70],
    ['outcome', 'withdrawn', 'Withdrawn', 80],
    // pleas
    ['plea', 'guilty', 'Guilty', 10],
    ['plea', 'not_guilty', 'Not Guilty', 20],
    ['plea', 'no_contest', 'No Contest / Nolo Contendere', 30],
    ['plea', 'standing_mute', 'Standing Mute', 40],
    // bond status
    ['bond_status', 'released', 'Released on Own Recognizance', 10],
    ['bond_status', 'cash_bond', 'Cash Bond Posted', 20],
    ['bond_status', 'surety_bond', 'Surety Bond Posted', 30],
    ['bond_status', 'property_bond', 'Property Bond Posted', 40],
    ['bond_status', 'detained', 'Detained Without Bond', 50],
    ['bond_status', 'forfeited', 'Bond Forfeited', 60],
    // witness types
    ['witness_type', 'fact', 'Fact Witness', 10],
    ['witness_type', 'expert', 'Expert Witness', 20],
    ['witness_type', 'character', 'Character Witness', 30],
    ['witness_type', 'eyewitness', 'Eyewitness', 40],
    ['witness_type', 'victim', 'Victim Witness', 50],
    // officer assignment roles
    ['officer_role', 'arresting', 'Arresting Officer', 10],
    ['officer_role', 'investigating', 'Investigating Officer', 20],
    ['witness_type', 'reporting', 'Reporting Officer', 30],
    ['officer_role', 'evidence_custodian', 'Evidence Custodian', 30],
    ['officer_role', 'expert', 'Expert / Specialist', 40],
    // courts seed (Salt Lake County area — RMPG operational)
    ['court', 'slc_justice', 'Salt Lake City Justice Court', 10],
    ['court', 'slcounty_justice', 'Salt Lake County Justice Court', 20],
    ['court', 'third_district', '3rd District Court (Salt Lake)', 30],
    ['court', 'utah_supreme', 'Utah Supreme Court', 90],
    ['court', 'utah_appeals', 'Utah Court of Appeals', 91],
  ];
  for (const [cat, val, label, order] of seeds) insert.run(cat, val, label, order);
}
