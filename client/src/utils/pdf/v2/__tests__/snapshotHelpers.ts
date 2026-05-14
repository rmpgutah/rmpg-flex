/// <reference types="node" />
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { renderPdfV2 } from '../engine/renderer';
import type { FormSchema } from '../engine/types';
import { expect } from 'vitest';

const SNAPSHOT_DIR = join(__dirname, '__snapshots__');

/**
 * Render the schema with the given data, hash the PDF bytes, and compare
 * against a saved snapshot. If UPDATE_SNAPSHOTS=1 is set, the new hash
 * replaces the saved one instead.
 */
// Fixed timestamp injected into the footer's "Generated YYYY-MM-DD" text so
// snapshot bytes don't drift every day. Any date works; pick a stable one.
const PINNED_GENERATED_AT = new Date('2026-01-01T00:00:00Z');

export async function assertPdfSnapshot<T>(
  schema: FormSchema<T>,
  data: T,
  snapshotName: string,
): Promise<void> {
  const doc = await renderPdfV2(schema, data, { generatedAt: PINNED_GENERATED_AT });
  // Pin non-deterministic PDF metadata so byte output is stable across runs.
  // jsPDF exposes setCreationDate() and setFileId() — the file ID is derived
  // from a timestamp+UUID by default, and creation date defaults to "now".
  (doc as unknown as { setCreationDate?: (d: string | Date) => void })
    .setCreationDate?.('D:20260101000000+00\'00\'');
  (doc as unknown as { setFileId?: (id: string) => void })
    .setFileId?.('00000000000000000000000000000000');
  const buf = Buffer.from(doc.output('arraybuffer') as ArrayBuffer);
  const hash = createHash('sha256').update(buf).digest('hex');

  const filePath = join(SNAPSHOT_DIR, `${snapshotName}.sha256`);
  const update = process.env.UPDATE_SNAPSHOTS === '1';

  if (update || !existsSync(filePath)) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, hash + '\n', 'utf8');
    // When creating a new snapshot, also save the raw PDF so a reviewer can inspect it
    writeFileSync(join(SNAPSHOT_DIR, `${snapshotName}.pdf`), buf);
    return;
  }

  const expected = readFileSync(filePath, 'utf8').trim();
  expect(hash, `PDF bytes changed for snapshot ${snapshotName}. If intentional, re-run with UPDATE_SNAPSHOTS=1.`).toBe(expected);
}
