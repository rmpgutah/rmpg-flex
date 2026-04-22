import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Point the generator at a scratch upload root BEFORE the module is imported
const tmpRoot = mkdtempSync(join(tmpdir(), 'affidavit-test-'));
process.env.RMPG_UPLOADS_DIR = tmpRoot;

vi.mock('../../models/database', () => ({
  getDb: () => ({
    prepare: () => ({
      run: () => ({ lastInsertRowid: 42 }),
      get: () => null,
      all: () => [],
    }),
  }),
}));

describe('generateAffidavit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('produces a PDF on disk and returns an attachment id on minimal input', async () => {
    const { generateAffidavit } = await import('../affidavitGenerator');
    const result = await generateAffidavit({
      queueId: 1,
      callId: 1,
      caseId: 1,
      callNumber: '26-CFS00999',
      defendantName: 'Test Defendant',
      defendantAddress: '123 Test St, Salt Lake City, UT',
      plaintiffName: 'Test Plaintiff LLC',
      courtName: 'Third District Court',
      courtCaseNumber: 'CN-999',
      clientJobNumber: '999',
      officerName: 'Officer Test',
      officerBadge: '0000',
      attempts: [
        { attempt_number: 1, attempt_at: '2026-04-22 10:00', result: 'no_answer' },
        { attempt_number: 2, attempt_at: '2026-04-23 14:00', result: 'no_answer', notes: 'lights off' },
        { attempt_number: 3, attempt_at: '2026-04-24 18:00', result: 'served' },
      ],
      finalResult: 'served',
    });
    expect(result.filePath).toContain('26-CFS00999');
    expect(result.filePath.endsWith('affidavit-of-service.pdf')).toBe(true);
    expect(result.attachmentId).toBe(42);
    expect(existsSync(result.filePath)).toBe(true);
  });

  it('sanitizes call_number path traversal attempts', async () => {
    const { generateAffidavit } = await import('../affidavitGenerator');
    const result = await generateAffidavit({
      queueId: 2,
      callId: 2,
      caseId: 2,
      callNumber: '../../etc/passwd',
      defendantName: 'X',
      defendantAddress: 'Y',
      plaintiffName: 'P',
      courtName: '',
      courtCaseNumber: '',
      clientJobNumber: '',
      officerName: 'O',
      officerBadge: '',
      attempts: [{ attempt_number: 1, attempt_at: 'now', result: 'served' }],
      finalResult: 'served',
    });
    expect(result.filePath).not.toContain('..');
    expect(result.filePath).toContain('_');
  });

  // Clean up scratch dir after the suite
  afterAll(() => {
    try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });
});

// vitest hoists `afterAll` — this import keeps TS happy
import { afterAll } from 'vitest';
