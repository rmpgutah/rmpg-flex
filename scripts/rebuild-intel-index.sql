-- Rebuild intel_index FTS5 from source tables
-- Each DELETE + INSERT pair is isolated per entity_type

DELETE FROM intel_index WHERE entity_type = 'person';
INSERT INTO intel_index (entity_type, entity_id, label, body, identifiers)
SELECT 'person', id,
  TRIM(COALESCE(NULLIF(TRIM(first_name), '') || ' ', '') || COALESCE(NULLIF(TRIM(last_name), ''), '')),
  TRIM(COALESCE(NULLIF(TRIM(address), ''), '') || ' ' || COALESCE(NULLIF(TRIM(city), ''), '') || ' ' || COALESCE(NULLIF(TRIM(flags), ''), '')),
  TRIM(COALESCE(NULLIF(TRIM(dob), ''), '') || ' ' || COALESCE(NULLIF(TRIM(phone), ''), ''))
FROM persons;

DELETE FROM intel_index WHERE entity_type = 'vehicle';
INSERT INTO intel_index (entity_type, entity_id, label, body, identifiers)
SELECT 'vehicle', id,
  TRIM(COALESCE(NULLIF(TRIM(color), ''), '') || ' ' || COALESCE(NULLIF(TRIM(year), ''), '') || ' ' || COALESCE(NULLIF(TRIM(make), ''), '') || ' ' || COALESCE(NULLIF(TRIM(model), ''), '')),
  '',
  TRIM(COALESCE(NULLIF(TRIM(plate_number), ''), '') || ' ' || COALESCE(NULLIF(TRIM(vin), ''), ''))
FROM vehicles_records;

DELETE FROM intel_index WHERE entity_type = 'property';
INSERT INTO intel_index (entity_type, entity_id, label, body, identifiers)
SELECT 'property', id,
  COALESCE(NULLIF(TRIM(name), ''), 'Property #' || id),
  TRIM(COALESCE(NULLIF(TRIM(address), ''), '') || ' ' || COALESCE(NULLIF(TRIM(property_type), ''), '')),
  ''
FROM properties;

DELETE FROM intel_index WHERE entity_type = 'case';
INSERT INTO intel_index (entity_type, entity_id, label, body, identifiers)
SELECT 'case', id,
  TRIM(COALESCE(NULLIF(TRIM(case_number), ''), '') || ' ' || COALESCE(NULLIF(TRIM(title), ''), '')),
  TRIM(COALESCE(NULLIF(TRIM(case_type), ''), '') || ' ' || COALESCE(NULLIF(TRIM(status), ''), '')),
  COALESCE(NULLIF(TRIM(case_number), ''), '')
FROM cases;

DELETE FROM intel_index WHERE entity_type = 'incident';
INSERT INTO intel_index (entity_type, entity_id, label, body, identifiers)
SELECT 'incident', id,
  TRIM(COALESCE(NULLIF(TRIM(incident_number), ''), '') || ' ' || COALESCE(NULLIF(TRIM(incident_type), ''), '')),
  TRIM(COALESCE(NULLIF(TRIM(status), ''), '') || ' ' || COALESCE(NULLIF(TRIM(location_address), ''), '')),
  COALESCE(NULLIF(TRIM(incident_number), ''), '')
FROM incidents;

DELETE FROM intel_index WHERE entity_type = 'call';
INSERT INTO intel_index (entity_type, entity_id, label, body, identifiers)
SELECT 'call', id,
  TRIM(COALESCE(NULLIF(TRIM(call_number), ''), '') || ' ' || COALESCE(NULLIF(TRIM(incident_type), ''), '')),
  TRIM(COALESCE(NULLIF(TRIM(status), ''), '') || ' ' || COALESCE(NULLIF(TRIM(location_address), ''), '')),
  COALESCE(NULLIF(TRIM(call_number), ''), '')
FROM calls_for_service;

DELETE FROM intel_index WHERE entity_type = 'warrant';
INSERT INTO intel_index (entity_type, entity_id, label, body, identifiers)
SELECT 'warrant', id,
  COALESCE(NULLIF(TRIM(warrant_number), ''), 'Warrant #' || id),
  TRIM(COALESCE(NULLIF(TRIM(status), ''), '') || ' ' || COALESCE(NULLIF(TRIM(type), ''), '') || ' ' || COALESCE(NULLIF(TRIM(charge_description), ''), '')),
  COALESCE(NULLIF(TRIM(warrant_number), ''), '')
FROM warrants;

DELETE FROM intel_index WHERE entity_type = 'citation';
INSERT INTO intel_index (entity_type, entity_id, label, body, identifiers)
SELECT 'citation', id,
  COALESCE(NULLIF(TRIM(citation_number), ''), 'Citation #' || id),
  TRIM(COALESCE(NULLIF(TRIM(type), ''), '') || ' ' || COALESCE(NULLIF(TRIM(status), ''), '') || ' ' || COALESCE(NULLIF(TRIM(violation_description), ''), '')),
  COALESCE(NULLIF(TRIM(citation_number), ''), '')
FROM citations;

DELETE FROM intel_index WHERE entity_type = 'field_interview';
INSERT INTO intel_index (entity_type, entity_id, label, body, identifiers)
SELECT 'field_interview', id,
  COALESCE(NULLIF(TRIM(fi_number), ''), 'FI #' || id),
  TRIM(COALESCE(NULLIF(TRIM(location), ''), '') || ' ' || COALESCE(NULLIF(TRIM(contact_reason), ''), '')),
  COALESCE(NULLIF(TRIM(fi_number), ''), '')
FROM field_interviews;

DELETE FROM intel_index WHERE entity_type = 'trespass_order';
INSERT INTO intel_index (entity_type, entity_id, label, body, identifiers)
SELECT 'trespass_order', id,
  COALESCE(NULLIF(TRIM(order_number), ''), 'Trespass #' || id),
  TRIM(COALESCE(NULLIF(TRIM(location), ''), '') || ' ' || COALESCE(NULLIF(TRIM(status), ''), '')),
  COALESCE(NULLIF(TRIM(order_number), ''), '')
FROM trespass_orders;

DELETE FROM intel_index WHERE entity_type = 'evidence';
INSERT INTO intel_index (entity_type, entity_id, label, body, identifiers)
SELECT 'evidence', id,
  COALESCE(NULLIF(TRIM(evidence_number), ''), 'Evidence #' || id),
  TRIM(COALESCE(NULLIF(TRIM(description), ''), '') || ' ' || COALESCE(NULLIF(TRIM(evidence_type), ''), '') || ' ' || COALESCE(NULLIF(TRIM(status), ''), '')),
  COALESCE(NULLIF(TRIM(evidence_number), ''), '')
FROM evidence;

DELETE FROM intel_index WHERE entity_type = 'intel_report';
INSERT INTO intel_index (entity_type, entity_id, label, body, identifiers)
SELECT 'intel_report', id,
  TRIM(COALESCE(NULLIF(TRIM(report_number), ''), '') || ' ' || COALESCE(NULLIF(TRIM(title), ''), '')),
  COALESCE(NULLIF(TRIM(sanitized_narrative), ''), ''),
  COALESCE(NULLIF(TRIM(report_number), ''), '')
FROM intel_reports WHERE status = 'disseminated';

-- Update sync state for each type
INSERT INTO intel_index_state (entity_type, last_synced_at, row_count)
SELECT 'person', datetime('now'), COUNT(*) FROM intel_index WHERE entity_type = 'person'
ON CONFLICT(entity_type) DO UPDATE SET last_synced_at = datetime('now'), row_count = excluded.row_count;

INSERT INTO intel_index_state (entity_type, last_synced_at, row_count)
SELECT 'vehicle', datetime('now'), COUNT(*) FROM intel_index WHERE entity_type = 'vehicle'
ON CONFLICT(entity_type) DO UPDATE SET last_synced_at = datetime('now'), row_count = excluded.row_count;

INSERT INTO intel_index_state (entity_type, last_synced_at, row_count)
SELECT 'property', datetime('now'), COUNT(*) FROM intel_index WHERE entity_type = 'property'
ON CONFLICT(entity_type) DO UPDATE SET last_synced_at = datetime('now'), row_count = excluded.row_count;

INSERT INTO intel_index_state (entity_type, last_synced_at, row_count)
SELECT 'case', datetime('now'), COUNT(*) FROM intel_index WHERE entity_type = 'case'
ON CONFLICT(entity_type) DO UPDATE SET last_synced_at = datetime('now'), row_count = excluded.row_count;

INSERT INTO intel_index_state (entity_type, last_synced_at, row_count)
SELECT 'incident', datetime('now'), COUNT(*) FROM intel_index WHERE entity_type = 'incident'
ON CONFLICT(entity_type) DO UPDATE SET last_synced_at = datetime('now'), row_count = excluded.row_count;

INSERT INTO intel_index_state (entity_type, last_synced_at, row_count)
SELECT 'call', datetime('now'), COUNT(*) FROM intel_index WHERE entity_type = 'call'
ON CONFLICT(entity_type) DO UPDATE SET last_synced_at = datetime('now'), row_count = excluded.row_count;

INSERT INTO intel_index_state (entity_type, last_synced_at, row_count)
SELECT 'warrant', datetime('now'), COUNT(*) FROM intel_index WHERE entity_type = 'warrant'
ON CONFLICT(entity_type) DO UPDATE SET last_synced_at = datetime('now'), row_count = excluded.row_count;

INSERT INTO intel_index_state (entity_type, last_synced_at, row_count)
SELECT 'citation', datetime('now'), COUNT(*) FROM intel_index WHERE entity_type = 'citation'
ON CONFLICT(entity_type) DO UPDATE SET last_synced_at = datetime('now'), row_count = excluded.row_count;

INSERT INTO intel_index_state (entity_type, last_synced_at, row_count)
SELECT 'field_interview', datetime('now'), COUNT(*) FROM intel_index WHERE entity_type = 'field_interview'
ON CONFLICT(entity_type) DO UPDATE SET last_synced_at = datetime('now'), row_count = excluded.row_count;

INSERT INTO intel_index_state (entity_type, last_synced_at, row_count)
SELECT 'trespass_order', datetime('now'), COUNT(*) FROM intel_index WHERE entity_type = 'trespass_order'
ON CONFLICT(entity_type) DO UPDATE SET last_synced_at = datetime('now'), row_count = excluded.row_count;

INSERT INTO intel_index_state (entity_type, last_synced_at, row_count)
SELECT 'evidence', datetime('now'), COUNT(*) FROM intel_index WHERE entity_type = 'evidence'
ON CONFLICT(entity_type) DO UPDATE SET last_synced_at = datetime('now'), row_count = excluded.row_count;

INSERT INTO intel_index_state (entity_type, last_synced_at, row_count)
SELECT 'intel_report', datetime('now'), COUNT(*) FROM intel_index WHERE entity_type = 'intel_report'
ON CONFLICT(entity_type) DO UPDATE SET last_synced_at = datetime('now'), row_count = excluded.row_count;
