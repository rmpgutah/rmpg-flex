import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { setupTestDataDir, teardownTestDataDir, createTestAdmin, createTestOfficer } from '../helpers/testDb';

// Mock the email sender BEFORE any code imports it
const sendEmailMock = vi.fn(async () => true);
vi.mock('../../src/utils/emailSender', () => ({
  sendEmail: (...args: any[]) => sendEmailMock(...args),
  sendNotificationEmail: vi.fn(),
}));

let app: Application;
let testDir: string;
let adminToken: string;
let officerToken: string;

beforeAll(async () => {
  testDir = setupTestDataDir();
  const { initDatabase } = await import('../../src/models/database');
  const db = initDatabase();
  const admin = createTestAdmin(db);
  const officer = createTestOfficer(db);
  const { createTestApp } = await import('../helpers/testApp');
  app = await createTestApp();

  const al = await request(app).post('/api/auth/login').send({ username: admin.username, password: admin.password });
  adminToken = al.body.token;
  const ol = await request(app).post('/api/auth/login').send({ username: officer.username, password: officer.password });
  officerToken = ol.body.token;
});

afterAll(() => { teardownTestDataDir(testDir); });

describe('POST /api/pdf-engine/email', () => {
  const fakePdf = Buffer.from('%PDF-1.4\n%%EOF\n');

  it('sends an email with PDF attachment and logs success', async () => {
    sendEmailMock.mockResolvedValueOnce(true);
    const res = await request(app)
      .post('/api/pdf-engine/email')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('to', 'court@example.com')
      .field('subject', 'Warrant')
      .field('body', 'Attached warrant for WAR-0042')
      .field('form_type', 'warrant')
      .attach('pdf', fakePdf, 'warrant.pdf');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(sendEmailMock).toHaveBeenCalled();
    // Phase 4: sendEmail signature is (userId, options)
    const [userIdArg, callArg] = sendEmailMock.mock.calls[0];
    expect(typeof userIdArg).toBe('number');
    expect(callArg.to).toEqual(['court@example.com']);
    expect(callArg.attachments).toHaveLength(1);
    expect(callArg.attachments[0].contentType).toBe('application/pdf');
  });

  it('returns 400 when to or subject missing', async () => {
    const res = await request(app)
      .post('/api/pdf-engine/email')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('subject', 'Only subject')
      .attach('pdf', Buffer.from('x'), 'x.pdf');
    expect(res.status).toBe(400);
  });

  it('returns 400 when no pdf file attached', async () => {
    const res = await request(app)
      .post('/api/pdf-engine/email')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('to', 'a@b.c')
      .field('subject', 'x');
    expect(res.status).toBe(400);
  });

  it('rejects officer role with 403', async () => {
    const res = await request(app)
      .post('/api/pdf-engine/email')
      .set('Authorization', `Bearer ${officerToken}`)
      .field('to', 'a@b.c').field('subject', 'x')
      .attach('pdf', Buffer.from('x'), 'x.pdf');
    expect(res.status).toBe(403);
  });

  it('returns 502 when sendEmail returns false', async () => {
    sendEmailMock.mockResolvedValueOnce(false);
    const res = await request(app)
      .post('/api/pdf-engine/email')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('to', 'a@b.c').field('subject', 'x')
      .attach('pdf', Buffer.from('x'), 'x.pdf');
    expect(res.status).toBe(502);
  });
});
