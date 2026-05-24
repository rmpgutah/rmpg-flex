// ============================================================
// Voice Persona Integration Tests
// Exercises GET/PUT of the authenticated user's voice persona
// columns (voice_persona, voice_rate, voice_pitch, voice_terseness).
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

  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ username: admin.username, password: admin.password });
  adminToken = loginRes.body.token;
});

afterAll(() => {
  teardownTestDataDir(testDir);
});

describe('GET /api/voice-persona', () => {
  it('returns default persona values for a fresh user', async () => {
    const res = await request(app)
      .get('/api/voice-persona')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.voice_persona).toBe('en-US-JennyNeural');
    expect(res.body.voice_terseness).toBe('standard');
    // voice_brain_enabled defaults strictly off for every user.
    expect(res.body.voice_brain_enabled).toBe(0);
  });
});

describe('PUT /api/voice-persona', () => {
  it('updates provided fields and persists them', async () => {
    const putRes = await request(app)
      .put('/api/voice-persona')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ voice_persona: 'en-US-GuyNeural', voice_terseness: 'terse', voice_rate: 1.1 });

    expect(putRes.status).toBe(200);
    expect(putRes.body).toMatchObject({ success: true });

    const getRes = await request(app)
      .get('/api/voice-persona')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.voice_persona).toBe('en-US-GuyNeural');
    expect(getRes.body.voice_terseness).toBe('terse');
    expect(getRes.body.voice_rate).toBe(1.1);
  });

  it('rejects an invalid voice_terseness with 400', async () => {
    const res = await request(app)
      .put('/api/voice-persona')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ voice_terseness: 'screamy' });

    expect(res.status).toBe(400);
  });

  it('rejects voice_rate out of range with 400', async () => {
    const res = await request(app)
      .put('/api/voice-persona')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ voice_rate: 2.5 });

    expect(res.status).toBe(400);
  });

  it('rejects non-string voice_persona with 400', async () => {
    const res = await request(app)
      .put('/api/voice-persona')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ voice_persona: 12345 });

    expect(res.status).toBe(400);
  });

  it('rejects oversize voice_persona with 400', async () => {
    const res = await request(app)
      .put('/api/voice-persona')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ voice_persona: 'x'.repeat(200) });

    expect(res.status).toBe(400);
  });

  it('rejects non-numeric voice_rate string with 400', async () => {
    const res = await request(app)
      .put('/api/voice-persona')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ voice_rate: 'fast' });

    expect(res.status).toBe(400);
  });

  it('rejects voice_pitch out of range with 400', async () => {
    const res = await request(app)
      .put('/api/voice-persona')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ voice_pitch: 50 });

    expect(res.status).toBe(400);
  });

  it('accepts voice_brain_enabled = 1 and persists it', async () => {
    const putRes = await request(app)
      .put('/api/voice-persona')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ voice_brain_enabled: 1 });
    expect(putRes.status).toBe(200);

    const getRes = await request(app)
      .get('/api/voice-persona')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(getRes.body.voice_brain_enabled).toBe(1);
  });

  it('accepts voice_brain_enabled = true (boolean) and persists as 1', async () => {
    const putRes = await request(app)
      .put('/api/voice-persona')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ voice_brain_enabled: true });
    expect(putRes.status).toBe(200);

    const getRes = await request(app)
      .get('/api/voice-persona')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(getRes.body.voice_brain_enabled).toBe(1);
  });

  it('rejects non-boolean/non-0/1 voice_brain_enabled with 400', async () => {
    const res = await request(app)
      .put('/api/voice-persona')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ voice_brain_enabled: 'yes' });
    expect(res.status).toBe(400);
  });
});
