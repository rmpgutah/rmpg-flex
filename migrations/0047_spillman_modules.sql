-- 0047_spillman_modules.sql
-- 100 new Spillman Flex parity features across 12 module groups.
-- Idempotent: all CREATE TABLE IF NOT EXISTS.

-- ═══════════════════════════════════════════════════════════════
-- 1. JAIL MANAGEMENT (Spillman Flex Jail module parity)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS inmates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_number TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  first_name    TEXT NOT NULL,
  middle_name   TEXT,
  dob           TEXT,
  gender        TEXT,
  race          TEXT,
  height_inches INTEGER,
  weight_lbs    INTEGER,
  hair_color    TEXT,
  eye_color     TEXT,
  skin_tone     TEXT,
  marks_scars_tattoos TEXT,
  housing_unit  TEXT,
  housing_cell  TEXT,
  booking_date  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  arresting_agency TEXT,
  arresting_officer_id INTEGER,
  arrest_incident_id INTEGER,
  bail_amount   REAL,
  bond_type     TEXT,
  status        TEXT NOT NULL DEFAULT 'booked' CHECK(status IN ('booked','housed','court','medical','released','transferred')),
  release_date  TEXT,
  release_reason TEXT,
  notes         TEXT,
  created_by    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);

CREATE TABLE IF NOT EXISTS inmate_charges (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  inmate_id     INTEGER NOT NULL,
  charge_description TEXT NOT NULL,
  statute_code  TEXT,
  offense_level TEXT,
  warrant_number TEXT,
  court_docket  TEXT,
  bond_amount   REAL,
  disposition   TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS inmate_visitors (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  inmate_id     INTEGER NOT NULL,
  visitor_name  TEXT NOT NULL,
  relationship  TEXT,
  visit_date    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  visit_type    TEXT DEFAULT 'in_person' CHECK(visit_type IN ('in_person','video','phone','attorney')),
  check_in      TEXT,
  check_out     TEXT,
  officer_id    INTEGER,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS inmate_property (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  inmate_id     INTEGER NOT NULL,
  item_description TEXT NOT NULL,
  item_category TEXT,
  quantity      INTEGER DEFAULT 1,
  value_estimate REAL,
  stored_location TEXT,
  status        TEXT DEFAULT 'held' CHECK(status IN ('held','returned','transferred','destroyed')),
  returned_date TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS inmate_medical (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  inmate_id     INTEGER NOT NULL,
  screening_type TEXT NOT NULL,
  findings      TEXT,
  prescribed_med TEXT,
  allergies     TEXT,
  suicide_risk  INTEGER DEFAULT 0,
  cleared_for_booking INTEGER DEFAULT 1,
  screened_by TEXT,
  screened_date TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS inmate_disciplinary (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  inmate_id     INTEGER NOT NULL,
  violation     TEXT NOT NULL,
  violation_date TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  reported_by   INTEGER,
  sanction      TEXT,
  hearing_date  TEXT,
  hearing_outcome TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS inmate_transports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  inmate_id     INTEGER NOT NULL,
  destination   TEXT NOT NULL,
  reason        TEXT,
  depart_date   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  return_date   TEXT,
  transporting_officer_id INTEGER,
  vehicle_id    INTEGER,
  status        TEXT DEFAULT 'scheduled' CHECK(status IN ('scheduled','in_transit','completed','cancelled')),
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ═══════════════════════════════════════════════════════════════
-- 2. INTERNAL AFFAIRS / PROFESSIONAL STANDARDS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ia_complaints (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  complaint_number TEXT NOT NULL,
  complainant_name TEXT,
  complainant_contact TEXT,
  subject_officer_id INTEGER,
  complaint_type TEXT CHECK(complaint_type IN ('excessive_force','discourtesy','dishonesty','policy_violation','criminal','other')),
  description   TEXT NOT NULL,
  incident_date TEXT,
  incident_location TEXT,
  witnesses     TEXT,
  evidence_list TEXT,
  status        TEXT DEFAULT 'received' CHECK(status IN ('received','assigned','under_investigation','sustained','not_sustained','exonerated','unfounded','closed')),
  assigned_to   INTEGER,
  finding       TEXT,
  discipline    TEXT,
  closed_date   TEXT,
  created_by    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);

CREATE TABLE IF NOT EXISTS ia_investigations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  complaint_id  INTEGER NOT NULL,
  investigator_id INTEGER,
  started_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  completed_at  TEXT,
  summary       TEXT,
  findings      TEXT,
  recommendations TEXT,
  reviewed_by   INTEGER,
  reviewed_at   TEXT,
  status        TEXT DEFAULT 'open' CHECK(status IN ('open','in_progress','completed','reviewed')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS early_intervention_flags (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id    INTEGER NOT NULL,
  flag_type     TEXT CHECK(flag_type IN ('use_of_force_frequency','complaint_threshold','sick_leave_pattern','pursuit_frequency','overtime_threshold','other')),
  trigger_value REAL,
  threshold     REAL,
  description   TEXT,
  flagged_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  resolved_at   TEXT,
  resolution    TEXT,
  created_by    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ═══════════════════════════════════════════════════════════════
-- 3. ASSET / EQUIPMENT MANAGEMENT
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS asset_inventory (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_tag     TEXT NOT NULL,
  asset_type    TEXT CHECK(asset_type IN ('weapon','body_camera','radio','taserr','computer','vehicle_accessory','uniform','ppe','k9_equipment','other')),
  make          TEXT,
  model         TEXT,
  serial_number TEXT,
  status        TEXT DEFAULT 'available' CHECK(status IN ('available','issued','maintenance','retired','lost')),
  assigned_to   INTEGER,
  issued_date   TEXT,
  return_date   TEXT,
  purchase_date TEXT,
  purchase_cost REAL,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);

CREATE TABLE IF NOT EXISTS asset_checkouts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id      INTEGER NOT NULL,
  checked_out_to INTEGER NOT NULL,
  checkout_date TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  expected_return TEXT,
  actual_return TEXT,
  condition_out TEXT,
  condition_in  TEXT,
  authorized_by INTEGER,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS weapon_inventory (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  weapon_type   TEXT CHECK(weapon_type IN ('handgun','shotgun','rifle','less_lethal','taser','baton','oc_spray','other')),
  make          TEXT,
  model         TEXT,
  caliber       TEXT,
  serial_number TEXT NOT NULL,
  status        TEXT DEFAULT 'armory' CHECK(status IN ('armory','issued','maintenance','destroyed','lost_stolen')),
  assigned_to   INTEGER,
  issued_date   TEXT,
  last_qualified TEXT,
  next_qual_due TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);

CREATE TABLE IF NOT EXISTS ammunition_inventory (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ammo_type     TEXT NOT NULL,
  caliber       TEXT NOT NULL,
  manufacturer  TEXT,
  lot_number    TEXT,
  quantity_rounds INTEGER NOT NULL DEFAULT 0,
  quantity_issued INTEGER DEFAULT 0,
  issued_to     INTEGER,
  issued_date   TEXT,
  expiration_date TEXT,
  storage_location TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS k9_records (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  k9_name       TEXT NOT NULL,
  breed         TEXT,
  handler_id    INTEGER,
  status        TEXT DEFAULT 'active' CHECK(status IN ('active','medical_leave','retired','deceased')),
  certified_date TEXT,
  cert_expiry   TEXT,
  specialties   TEXT,
  vet_last_visit TEXT,
  vet_next_due  TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);

-- ═══════════════════════════════════════════════════════════════
-- 4. COMMUNITY ENGAGEMENT
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS community_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_name    TEXT NOT NULL,
  event_type    TEXT CHECK(event_type IN ('outreach','training','meeting','fundraiser','patrol_ride_along','other')),
  description   TEXT,
  location      TEXT,
  start_date    TEXT NOT NULL,
  end_date      TEXT,
  organizer_id  INTEGER,
  attendees_count INTEGER DEFAULT 0,
  status        TEXT DEFAULT 'planned' CHECK(status IN ('planned','in_progress','completed','cancelled')),
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS public_tips (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tip_number    TEXT NOT NULL,
  submitter_name TEXT,
  submitter_contact TEXT,
  is_anonymous  INTEGER DEFAULT 0,
  tip_text      TEXT NOT NULL,
  category      TEXT,
  location      TEXT,
  priority      TEXT DEFAULT 'normal' CHECK(priority IN ('low','normal','high','critical')),
  status        TEXT DEFAULT 'new' CHECK(status IN ('new','assigned','under_review','actioned','closed','unfounded')),
  assigned_to   INTEGER,
  resolution    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);

CREATE TABLE IF NOT EXISTS neighborhood_watch_groups (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  group_name    TEXT NOT NULL,
  neighborhood  TEXT,
  beat_id       INTEGER,
  coordinator_name TEXT,
  coordinator_contact TEXT,
  member_count  INTEGER DEFAULT 0,
  last_meeting  TEXT,
  next_meeting  TEXT,
  status        TEXT DEFAULT 'active' CHECK(status IN ('active','inactive')),
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS community_alerts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_title   TEXT NOT NULL,
  alert_text    TEXT NOT NULL,
  alert_type    TEXT CHECK(alert_type IN ('safety','crime','weather','missing_person','traffic','other')),
  severity      TEXT DEFAULT 'info' CHECK(severity IN ('info','warning','critical','emergency')),
  target_area   TEXT,
  target_beat_ids TEXT,
  sent_via_email INTEGER DEFAULT 0,
  sent_via_sms   INTEGER DEFAULT 0,
  sent_via_push  INTEGER DEFAULT 0,
  sent_at       TEXT,
  expires_at    TEXT,
  created_by    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ═══════════════════════════════════════════════════════════════
-- 5. TASK / WORK MANAGEMENT
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS task_assignments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  task_title    TEXT NOT NULL,
  description   TEXT,
  task_type     TEXT DEFAULT 'general',
  priority      TEXT DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
  status        TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','review','completed','cancelled')),
  assigned_to   INTEGER,
  assigned_by   INTEGER,
  due_date      TEXT,
  completed_at  TEXT,
  linked_entity_type TEXT,
  linked_entity_id   INTEGER,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);

CREATE TABLE IF NOT EXISTS task_comments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id       INTEGER NOT NULL,
  user_id       INTEGER NOT NULL,
  comment_text  TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ═══════════════════════════════════════════════════════════════
-- 6. MASS NOTIFICATION (Spillman Rave Alert parity)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS notification_templates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  template_name TEXT NOT NULL,
  subject       TEXT,
  body          TEXT NOT NULL,
  channel       TEXT DEFAULT 'email' CHECK(channel IN ('email','sms','push','all')),
  category      TEXT DEFAULT 'general',
  created_by    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);

CREATE TABLE IF NOT EXISTS notification_batches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_name    TEXT,
  template_id   INTEGER,
  channel       TEXT,
  recipient_count INTEGER DEFAULT 0,
  sent_count    INTEGER DEFAULT 0,
  failed_count  INTEGER DEFAULT 0,
  status        TEXT DEFAULT 'draft' CHECK(status IN ('draft','sending','sent','partial','failed')),
  sent_at       TEXT,
  created_by    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS notification_recipients (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id      INTEGER NOT NULL,
  recipient_name TEXT,
  contact       TEXT NOT NULL,
  channel       TEXT,
  status        TEXT DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')),
  sent_at       TEXT,
  error_message TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ═══════════════════════════════════════════════════════════════
-- 7. TRAINING MANAGEMENT (enhanced beyond existing training table)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS training_courses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  course_name   TEXT NOT NULL,
  course_code   TEXT,
  description   TEXT,
  category      TEXT CHECK(category IN ('firearms','defensive_tactics','legal','first_aid','de_escalation','professionalism','technical','other')),
  duration_hours REAL,
  instructor_id INTEGER,
  location      TEXT,
  max_seats     INTEGER,
  is_mandatory  INTEGER DEFAULT 0,
  is_active     INTEGER DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS training_enrollments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id     INTEGER NOT NULL,
  officer_id    INTEGER NOT NULL,
  status        TEXT DEFAULT 'enrolled' CHECK(status IN ('enrolled','attended','no_show','completed','failed')),
  score         REAL,
  completed_date TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS certification_types (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  cert_name     TEXT NOT NULL,
  issuing_body  TEXT,
  description   TEXT,
  renewal_period_months INTEGER,
  is_active     INTEGER DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS officer_certifications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id    INTEGER NOT NULL,
  cert_type_id  INTEGER NOT NULL,
  cert_number   TEXT,
  issued_date   TEXT,
  expiration_date TEXT,
  status        TEXT DEFAULT 'active' CHECK(status IN ('active','expired','revoked','pending')),
  document_url  TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS firearms_qualifications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id    INTEGER NOT NULL,
  weapon_type   TEXT,
  course_name   TEXT,
  qualification_date TEXT NOT NULL,
  score         REAL,
  max_score     REAL DEFAULT 100,
  pass_fail     TEXT CHECK(pass_fail IN ('pass','fail')),
  range_officer_id INTEGER,
  ammo_used     INTEGER,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ═══════════════════════════════════════════════════════════════
-- 8. QUALITY ASSURANCE
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS qa_reviews (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  review_number TEXT NOT NULL,
  review_type   TEXT CHECK(review_type IN ('call_audit','report_review','bodycam_audit','investigation_review','dispatch_audit','other')),
  entity_type   TEXT,
  entity_id     INTEGER,
  reviewer_id   INTEGER,
  reviewed_officer_id INTEGER,
  score         REAL,
  max_score     REAL DEFAULT 100,
  status        TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','disputed','resolved')),
  review_date   TEXT,
  findings      TEXT,
  recommendations TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);

CREATE TABLE IF NOT EXISTS qa_criteria (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  review_type   TEXT NOT NULL,
  criterion     TEXT NOT NULL,
  description   TEXT,
  max_points    REAL DEFAULT 5,
  weight        REAL DEFAULT 1,
  is_active     INTEGER DEFAULT 1,
  sort_order    INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS qa_scores (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id     INTEGER NOT NULL,
  criterion_id  INTEGER NOT NULL,
  score         REAL NOT NULL,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS customer_satisfaction_surveys (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  survey_type   TEXT CHECK(survey_type IN ('call_response','officer_interaction','patrol_service','other')),
  entity_id     INTEGER,
  respondent_name TEXT,
  respondent_contact TEXT,
  rating        INTEGER CHECK(rating >= 1 AND rating <= 5),
  comments      TEXT,
  would_recommend INTEGER,
  submitted_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ═══════════════════════════════════════════════════════════════
-- 9. BILLING / FINANCIAL
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS client_contracts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id     INTEGER NOT NULL,
  contract_number TEXT,
  contract_type TEXT,
  start_date    TEXT NOT NULL,
  end_date      TEXT,
  billing_cycle TEXT DEFAULT 'monthly' CHECK(billing_cycle IN ('weekly','biweekly','monthly','quarterly','annual','one_time')),
  rate_amount   REAL,
  rate_type     TEXT DEFAULT 'flat' CHECK(rate_type IN ('flat','hourly','per_call','per_officer','other')),
  status        TEXT DEFAULT 'active' CHECK(status IN ('draft','active','suspended','expired','terminated')),
  auto_renew    INTEGER DEFAULT 0,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);

CREATE TABLE IF NOT EXISTS invoices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT NOT NULL,
  client_id     INTEGER,
  contract_id   INTEGER,
  issue_date    TEXT NOT NULL DEFAULT (date('now')),
  due_date      TEXT,
  subtotal      REAL DEFAULT 0,
  tax_rate      REAL DEFAULT 0,
  tax_amount    REAL DEFAULT 0,
  total_amount  REAL DEFAULT 0,
  paid_amount   REAL DEFAULT 0,
  status        TEXT DEFAULT 'draft' CHECK(status IN ('draft','sent','partial','paid','overdue','void','cancelled')),
  notes         TEXT,
  created_by    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id    INTEGER NOT NULL,
  description   TEXT NOT NULL,
  quantity      REAL DEFAULT 1,
  unit_price    REAL DEFAULT 0,
  line_total    REAL DEFAULT 0,
  tax_applied   INTEGER DEFAULT 1,
  sort_order    INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id    INTEGER,
  client_id     INTEGER,
  payment_date  TEXT NOT NULL DEFAULT (date('now')),
  amount        REAL NOT NULL,
  payment_method TEXT DEFAULT 'check' CHECK(payment_method IN ('check','ach','wire','credit_card','cash','other')),
  reference_number TEXT,
  notes         TEXT,
  recorded_by   INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS expense_reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  report_number TEXT NOT NULL,
  submitter_id  INTEGER NOT NULL,
  category      TEXT,
  description   TEXT,
  amount        REAL NOT NULL,
  expense_date  TEXT NOT NULL DEFAULT (date('now')),
  receipt_url   TEXT,
  status        TEXT DEFAULT 'submitted' CHECK(status IN ('draft','submitted','approved','rejected','reimbursed')),
  approved_by   INTEGER,
  approved_at   TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ═══════════════════════════════════════════════════════════════
-- 10. RISK MANAGEMENT
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS risk_assessments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  assessment_number TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     INTEGER,
  risk_level    TEXT DEFAULT 'low' CHECK(risk_level IN ('low','moderate','high','critical')),
  risk_category TEXT,
  description   TEXT,
  assessed_by   INTEGER,
  assessed_date TEXT NOT NULL DEFAULT (date('now')),
  mitigation_plan TEXT,
  review_date   TEXT,
  status        TEXT DEFAULT 'active' CHECK(status IN ('active','mitigated','accepted','closed')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);

CREATE TABLE IF NOT EXISTS safety_inspections (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_number TEXT NOT NULL,
  location      TEXT NOT NULL,
  inspection_type TEXT CHECK(inspection_type IN ('facility','vehicle','equipment','fire_safety','hazmat','general')),
  inspector_id  INTEGER,
  inspection_date TEXT NOT NULL DEFAULT (date('now')),
  pass_fail     TEXT CHECK(pass_fail IN ('pass','fail','conditional')),
  findings      TEXT,
  corrective_actions TEXT,
  next_inspection_due TEXT,
  status        TEXT DEFAULT 'pending' CHECK(status IN ('pending','completed','failed','corrected')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS insurance_claims (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_number  TEXT NOT NULL,
  claim_type    TEXT CHECK(claim_type IN ('auto','general_liability','workers_comp','property','professional_liability','other')),
  incident_date TEXT NOT NULL,
  description   TEXT NOT NULL,
  reported_by   INTEGER,
  reported_date TEXT NOT NULL DEFAULT (date('now')),
  insurer_name  TEXT,
  policy_number TEXT,
  claim_amount  REAL,
  settlement_amount REAL,
  status        TEXT DEFAULT 'reported' CHECK(status IN ('reported','under_review','approved','denied','settled','closed')),
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);

-- ═══════════════════════════════════════════════════════════════
-- 11. INTERAGENCY DATA SHARING
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS interagency_partners (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  agency_name   TEXT NOT NULL,
  agency_type   TEXT,
  jurisdiction  TEXT,
  contact_name  TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  data_share_level TEXT DEFAULT 'none' CHECK(data_share_level IN ('none','basic','partial','full')),
  status        TEXT DEFAULT 'active' CHECK(status IN ('active','pending','suspended','inactive')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);

CREATE TABLE IF NOT EXISTS data_share_agreements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id    INTEGER NOT NULL,
  agreement_name TEXT NOT NULL,
  agreement_type TEXT CHECK(agreement_type IN ('moa','mou','nda','data_share','fusion_center','other')),
  effective_date TEXT NOT NULL,
  expiration_date TEXT,
  data_scope    TEXT,
  signed_by      TEXT,
  signed_date   TEXT,
  status        TEXT DEFAULT 'draft' CHECK(status IN ('draft','active','expired','terminated')),
  document_url  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);

CREATE TABLE IF NOT EXISTS data_exchange_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id    INTEGER,
  agreement_id  INTEGER,
  exchange_type TEXT CHECK(exchange_type IN ('query','push','pull','broadcast')),
  data_type     TEXT,
  record_count  INTEGER DEFAULT 0,
  status        TEXT DEFAULT 'success' CHECK(status IN ('success','partial','failed')),
  initiated_by  INTEGER,
  initiated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  completed_at  TEXT,
  error_message TEXT
);

-- ═══════════════════════════════════════════════════════════════
-- 12. GIS / MAPPING ENHANCEMENTS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS geofence_zones (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_name     TEXT NOT NULL,
  zone_type     TEXT CHECK(zone_type IN ('exclusion','inclusion','alert','patrol_required')),
  geojson_data  TEXT NOT NULL,
  description   TEXT,
  color         TEXT DEFAULT '#d4a017',
  is_active     INTEGER DEFAULT 1,
  created_by    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);

CREATE TABLE IF NOT EXISTS crime_heatmap_data (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  data_date     TEXT NOT NULL,
  geohash       TEXT NOT NULL,
  incident_count INTEGER DEFAULT 0,
  crime_category TEXT,
  severity_weight REAL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS response_time_zones (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_label    TEXT NOT NULL,
  centroid_lat  REAL NOT NULL,
  centroid_lng  REAL NOT NULL,
  target_response_minutes INTEGER NOT NULL,
  actual_avg_minutes_30d   REAL,
  beat_id       INTEGER,
  is_active     INTEGER DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
