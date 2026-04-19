import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { setupTestDataDir, teardownTestDataDir, createTestAdmin } from '../helpers/testDb';

let app: Application;
let testDir: string;
let adminToken: string;
let personId: number;
let incidentId: number;

beforeAll(async () => {
  testDir = setupTestDataDir();
  const { initDatabase, getDb } = await import('../../src/models/database');
  const db = initDatabase();
  const admin = createTestAdmin(db);
  const { createTestApp } = await import('../helpers/testApp');
  app = await createTestApp();

  // Login
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ username: admin.username, password: admin.password });
  adminToken = loginRes.body.token;

  // Seed data: 1 person, 1 incident, 1 incident_persons link
  const d = getDb();
  personId = Number(d.prepare(
    "INSERT INTO persons (first_name, last_name, dob) VALUES ('Test', 'Suspect', '1990-01-01')"
  ).run().lastInsertRowid);
  incidentId = Number(d.prepare(
    "INSERT INTO incidents (incident_number, incident_type, status, officer_id) VALUES ('I-0001', 'Burglary', 'submitted', ?)"
  ).run(admin.userId).lastInsertRowid);
  d.prepare(
    "INSERT INTO incident_persons (incident_id, person_id, role, added_by) VALUES (?, ?, 'suspect', ?)"
  ).run(incidentId, personId, admin.userId);
});

afterAll(() => { teardownTestDataDir(testDir); });

describe('GET /api/connections/graph', () => {
  it('returns graph with person seed + connected incident at depth 2', async () => {
    const res = await request(app)
      .get(`/api/connections/graph?type=person&id=${personId}&depth=2`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.nodes).toHaveLength(2);
    expect(res.body.nodes.find((n: any) => n.type === 'person')).toBeTruthy();
    expect(res.body.nodes.find((n: any) => n.type === 'incident')).toBeTruthy();
    expect(res.body.edges).toHaveLength(1);
    expect(res.body.edges[0].relationship).toBe('suspect');
  });

  it('rejects invalid type with 400', async () => {
    const res = await request(app)
      .get(`/api/connections/graph?type=unicorn&id=1&depth=2`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await request(app).get(`/api/connections/graph?type=person&id=${personId}`);
    expect(res.status).toBe(401);
  });

  it('traverses person → warrant via subject_person_id', async () => {
    const d = (await import('../../src/models/database')).getDb();
    // Look up an existing user id for entered_by (warrants.entered_by is NOT NULL FK to users)
    const uid = (d.prepare('SELECT id FROM users LIMIT 1').get() as any).id;
    const wid = d.prepare(
      "INSERT INTO warrants (warrant_number, subject_person_id, type, status, charge_description, entered_by) VALUES ('W-001', ?, 'arrest', 'active', 'Test charge', ?)"
    ).run(personId, uid).lastInsertRowid;

    const res = await request(app)
      .get(`/api/connections/graph?type=person&id=${personId}&depth=2`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.nodes.some((n: any) => n.type === 'warrant' && n.entityId === Number(wid))).toBe(true);
  });

  it('traverses warrant → person via subject_person_id', async () => {
    const d = (await import('../../src/models/database')).getDb();
    const uid = (d.prepare('SELECT id FROM users LIMIT 1').get() as any).id;
    const pRow = d.prepare(
      "INSERT INTO persons (first_name, last_name) VALUES ('Jane', 'Warrant-Subject')"
    ).run();
    const pid = Number(pRow.lastInsertRowid);
    const wid = Number(d.prepare(
      "INSERT INTO warrants (warrant_number, subject_person_id, type, status, charge_description, entered_by) VALUES ('W-002', ?, 'arrest', 'active', 'Test charge', ?)"
    ).run(pid, uid).lastInsertRowid);

    const res = await request(app)
      .get(`/api/connections/graph?type=warrant&id=${wid}&depth=2`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.nodes.some((n: any) => n.type === 'person' && n.entityId === pid)).toBe(true);
  });

  it('traverses person → citation via citations.person_id', async () => {
    const d = (await import('../../src/models/database')).getDb();
    const cid = Number(d.prepare(
      "INSERT INTO citations (citation_number, type, status, person_id, violation_date) VALUES ('C-001', 'traffic', 'issued', ?, '2026-04-19')"
    ).run(personId).lastInsertRowid);

    const res = await request(app)
      .get(`/api/connections/graph?type=person&id=${personId}&depth=2`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.nodes.some((n: any) => n.type === 'citation' && n.entityId === cid)).toBe(true);
  });

  it('traverses vehicle → citation via citations.vehicle_id', async () => {
    const d = (await import('../../src/models/database')).getDb();
    const vid = Number(d.prepare(
      "INSERT INTO vehicles_records (plate_number, state, make, model) VALUES ('ABC123','UT','Ford','F-150')"
    ).run().lastInsertRowid);
    const cid = Number(d.prepare(
      "INSERT INTO citations (citation_number, type, status, vehicle_id, violation_date) VALUES ('C-002', 'traffic', 'issued', ?, '2026-04-19')"
    ).run(vid).lastInsertRowid);

    const res = await request(app)
      .get(`/api/connections/graph?type=vehicle&id=${vid}&depth=2`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.nodes.some((n: any) => n.type === 'citation' && n.entityId === cid)).toBe(true);
  });

  it('traverses citation → person via citations.person_id', async () => {
    const d = (await import('../../src/models/database')).getDb();
    const pid = Number(d.prepare(
      "INSERT INTO persons (first_name, last_name) VALUES ('Cit','Subject')"
    ).run().lastInsertRowid);
    const cid = Number(d.prepare(
      "INSERT INTO citations (citation_number, type, status, person_id, violation_date) VALUES ('C-003', 'traffic', 'issued', ?, '2026-04-19')"
    ).run(pid).lastInsertRowid);

    const res = await request(app)
      .get(`/api/connections/graph?type=citation&id=${cid}&depth=2`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.nodes.some((n: any) => n.type === 'person' && n.entityId === pid)).toBe(true);
  });

  it('traverses person → arrest via arrest_cross_links', async () => {
    const d = (await import('../../src/models/database')).getDb();
    const aid = Number(d.prepare(
      "INSERT INTO arrest_records (first_name, last_name, booking_date, charges, status) VALUES ('Test', 'Suspect', '2026-04-19', 'DUI', 'active')"
    ).run().lastInsertRowid);
    d.prepare(
      "INSERT INTO arrest_cross_links (arrest_record_id, linked_type, linked_id) VALUES (?, 'person', ?)"
    ).run(aid, personId);

    const res = await request(app)
      .get(`/api/connections/graph?type=person&id=${personId}&depth=2`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.nodes.some((n: any) => n.type === 'arrest' && n.entityId === aid)).toBe(true);
  });

  it('traverses arrest → person via arrest_cross_links', async () => {
    const d = (await import('../../src/models/database')).getDb();
    const pid = Number(d.prepare(
      "INSERT INTO persons (first_name, last_name) VALUES ('Arr','Subject')"
    ).run().lastInsertRowid);
    const aid = Number(d.prepare(
      "INSERT INTO arrest_records (first_name, last_name, booking_date, charges, status) VALUES ('Arr', 'Subject', '2026-04-19', 'Theft', 'active')"
    ).run().lastInsertRowid);
    d.prepare(
      "INSERT INTO arrest_cross_links (arrest_record_id, linked_type, linked_id) VALUES (?, 'person', ?)"
    ).run(aid, pid);

    const res = await request(app)
      .get(`/api/connections/graph?type=arrest&id=${aid}&depth=2`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.nodes.some((n: any) => n.type === 'person' && n.entityId === pid)).toBe(true);
  });

  it('traverses person → field_interview via field_interviews.person_id', async () => {
    const d = (await import('../../src/models/database')).getDb();
    const uid = (d.prepare('SELECT id FROM users LIMIT 1').get() as any).id;
    const fid = Number(d.prepare(
      "INSERT INTO field_interviews (fi_number, person_id, location, contact_reason, officer_id) VALUES ('FI-26-00001', ?, '100 Main St', 'suspicious', ?)"
    ).run(personId, uid).lastInsertRowid);

    const res = await request(app)
      .get(`/api/connections/graph?type=person&id=${personId}&depth=2`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.nodes.some((n: any) => n.type === 'field_interview' && n.entityId === fid)).toBe(true);
  });

  it('traverses field_interview → person', async () => {
    const d = (await import('../../src/models/database')).getDb();
    const uid = (d.prepare('SELECT id FROM users LIMIT 1').get() as any).id;
    const pid = Number(d.prepare(
      "INSERT INTO persons (first_name, last_name) VALUES ('FI','Subject')"
    ).run().lastInsertRowid);
    const fid = Number(d.prepare(
      "INSERT INTO field_interviews (fi_number, person_id, location, contact_reason, officer_id) VALUES ('FI-26-00002', ?, '200 Oak St', 'loitering', ?)"
    ).run(pid, uid).lastInsertRowid);

    const res = await request(app)
      .get(`/api/connections/graph?type=field_interview&id=${fid}&depth=2`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.nodes.some((n: any) => n.type === 'person' && n.entityId === pid)).toBe(true);
  });

  it('traverses person → trespass_order via trespass_orders.person_id', async () => {
    const d = (await import('../../src/models/database')).getDb();
    const uid = (d.prepare('SELECT id FROM users LIMIT 1').get() as any).id;
    const clientId = Number(d.prepare(
      "INSERT INTO clients (name) VALUES ('Trespass Client A')"
    ).run().lastInsertRowid);
    const propId = Number(d.prepare(
      "INSERT INTO properties (client_id, name, address) VALUES (?, 'Prop A', '1 Banned Way')"
    ).run(clientId).lastInsertRowid);
    const toid = Number(d.prepare(
      "INSERT INTO trespass_orders (order_number, person_id, subject_first_name, subject_last_name, property_id, location, status, issued_by) VALUES ('TO-001', ?, 'Test', 'Suspect', ?, '1 Banned Way', 'active', ?)"
    ).run(personId, propId, uid).lastInsertRowid);

    const res = await request(app)
      .get(`/api/connections/graph?type=person&id=${personId}&depth=2`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.nodes.some((n: any) => n.type === 'trespass_order' && n.entityId === toid)).toBe(true);
  });

  it('traverses property → trespass_order via trespass_orders.property_id', async () => {
    const d = (await import('../../src/models/database')).getDb();
    const uid = (d.prepare('SELECT id FROM users LIMIT 1').get() as any).id;
    const pid = Number(d.prepare(
      "INSERT INTO persons (first_name, last_name) VALUES ('Trespass','Person')"
    ).run().lastInsertRowid);
    const clientId = Number(d.prepare(
      "INSERT INTO clients (name) VALUES ('Trespass Client B')"
    ).run().lastInsertRowid);
    const propId = Number(d.prepare(
      "INSERT INTO properties (client_id, name, address) VALUES (?, 'Prop B', '2 Banned Way')"
    ).run(clientId).lastInsertRowid);
    const toid = Number(d.prepare(
      "INSERT INTO trespass_orders (order_number, person_id, subject_first_name, subject_last_name, property_id, location, status, issued_by) VALUES ('TO-002', ?, 'Trespass', 'Person', ?, '2 Banned Way', 'active', ?)"
    ).run(pid, propId, uid).lastInsertRowid);

    const res = await request(app)
      .get(`/api/connections/graph?type=property&id=${propId}&depth=2`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.nodes.some((n: any) => n.type === 'trespass_order' && n.entityId === toid)).toBe(true);
  });

  it('traverses person → serve_job via serve_queue.recipient_person_id', async () => {
    const d = (await import('../../src/models/database')).getDb();
    const uid = (d.prepare('SELECT id FROM users LIMIT 1').get() as any).id;
    const pid = Number(d.prepare(
      "INSERT INTO persons (first_name, last_name) VALUES ('Serve','Recipient')"
    ).run().lastInsertRowid);
    const sjid = Number(d.prepare(
      "INSERT INTO serve_queue (officer_id, recipient_name, recipient_address, document_type, case_number, status, recipient_person_id) VALUES (?, 'Serve Recipient', '100 Due Process Ln', 'summons', 'CV-001', 'pending', ?)"
    ).run(uid, pid).lastInsertRowid);

    const res = await request(app)
      .get(`/api/connections/graph?type=person&id=${pid}&depth=2`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.nodes.some((n: any) => n.type === 'serve_job' && n.entityId === sjid)).toBe(true);
  });

  it('traverses serve_job → person via serve_queue.recipient_person_id', async () => {
    const d = (await import('../../src/models/database')).getDb();
    const uid = (d.prepare('SELECT id FROM users LIMIT 1').get() as any).id;
    const pid = Number(d.prepare(
      "INSERT INTO persons (first_name, last_name) VALUES ('Serve','Target')"
    ).run().lastInsertRowid);
    const sjid = Number(d.prepare(
      "INSERT INTO serve_queue (officer_id, recipient_name, recipient_address, document_type, case_number, status, recipient_person_id) VALUES (?, 'Serve Target', '200 Due Process Ln', 'subpoena', 'CV-002', 'pending', ?)"
    ).run(uid, pid).lastInsertRowid);

    const res = await request(app)
      .get(`/api/connections/graph?type=serve_job&id=${sjid}&depth=2`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.nodes.some((n: any) => n.type === 'person' && n.entityId === pid)).toBe(true);
  });

  it('traverses property → serve_job via serve_queue.property_id', async () => {
    const d = (await import('../../src/models/database')).getDb();
    const uid = (d.prepare('SELECT id FROM users LIMIT 1').get() as any).id;
    const clientId = Number(d.prepare(
      "INSERT INTO clients (name) VALUES ('Serve Client A')"
    ).run().lastInsertRowid);
    const propId = Number(d.prepare(
      "INSERT INTO properties (client_id, name, address) VALUES (?, 'Serve Prop A', '300 Serve Ln')"
    ).run(clientId).lastInsertRowid);
    const sjid = Number(d.prepare(
      "INSERT INTO serve_queue (officer_id, recipient_name, recipient_address, document_type, case_number, status, property_id) VALUES (?, 'Addressee', '300 Serve Ln', 'summons', 'CV-003', 'pending', ?)"
    ).run(uid, propId).lastInsertRowid);

    const res = await request(app)
      .get(`/api/connections/graph?type=property&id=${propId}&depth=2`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.nodes.some((n: any) => n.type === 'serve_job' && n.entityId === sjid)).toBe(true);
  });

  it('traverses serve_job → property via serve_queue.property_id', async () => {
    const d = (await import('../../src/models/database')).getDb();
    const uid = (d.prepare('SELECT id FROM users LIMIT 1').get() as any).id;
    const clientId = Number(d.prepare(
      "INSERT INTO clients (name) VALUES ('Serve Client B')"
    ).run().lastInsertRowid);
    const propId = Number(d.prepare(
      "INSERT INTO properties (client_id, name, address) VALUES (?, 'Serve Prop B', '400 Serve Ln')"
    ).run(clientId).lastInsertRowid);
    const sjid = Number(d.prepare(
      "INSERT INTO serve_queue (officer_id, recipient_name, recipient_address, document_type, case_number, status, property_id) VALUES (?, 'Addressee B', '400 Serve Ln', 'subpoena', 'CV-004', 'pending', ?)"
    ).run(uid, propId).lastInsertRowid);

    const res = await request(app)
      .get(`/api/connections/graph?type=serve_job&id=${sjid}&depth=2`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.nodes.some((n: any) => n.type === 'property' && n.entityId === propId)).toBe(true);
  });

  it('uses case_person_links (not JSON-LIKE scan) for person → case traversal', async () => {
    const d = (await import('../../src/models/database')).getDb();
    const pid = Number(d.prepare(
      "INSERT INTO persons (first_name, last_name) VALUES ('Case','LinkTest')"
    ).run().lastInsertRowid);
    const caseId = Number(d.prepare(
      "INSERT INTO cases (case_number, title, case_type, status, created_by) VALUES ('CASE-LNK-01','T','investigation','open',1)"
    ).run().lastInsertRowid);
    d.prepare("INSERT INTO case_person_links (case_id, person_id) VALUES (?, ?)").run(caseId, pid);
    // Important: we deliberately leave cases.linked_persons NULL — the graph must STILL find the link via the junction table

    const res = await request(app)
      .get(`/api/connections/graph?type=person&id=${pid}&depth=2`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.nodes.some((n: any) => n.type === 'case' && n.entityId === caseId)).toBe(true);
  });

  it('uses case_incident_links for incident → case traversal', async () => {
    const d = (await import('../../src/models/database')).getDb();
    const incId = Number(d.prepare(
      "INSERT INTO incidents (incident_number, incident_type, status, officer_id) VALUES ('I-LNK-01','theft','submitted',1)"
    ).run().lastInsertRowid);
    const caseId = Number(d.prepare(
      "INSERT INTO cases (case_number, title, case_type, status, created_by) VALUES ('CASE-LNK-02','T','investigation','open',1)"
    ).run().lastInsertRowid);
    d.prepare("INSERT INTO case_incident_links (case_id, incident_id) VALUES (?, ?)").run(caseId, incId);

    const res = await request(app)
      .get(`/api/connections/graph?type=incident&id=${incId}&depth=2`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.nodes.some((n: any) => n.type === 'case' && n.entityId === caseId)).toBe(true);
  });

  it('uses case_evidence_links for evidence → case traversal', async () => {
    const d = (await import('../../src/models/database')).getDb();
    const incForEv = Number(d.prepare(
      "INSERT INTO incidents (incident_number, incident_type, status, officer_id) VALUES ('I-LNK-EV','theft','submitted',1)"
    ).run().lastInsertRowid);
    const evId = Number(d.prepare(
      "INSERT INTO evidence (evidence_number, description, incident_id) VALUES ('EV-LNK-01','test',?)"
    ).run(incForEv).lastInsertRowid);
    const caseId = Number(d.prepare(
      "INSERT INTO cases (case_number, title, case_type, status, created_by) VALUES ('CASE-LNK-03','T','investigation','open',1)"
    ).run().lastInsertRowid);
    d.prepare("INSERT INTO case_evidence_links (case_id, evidence_id) VALUES (?, ?)").run(caseId, evId);

    const res = await request(app)
      .get(`/api/connections/graph?type=evidence&id=${evId}&depth=2`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.nodes.some((n: any) => n.type === 'case' && n.entityId === caseId)).toBe(true);
  });

  it('case → linked persons/incidents/evidence now uses junction tables (not JSON parse)', async () => {
    const d = (await import('../../src/models/database')).getDb();
    const pid = Number(d.prepare("INSERT INTO persons (first_name, last_name) VALUES ('Case','FwdTest')").run().lastInsertRowid);
    const caseId = Number(d.prepare(
      "INSERT INTO cases (case_number, title, case_type, status, created_by) VALUES ('CASE-LNK-FWD','T','investigation','open',1)"
    ).run().lastInsertRowid);
    d.prepare("INSERT INTO case_person_links (case_id, person_id) VALUES (?, ?)").run(caseId, pid);

    const res = await request(app)
      .get(`/api/connections/graph?type=case&id=${caseId}&depth=2`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.nodes.some((n: any) => n.type === 'person' && n.entityId === pid)).toBe(true);
  });

  it('traverses trespass_order → person + property', async () => {
    const d = (await import('../../src/models/database')).getDb();
    const uid = (d.prepare('SELECT id FROM users LIMIT 1').get() as any).id;
    const pid = Number(d.prepare(
      "INSERT INTO persons (first_name, last_name) VALUES ('Banned','Guy')"
    ).run().lastInsertRowid);
    const clientId = Number(d.prepare(
      "INSERT INTO clients (name) VALUES ('Trespass Client C')"
    ).run().lastInsertRowid);
    const propId = Number(d.prepare(
      "INSERT INTO properties (client_id, name, address) VALUES (?, 'Prop C', '3 Banned Way')"
    ).run(clientId).lastInsertRowid);
    const toid = Number(d.prepare(
      "INSERT INTO trespass_orders (order_number, person_id, subject_first_name, subject_last_name, property_id, location, status, issued_by) VALUES ('TO-003', ?, 'Banned', 'Guy', ?, '3 Banned Way', 'active', ?)"
    ).run(pid, propId, uid).lastInsertRowid);

    const res = await request(app)
      .get(`/api/connections/graph?type=trespass_order&id=${toid}&depth=2`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.nodes.some((n: any) => n.type === 'person' && n.entityId === pid)).toBe(true);
    expect(res.body.nodes.some((n: any) => n.type === 'property' && n.entityId === propId)).toBe(true);
  });

  it('de-duplicates label/metadata reads across BFS revisits (perf smoke)', async () => {
    const d = (await import('../../src/models/database')).getDb();

    // Seed a small diamond graph: 1 person -> 2 incidents -> 1 shared case
    //   Without caching: each repeat BFS visit re-runs getRecordLabel + getNodeMetadata.
    //   With caching: one label lookup per unique (type,id) pair.
    const pid = Number(d.prepare("INSERT INTO persons (first_name, last_name) VALUES ('Diamond','Test')").run().lastInsertRowid);
    const i1 = Number(d.prepare("INSERT INTO incidents (incident_number, incident_type, status, officer_id) VALUES ('I-DMD-1','theft','submitted',1)").run().lastInsertRowid);
    const i2 = Number(d.prepare("INSERT INTO incidents (incident_number, incident_type, status, officer_id) VALUES ('I-DMD-2','theft','submitted',1)").run().lastInsertRowid);
    const cid = Number(d.prepare("INSERT INTO cases (case_number, title, case_type, status, created_by) VALUES ('CASE-DMD','T','investigation','open',1)").run().lastInsertRowid);
    d.prepare("INSERT INTO incident_persons (incident_id, person_id, role, added_by) VALUES (?, ?, 'suspect', 1)").run(i1, pid);
    d.prepare("INSERT INTO incident_persons (incident_id, person_id, role, added_by) VALUES (?, ?, 'suspect', 1)").run(i2, pid);
    d.prepare("INSERT INTO case_incident_links (case_id, incident_id) VALUES (?, ?)").run(cid, i1);
    d.prepare("INSERT INTO case_incident_links (case_id, incident_id) VALUES (?, ?)").run(cid, i2);
    d.prepare("INSERT INTO case_person_links (case_id, person_id) VALUES (?, ?)").run(cid, pid);

    const t0 = performance.now();
    const res = await request(app)
      .get(`/api/connections/graph?type=person&id=${pid}&depth=3`)
      .set('Authorization', `Bearer ${adminToken}`);
    const elapsed = performance.now() - t0;

    expect(res.status).toBe(200);
    // Correctness: all 4 node types present
    expect(res.body.nodes.some((n: any) => n.type === 'person' && n.entityId === pid)).toBe(true);
    expect(res.body.nodes.some((n: any) => n.type === 'incident' && n.entityId === i1)).toBe(true);
    expect(res.body.nodes.some((n: any) => n.type === 'incident' && n.entityId === i2)).toBe(true);
    expect(res.body.nodes.some((n: any) => n.type === 'case' && n.entityId === cid)).toBe(true);
    // Perf smoke -- very lax, just catches a regression where we'd loop forever.
    //   The cache should keep this well under 500ms on any reasonable dev machine.
    expect(elapsed).toBeLessThan(500);

    // Each node appears exactly once (no duplicate)
    const uniqueIds = new Set(res.body.nodes.map((n: any) => n.id));
    expect(uniqueIds.size).toBe(res.body.nodes.length);
  });
});

describe('GET /api/connections/export/csv', () => {
  it('includes edges from incident_persons, not just record_links', async () => {
    const res = await request(app)
      .get('/api/connections/export/csv')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/csv/);
    // Seed data from beforeAll: 1 incident_persons row with role='suspect'
    expect(res.text).toContain('incident_persons');
    expect(res.text).toContain('suspect');
  });
});
