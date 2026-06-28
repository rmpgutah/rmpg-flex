import { describe, it, expect } from 'vitest';
import { renderPdfV2 } from '../renderer';
import {
  embedSidecar, outputWithSidecar, extractSidecarFromBytes,
  canonicalize, payloadHash, type SidecarPayload,
} from '../sidecar';
import type { FormSchema } from '../types';

interface D { name: string; active: boolean }

const schema: FormSchema<D> = {
  meta: { formNumber: 'PS-TEST', title: 'TEST', revision: '2026-04' },
  header: { kind: 'default', formId: 'test' },
  sections: [{
    kind: 'section', title: 'BASIC', columns: 1,
    fields: [
      { kind: 'labeled', label: 'Name', accessor: d => d.name, path: 'name' },
      { kind: 'checkbox', label: 'Active', accessor: d => d.active, path: 'active' },
    ],
  }],
};

describe('sidecar canonicalize', () => {
  it('sorts object keys recursively', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalize({ z: { y: 1, x: 2 }, a: 3 }))
      .toBe('{"a":3,"z":{"x":2,"y":1}}');
  });
  it('preserves array order', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
  });
  it('produces stable hash for equivalent objects', async () => {
    const h1 = await payloadHash({ a: 1, b: 2 });
    const h2 = await payloadHash({ b: 2, a: 1 });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('sidecar embed/extract round-trip', () => {
  it('embeds and extracts the same payload via Keywords path', async () => {
    const doc = await renderPdfV2(schema, { name: 'Jones', active: true });
    const payload: SidecarPayload = {
      v: 1,
      schemaId: 'test',
      formNumber: 'PS-TEST',
      caseNumber: 'T-001',
      generatedAt: '2026-05-05T00:00:00.000Z',
      data: { name: 'Jones', active: true },
    };
    embedSidecar(doc, payload);
    const bytes = outputWithSidecar(doc);
    const extracted = extractSidecarFromBytes(bytes);
    expect(extracted).not.toBeNull();
    expect(extracted!.schemaId).toBe('test');
    expect(extracted!.caseNumber).toBe('T-001');
    expect(extracted!.data).toEqual({ name: 'Jones', active: true });
  });

  it('returns null when no sidecar embedded', async () => {
    const doc = await renderPdfV2(schema, { name: 'X', active: false });
    const bytes = new Uint8Array(doc.output('arraybuffer'));
    expect(extractSidecarFromBytes(bytes)).toBeNull();
  });

  it('survives if Keywords entry is stripped (post-EOF fallback)', async () => {
    const doc = await renderPdfV2(schema, { name: 'Z', active: true });
    const payload: SidecarPayload = {
      v: 1, schemaId: 'test', formNumber: 'PS-TEST', caseNumber: 'T-002',
      generatedAt: '2026-05-05T00:00:00.000Z',
      data: { name: 'Z', active: true },
    };
    embedSidecar(doc, payload);
    const bytes = outputWithSidecar(doc);
    // Simulate a post-processor that wipes the Keywords entry. We
    // overwrite the Keywords value with whitespace-padded blanks
    // of the same length so byte offsets stay stable.
    let text = '';
    for (const b of bytes) text += String.fromCharCode(b);
    const stripped = text.replace(/\/Keywords\s*\(RMPG-SIDECAR-V1:[A-Za-z0-9+/=]+\)/, '/Keywords ()');
    const strippedBytes = new Uint8Array(stripped.length);
    for (let i = 0; i < stripped.length; i++) strippedBytes[i] = stripped.charCodeAt(i);
    const extracted = extractSidecarFromBytes(strippedBytes);
    expect(extracted).not.toBeNull();
    expect(extracted!.caseNumber).toBe('T-002');
  });

  it('handles UTF-8 in data values (names with non-ASCII)', async () => {
    const doc = await renderPdfV2(schema, { name: 'José', active: true });
    const payload: SidecarPayload = {
      v: 1, schemaId: 'test', formNumber: 'PS-TEST', caseNumber: 'T-003',
      generatedAt: '2026-05-05T00:00:00.000Z',
      data: { name: 'José Núñez', emoji: '🚓' },
    };
    embedSidecar(doc, payload);
    const bytes = outputWithSidecar(doc);
    const extracted = extractSidecarFromBytes(bytes);
    expect(extracted!.data).toEqual({ name: 'José Núñez', emoji: '🚓' });
  });
});
