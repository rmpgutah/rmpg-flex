import { describe, it } from 'vitest';

// Full HTTP-level integration of /api/serve-intake/intake is deferred to the
// Task 13 production smoke test — this project has no established supertest
// harness for authenticated Express routes, and the endpoint's side effects
// span 7+ tables (persons, properties, cases, calls_for_service,
// call_persons, record_links, serve_queue, serve_attempts) which require
// a seeded DB, user auth, and websocket mocks to exercise end-to-end.
//
// The pure extraction layer is already covered by serveIntake.parse.test.ts
// (9 tests, Armstrong fixture). The fan-out layer will be verified against
// the live VPS DB in Task 13.
describe('POST /api/serve-intake/intake — Armstrong integration (deferred)', () => {
  it.todo('creates defendant + plaintiff + attorney persons with role_tag');
  it.todo('creates property with lastname-residence name and resident link');
  it.todo('creates civil case with plaintiff/defendant/attorney FKs + linked_persons JSON');
  it.todo('creates CFS call with caller/billing/requestor from clients.vendor_fingerprint lookup');
  it.todo('creates CFS call notes as 8-entry JSON array from buildNotesNarrative');
  it.todo('creates 3 call_persons rows (subject, complainant, reporting_party)');
  it.todo('creates serve_queue row with property_id + recipient_person_id set');
  it.todo('creates 3 pre-planned serve_attempts with at least one weekend');
  it.todo('returns warnings array when geocoding fails');
});
