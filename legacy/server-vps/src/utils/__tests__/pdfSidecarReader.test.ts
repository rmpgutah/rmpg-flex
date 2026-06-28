import { describe, it, expect } from 'vitest';
import {
  extractSidecar, canonicalize, payloadHash,
} from '../pdfSidecarReader';

// Build a minimal PDF-shaped buffer with a Keywords entry. We don't
// need a real renderer — extractSidecar only scans for the marker.
function buildFakePdfWithKeywords(b64: string): Buffer {
  const body = [
    '%PDF-1.7',
    '1 0 obj << /Title () /Keywords (RMPG-SIDECAR-V1:' + b64 + ') >> endobj',
    'xref',
    '0 2',
    'trailer << /Size 2 /Info 1 0 R >>',
    'startxref',
    '0',
    '%%EOF',
  ].join('\n');
  return Buffer.from(body, 'utf8');
}

function buildFakePdfWithPostEof(b64: string): Buffer {
  const body = [
    '%PDF-1.7',
    '%%EOF',
    `%RMPG_SIDECAR_BEGIN ${b64} RMPG_SIDECAR_END%`,
  ].join('\n');
  return Buffer.from(body, 'utf8');
}

function encodePayload(p: object): string {
  return Buffer.from(JSON.stringify(p), 'utf8').toString('base64');
}

describe('pdfSidecarReader.canonicalize', () => {
  it('matches client-side semantics: sort keys, no whitespace', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalize({ z: { y: 1, x: 2 }, a: [3, 1, 2] }))
      .toBe('{"a":[3,1,2],"z":{"x":2,"y":1}}');
  });
  it('payloadHash is sha256 hex of canonical JSON', () => {
    const h = payloadHash({ a: 1 });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    // sha256({"a":1}) — known value
    expect(h).toBe('015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862');
  });
});

describe('extractSidecar', () => {
  const samplePayload = {
    v: 1,
    schemaId: 'citation',
    formNumber: 'FORM PS-209',
    caseNumber: 'C-26-0001',
    generatedAt: '2026-05-05T00:00:00.000Z',
    data: { person_name: 'Jones', fine_amount: 175 },
  };

  it('reads from /Keywords entry', () => {
    const b64 = encodePayload(samplePayload);
    const buf = buildFakePdfWithKeywords(b64);
    const result = extractSidecar(buf);
    expect(result).not.toBeNull();
    expect(result!.source).toBe('keywords');
    expect(result!.payload.caseNumber).toBe('C-26-0001');
    expect(result!.payload.data).toEqual({ person_name: 'Jones', fine_amount: 175 });
  });

  it('falls back to post-EOF marker when Keywords missing', () => {
    const b64 = encodePayload(samplePayload);
    const buf = buildFakePdfWithPostEof(b64);
    const result = extractSidecar(buf);
    expect(result).not.toBeNull();
    expect(result!.source).toBe('post-eof');
    expect(result!.payload.schemaId).toBe('citation');
  });

  it('returns null for a PDF with no sidecar', () => {
    const buf = Buffer.from('%PDF-1.7\n1 0 obj << /Title () >> endobj\n%%EOF', 'utf8');
    expect(extractSidecar(buf)).toBeNull();
  });

  it('returns null on unsupported version', () => {
    const b64 = encodePayload({ ...samplePayload, v: 999 });
    const buf = buildFakePdfWithKeywords(b64);
    expect(extractSidecar(buf)).toBeNull();
  });

  it('handles UTF-8 in payload data', () => {
    const utf8Payload = { ...samplePayload, data: { name: 'José Núñez', emoji: '🚓' } };
    const b64 = encodePayload(utf8Payload);
    const buf = buildFakePdfWithKeywords(b64);
    const result = extractSidecar(buf);
    expect(result!.payload.data).toEqual({ name: 'José Núñez', emoji: '🚓' });
  });

  it('prefers keywords when both forms present', () => {
    const a = encodePayload({ ...samplePayload, caseNumber: 'KW-WIN' });
    const b = encodePayload({ ...samplePayload, caseNumber: 'EOF-WIN' });
    const body = [
      '%PDF-1.7',
      `1 0 obj << /Keywords (RMPG-SIDECAR-V1:${a}) >> endobj`,
      '%%EOF',
      `%RMPG_SIDECAR_BEGIN ${b} RMPG_SIDECAR_END%`,
    ].join('\n');
    const result = extractSidecar(Buffer.from(body, 'utf8'));
    expect(result!.source).toBe('keywords');
    expect(result!.payload.caseNumber).toBe('KW-WIN');
  });
});
