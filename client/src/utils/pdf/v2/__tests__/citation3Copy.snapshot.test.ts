// client/src/utils/pdf/v2/__tests__/citation3Copy.snapshot.test.ts
/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { renderMultiCopyPdfV2 } from '../engine/multiCopy';
import { citationSchema, type CitationData } from '../forms/citation';
import { CITATION_INSTRUCTIONS } from '../forms/citationInstructions';

const SNAP_DIR = join(__dirname, '__snapshots__');
const PINNED = new Date('2026-01-01T00:00:00Z');

async function snap(name: string, data: CitationData): Promise<void> {
  const doc = await renderMultiCopyPdfV2(citationSchema, data, CITATION_INSTRUCTIONS, {
    generatedAt: PINNED,
  });
  // Pin non-deterministic PDF metadata so byte output is stable run-to-run.
  (doc as unknown as { setCreationDate?: (d: string) => void })
    .setCreationDate?.("D:20260101000000+00'00'");
  (doc as unknown as { setFileId?: (id: string) => void })
    .setFileId?.('00000000000000000000000000000000');
  const buf = Buffer.from(doc.output('arraybuffer') as ArrayBuffer);
  const hash = createHash('sha256').update(buf).digest('hex');

  const file = join(SNAP_DIR, `${name}.sha256`);
  const update = process.env.UPDATE_SNAPSHOTS === '1';
  if (update || !existsSync(file)) {
    mkdirSync(SNAP_DIR, { recursive: true });
    writeFileSync(file, hash + '\n', 'utf8');
    writeFileSync(join(SNAP_DIR, `${name}.pdf`), buf);
    return;
  }
  const expected = readFileSync(file, 'utf8').trim();
  expect(
    hash,
    `PDF bytes changed for snapshot ${name}. Re-run with UPDATE_SNAPSHOTS=1 if intentional.`,
  ).toBe(expected);
}

describe('citation 3-copy snapshots', () => {
  it('empty record', async () => {
    await snap('citation_3copy.empty', {});
  });

  it('two violations (compact layout)', async () => {
    await snap('citation_3copy.two_violations', {
      citation_number: 'C-26-99',
      violations: [
        {
          statute_citation: 'UCA 41-6a-601',
          description: 'Speeding 15 over',
          offense_level: 'Infraction',
          fine_amount: 175,
        },
        {
          statute_citation: 'UCA 41-6a-92',
          description: 'Failure to signal',
          offense_level: 'Infraction',
          fine_amount: 50,
        },
      ],
    });
  });

  it('five violations (stacked layout)', async () => {
    const violations = Array.from({ length: 5 }, (_, i) => ({
      statute_citation: `UCA-X${i}`,
      description: `desc ${i}`,
      offense_level: 'Infraction' as const,
      fine_amount: 25 * (i + 1),
    }));
    await snap('citation_3copy.five_violations', {
      citation_number: 'C-26-100',
      violations,
    });
  });
});
