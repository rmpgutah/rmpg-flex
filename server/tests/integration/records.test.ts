// ============================================================
// Records Integration Tests
// Exercises persons, vehicles, and incidents CRUD — core data
// entry workflows for the RMS side of the system.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { setupTestDataDir, teardownTestDataDir, createTestAdmin } from '../helpers/testDb';

let app: Application;
let testDir: string;
let adminToken: string;

beforeAll(async () => {
  testDir = setupTestDataDir();
  const { initDatabase } = await import('../../src/models/database');
  const db = initDatabase();
  const admin = createTestAdmin(db);
  const { createTestApp } = await import('../helpers/testApp');
  app = await createTestApp();

  const res = await request(app)
    .post('/api/auth/login')
    .send({ username: admin.username, password: admin.password });
  adminToken = res.body.token;
});

afterAll(() => {
  teardownTestDataDir(testDir);
});

describe('POST /api/records/persons', () => {
  it('creates a person with required fields', async () => {
    const res = await request(app)
      .post('/api/records/persons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        first_name: 'John',
        last_name: 'Doe',
        dob: '1985-06-15',
        gender: 'M',
        race: 'W',
      });

    expect([200, 201]).toContain(res.status);
    expect(res.body).toMatchObject({
      first_name: 'John',
      last_name: 'Doe',
    });
    expect(res.body.id).toBeGreaterThan(0);
  });

  it('rejects missing first_name with 400', async () => {
    const res = await request(app)
      .post('/api/records/persons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ last_name: 'NoFirstName' });

    expect(res.status).toBe(400);
  });

  it('persists the created person and makes it retrievable', async () => {
    const createRes = await request(app)
      .post('/api/records/persons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        first_name: 'Jane',
        last_name: 'PersistTest',
        address: '555 Retrieve Ave',
        city: 'SLC',
        state: 'UT',
        zip: '84101',
      });

    expect([200, 201]).toContain(createRes.status);
    const personId = createRes.body.id;

    const getRes = await request(app)
      .get(`/api/records/persons/${personId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body).toMatchObject({
      id: personId,
      first_name: 'Jane',
      last_name: 'PersistTest',
      address: '555 Retrieve Ave',
    });
  });

  it('lists all persons', async () => {
    const res = await request(app)
      .get('/api/records/persons')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const list = Array.isArray(res.body) ? res.body : res.body.data || res.body.persons || [];
    expect(list.length).toBeGreaterThan(0);
  });

  // ─────────────────────────────────────────────────────
  // FIELD-PERSISTENCE ROUND TRIP
  // Proves that every field the client form accepts is
  // actually stored by POST AND returned on GET AND
  // re-stored by PUT. Catches the "data disappears after
  // save" family of bugs caused by routes dropping fields.
  // ─────────────────────────────────────────────────────
  //
  // If a field is added to the form but not to the server's
  // destructure/INSERT/fieldMap, this test will surface it
  // with a visible diff.

  // All writable fields present in PersonFormModal.tsx, typed
  // with representative values. Grouped so failures point at
  // the owning section of the form.
  const fullPersonPayload = {
    // Basic Info
    first_name: 'Sarah',
    last_name: 'RoundTrip',
    middle_name: 'Ann',
    alias_nickname: 'Sari',
    dob: '1988-02-14',
    alias_dob: '1988-02-15',
    gender: 'F',
    race: 'W',
    place_of_birth: 'Provo, UT',
    citizenship: 'US',
    marital_status: 'married',
    language: 'English',
    // Physical
    height: '5\'06"',
    height_feet: 5,
    height_inches: 6,
    weight: '140',
    build: 'medium',
    complexion: 'fair',
    hair_color: 'brown',
    eye_color: 'hazel',
    hair_length: 'medium',
    hair_style: 'straight',
    facial_hair: 'none',
    glasses: 'reading',
    shoe_size: '8',
    blood_type: 'O+',
    scars_marks_tattoos: 'birthmark left cheek',
    clothing_description: 'blue jacket',
    tattoo_description: 'small rose left wrist',
    scar_description: '2in scar right forearm',
    piercing_description: 'ears pierced',
    distinguishing_features: 'gap front teeth',
    identifying_marks_location: 'left wrist',
    // Identification
    dl_number: 'UT1234567',
    dl_state: 'UT',
    dl_expiry: '2030-01-01',
    dl_class: 'D',
    ssn_last4: '1234',
    ssn_full: '555-12-1234',
    id_type: 'state_id',
    id_number: 'UT-ID-998877',
    id_state: 'UT',
    id_expiry: '2029-05-01',
    ncic_number: 'NCIC-1234',
    sor_number: 'SOR-5678',
    fbi_number: 'FBI-ABC123',
    state_id_number: 'SID-UT-9999',
    passport_number: 'P123456789',
    passport_country: 'USA',
    immigration_status: 'citizen',
    // Contact
    address: '123 Roundtrip Ln',
    city: 'Salt Lake City',
    state: 'UT',
    zip: '84101',
    phone: '801-555-0100',
    phone_secondary: '801-555-0101',
    home_phone: '801-555-0102',
    work_phone: '801-555-0103',
    email: 'sarah@example.com',
    email_secondary: 'sarah.alt@example.com',
    emergency_contact_name: 'Tom RoundTrip',
    emergency_contact_phone: '801-555-0200',
    emergency_contact_relationship: 'spouse',
    date_last_seen: '2026-03-30',
    location_last_seen: 'Sugar House, SLC',
    // Law Enforcement / Other
    employer: 'Acme Corp',
    occupation: 'Engineer',
    gang_affiliation: '',
    is_sex_offender: false,
    is_veteran: true,
    military_branch: 'Army',
    military_status: 'veteran',
    probation_parole: '',
    probation_parole_officer: '',
    known_associates: 'none known',
    caution_flags: '',
    photo_url: '',
    disability_flags: 'none',
    mental_health_flags: 'none',
    substance_abuse: 'none',
    medication_notes: 'no chronic meds',
    education_level: 'bachelor',
    tribal_affiliation: '',
    social_media: '@sari',
    notes: 'Round-trip field persistence test',
  };

  it('PERSISTENCE: POST /persons stores every writable form field', async () => {
    const createRes = await request(app)
      .post('/api/records/persons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(fullPersonPayload);

    expect(createRes.status).toBe(201);
    const personId = createRes.body.id;

    const getRes = await request(app)
      .get(`/api/records/persons/${personId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(getRes.status).toBe(200);
    const stored = getRes.body;

    // Every field the client sends must be persisted. Normalize booleans
    // to 0/1 since SQLite returns integers for boolean columns.
    const expected: Record<string, any> = { ...fullPersonPayload };
    expected.is_sex_offender = 0;
    expected.is_veteran = 1;

    const dropped: string[] = [];
    for (const [key, value] of Object.entries(expected)) {
      if (stored[key] === undefined || stored[key] === null || stored[key] === '') {
        // The create path left this field empty — possible drop.
        // Distinguish empty-string sends (allowed to round-trip to null) from
        // non-empty values (must persist as sent).
        if (value !== '' && value !== null && value !== undefined) {
          dropped.push(`${key} (sent=${JSON.stringify(value)} got=${JSON.stringify(stored[key])})`);
        }
      } else if (typeof value !== 'object') {
        // Handle SQLite REAL ↔ number coercion (e.g. int 45000 stored as "45000.0")
        const sa = Number(value);
        const sb = Number(stored[key]);
        const numericMatch = !Number.isNaN(sa) && !Number.isNaN(sb) && sa === sb;
        if (!numericMatch && String(stored[key]) !== String(value)) {
          dropped.push(`${key} (sent=${JSON.stringify(value)} got=${JSON.stringify(stored[key])})`);
        }
      }
    }

    expect(dropped).toEqual([]);
  });

  it('PERSISTENCE: PUT /persons/:id preserves edited values across GET', async () => {
    // Create a minimal person first
    const createRes = await request(app)
      .post('/api/records/persons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ first_name: 'Edit', last_name: 'Target' });

    expect(createRes.status).toBe(201);
    const personId = createRes.body.id;

    // Edit with the full payload (simulating user filling out every field
    // in the edit modal and hitting Save).
    const editRes = await request(app)
      .put(`/api/records/persons/${personId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...fullPersonPayload, first_name: 'Edit', last_name: 'Target' });

    expect(editRes.status).toBe(200);

    // Re-fetch (simulating the user closing and reopening the edit modal)
    const getRes = await request(app)
      .get(`/api/records/persons/${personId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(getRes.status).toBe(200);
    const stored = getRes.body;

    const expected: Record<string, any> = { ...fullPersonPayload, first_name: 'Edit', last_name: 'Target' };
    expected.is_sex_offender = 0;
    expected.is_veteran = 1;

    const dropped: string[] = [];
    for (const [key, value] of Object.entries(expected)) {
      if (value === '' || value === null || value === undefined) continue;
      if (stored[key] === undefined || stored[key] === null || stored[key] === '') {
        dropped.push(`${key} (sent=${JSON.stringify(value)} got=${JSON.stringify(stored[key])})`);
      } else if (typeof value !== 'object') {
        // Handle SQLite REAL ↔ number coercion (e.g. int 45000 stored as "45000.0")
        const sa = Number(value);
        const sb = Number(stored[key]);
        const numericMatch = !Number.isNaN(sa) && !Number.isNaN(sb) && sa === sb;
        if (!numericMatch && String(stored[key]) !== String(value)) {
          dropped.push(`${key} (sent=${JSON.stringify(value)} got=${JSON.stringify(stored[key])})`);
        }
      }
    }

    expect(dropped).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────
// Vehicle form round-trip — mirrors the persons test above
// ─────────────────────────────────────────────────────

const fullVehiclePayload = {
  plate_number: 'RT-1234',
  state: 'UT',
  plate_type: 'standard',
  make: 'Toyota',
  model: 'Camry',
  year: 2021,
  color: 'Silver',
  secondary_color: 'Gray',
  trim: 'SE',
  body_style: 'sedan',
  doors: 4,
  vin: '4T1B11HK1JU123456',
  engine_type: '2.5L I4',
  fuel_type: 'gasoline',
  transmission: 'automatic',
  drive_type: 'FWD',
  odometer: 45000,
  vehicle_use: 'personal',
  commercial_vehicle: false,
  hazmat: false,
  // Owner
  owner_name: 'John RoundTrip',
  owner_address: '123 Owner St, SLC, UT',
  owner_phone: '801-555-0300',
  owner_dob: '1985-05-15',
  owner_dl_number: 'UT9876543',
  primary_driver_name: 'John RoundTrip',
  registered_owner: 'John RoundTrip',
  registration_state: 'UT',
  registration_expiry: '2027-05-15',
  // Insurance
  insurance_company: 'State Farm',
  insurance_policy: 'SF-123456789',
  insurance_expiry: '2027-01-01',
  lien_holder: '',
  // Condition & modifications
  exterior_condition: 'good',
  interior_condition: 'excellent',
  title_status: 'clean',
  window_tint: 'legal',
  modifications: 'none',
  equipment_notes: 'spare tire, jack',
  damage_description: 'minor scratch front bumper',
  distinguishing_features: 'roof rack',
  estimated_value: 22000,
  // LE / NCIC
  ncic_entry_number: '',
  stolen_status: '',
  stolen_date: '',
  recovery_date: '',
  // Tow
  tow_status: '',
  tow_company: '',
  tow_date: '',
  tow_location: '',
  notes: 'Vehicle field persistence round-trip',
};

describe('Vehicle field persistence', () => {
  it('PERSISTENCE: POST /vehicles stores every writable form field', async () => {
    const createRes = await request(app)
      .post('/api/records/vehicles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(fullVehiclePayload);

    expect([200, 201]).toContain(createRes.status);
    const vehicleId = createRes.body.id;

    const getRes = await request(app)
      .get(`/api/records/vehicles/${vehicleId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(getRes.status).toBe(200);
    const stored = getRes.body;
    const expected: Record<string, any> = { ...fullVehiclePayload };
    expected.commercial_vehicle = 0;
    expected.hazmat = 0;

    const dropped: string[] = [];
    for (const [key, value] of Object.entries(expected)) {
      if (value === '' || value === null || value === undefined) continue;
      if (stored[key] === undefined || stored[key] === null || stored[key] === '') {
        dropped.push(`${key} (sent=${JSON.stringify(value)} got=${JSON.stringify(stored[key])})`);
      } else if (typeof value !== 'object') {
        // Handle SQLite REAL ↔ number coercion (e.g. int 45000 stored as "45000.0")
        const sa = Number(value);
        const sb = Number(stored[key]);
        const numericMatch = !Number.isNaN(sa) && !Number.isNaN(sb) && sa === sb;
        if (!numericMatch && String(stored[key]) !== String(value)) {
          dropped.push(`${key} (sent=${JSON.stringify(value)} got=${JSON.stringify(stored[key])})`);
        }
      }
    }

    expect(dropped).toEqual([]);
  });

  it('PERSISTENCE: PUT /vehicles/:id preserves edited values across GET', async () => {
    const createRes = await request(app)
      .post('/api/records/vehicles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ plate_number: 'RT-5678', state: 'UT', make: 'Ford' });

    expect([200, 201]).toContain(createRes.status);
    const vehicleId = createRes.body.id;

    const editRes = await request(app)
      .put(`/api/records/vehicles/${vehicleId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...fullVehiclePayload, plate_number: 'RT-5678' });

    expect(editRes.status).toBe(200);

    const getRes = await request(app)
      .get(`/api/records/vehicles/${vehicleId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(getRes.status).toBe(200);
    const stored = getRes.body;
    const expected: Record<string, any> = { ...fullVehiclePayload, plate_number: 'RT-5678' };
    expected.commercial_vehicle = 0;
    expected.hazmat = 0;

    const dropped: string[] = [];
    for (const [key, value] of Object.entries(expected)) {
      if (value === '' || value === null || value === undefined) continue;
      if (stored[key] === undefined || stored[key] === null || stored[key] === '') {
        dropped.push(`${key} (sent=${JSON.stringify(value)} got=${JSON.stringify(stored[key])})`);
      } else if (typeof value !== 'object') {
        // Handle SQLite REAL ↔ number coercion (e.g. int 45000 stored as "45000.0")
        const sa = Number(value);
        const sb = Number(stored[key]);
        const numericMatch = !Number.isNaN(sa) && !Number.isNaN(sb) && sa === sb;
        if (!numericMatch && String(stored[key]) !== String(value)) {
          dropped.push(`${key} (sent=${JSON.stringify(value)} got=${JSON.stringify(stored[key])})`);
        }
      }
    }

    expect(dropped).toEqual([]);
  });
});

describe('POST /api/records/vehicles', () => {
  it('creates a vehicle record', async () => {
    const res = await request(app)
      .post('/api/records/vehicles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        plate_number: 'TEST123',
        state: 'UT',
        make: 'Ford',
        model: 'F-150',
        year: 2020,
        color: 'Blue',
      });

    expect([200, 201]).toContain(res.status);
    expect(res.body.id).toBeGreaterThan(0);
  });

  it('persists and retrieves a vehicle', async () => {
    const createRes = await request(app)
      .post('/api/records/vehicles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        plate_number: 'PERS456',
        state: 'UT',
        make: 'Toyota',
        model: 'Camry',
        year: 2022,
        color: 'Silver',
      });

    expect([200, 201]).toContain(createRes.status);
    const vehicleId = createRes.body.id;

    const getRes = await request(app)
      .get(`/api/records/vehicles/${vehicleId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.plate_number).toBe('PERS456');
    expect(getRes.body.make).toBe('Toyota');
  });
});

describe('POST /api/incidents', () => {
  it('creates an incident with required fields', async () => {
    const res = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        incident_type: 'trespass',
        location_address: '888 Incident Way, SLC, UT',
        narrative: 'Test incident for integration test',
      });

    expect([200, 201]).toContain(res.status);
    expect(res.body).toMatchObject({
      incident_type: 'trespass',
    });
    expect(res.body.id).toBeGreaterThan(0);
    expect(res.body.incident_number).toBeTruthy();
  });

  it('rejects missing incident_type with 400', async () => {
    const res = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ location_address: '123 Somewhere' });

    expect(res.status).toBe(400);
  });

  it('persists the created incident and makes it retrievable', async () => {
    const createRes = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        incident_type: 'theft',
        location_address: '777 Persist Blvd, SLC, UT',
        narrative: 'Persistence check',
      });

    expect([200, 201]).toContain(createRes.status);
    const incidentId = createRes.body.id;

    const getRes = await request(app)
      .get(`/api/incidents/${incidentId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.incident_type).toBe('theft');
  });
});

describe('Link persons to incidents', () => {
  let incidentId: number;
  let personId: number;

  beforeAll(async () => {
    const incidentRes = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        incident_type: 'disturbance',
        location_address: '999 Link Test Rd',
        narrative: 'Link test',
      });
    incidentId = incidentRes.body.id;

    const personRes = await request(app)
      .post('/api/records/persons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ first_name: 'Link', last_name: 'Person' });
    personId = personRes.body.id;
  });

  it('links a person to an incident', async () => {
    const res = await request(app)
      .post(`/api/incidents/${incidentId}/persons`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        person_id: personId,
        role: 'suspect',
      });

    expect([200, 201]).toContain(res.status);
  });
});
