// ============================================================
// One-time backfill: migrate cases.linked_{persons,incidents,evidence}
// JSON arrays into the new case_*_links junction tables.
// Idempotent: safe to run repeatedly. Uses INSERT OR IGNORE so that
// existing (case_id, X_id) pairs are not duplicated.
//
// Task 3.2 of Connections Analyst Tool. Task 3.1 created the three
// junction tables; Task 3.3 will switch graph traversal off the JSON
// LIKE scans onto these indexed joins.
// ============================================================

import { logger } from '../utils/logger';

export function backfillCaseLinks(db: any): { persons: number; incidents: number; evidence: number } {
  const counts = { persons: 0, incidents: 0, evidence: 0 };

  const insP = db.prepare(
    'INSERT OR IGNORE INTO case_person_links (case_id, person_id) VALUES (?, ?)'
  );
  const insI = db.prepare(
    'INSERT OR IGNORE INTO case_incident_links (case_id, incident_id) VALUES (?, ?)'
  );
  const insE = db.prepare(
    'INSERT OR IGNORE INTO case_evidence_links (case_id, evidence_id) VALUES (?, ?)'
  );

  const cases = db.prepare(
    'SELECT id, linked_persons, linked_incidents, linked_evidence FROM cases'
  ).all() as any[];

  db.transaction(() => {
    for (const c of cases) {
      const caseId = c.id;

      try {
        const ids = JSON.parse(c.linked_persons || '[]');
        if (Array.isArray(ids)) {
          for (const raw of ids) {
            const pid = Number(raw);
            if (Number.isInteger(pid) && pid > 0) {
              const result = insP.run(caseId, pid);
              if (result.changes > 0) counts.persons++;
            }
          }
        }
      } catch { /* malformed JSON — skip this column for this case */ }

      try {
        const ids = JSON.parse(c.linked_incidents || '[]');
        if (Array.isArray(ids)) {
          for (const raw of ids) {
            const iid = Number(raw);
            if (Number.isInteger(iid) && iid > 0) {
              const result = insI.run(caseId, iid);
              if (result.changes > 0) counts.incidents++;
            }
          }
        }
      } catch { /* skip */ }

      try {
        const ids = JSON.parse(c.linked_evidence || '[]');
        if (Array.isArray(ids)) {
          for (const raw of ids) {
            const eid = Number(raw);
            if (Number.isInteger(eid) && eid > 0) {
              const result = insE.run(caseId, eid);
              if (result.changes > 0) counts.evidence++;
            }
          }
        }
      } catch { /* skip */ }
    }
  })();

  if (counts.persons + counts.incidents + counts.evidence > 0) {
    logger.info({ counts }, 'case links backfill complete');
  }

  return counts;
}
