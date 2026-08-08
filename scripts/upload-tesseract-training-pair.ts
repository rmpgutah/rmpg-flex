// ============================================================
// Uploads one labeled Tesseract fine-tuning pair (real document image +
// verified ground-truth transcription) into the restricted
// TESSERACT_TRAINING R2 bucket. Run manually, once per labeled document —
// this is NOT automated and NEVER runs in CI, since the corpus contains
// real client legal-process content.
//
//   npx tsx scripts/upload-tesseract-training-pair.ts <doc-id> <image-path> <ground-truth-path>
//
// Layout in the bucket: training-corpus/<doc-id>/image.<ext>,
// training-corpus/<doc-id>/ground-truth.txt
// ============================================================
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { execFileSync } from 'node:child_process';

const [docId, imagePath, groundTruthPath] = process.argv.slice(2);

if (!docId || !imagePath || !groundTruthPath) {
  console.error('Usage: npx tsx scripts/upload-tesseract-training-pair.ts <doc-id> <image-path> <ground-truth-path>');
  process.exit(1);
}

function r2Put(key: string, localPath: string) {
  execFileSync('npx', [
    'wrangler', 'r2', 'object', 'put',
    `rmpg-flex-tesseract-training/${key}`,
    `--file=${localPath}`,
    '--remote',
  ], { stdio: 'inherit' });
}

const ext = extname(imagePath) || '.png';
r2Put(`training-corpus/${docId}/image${ext}`, imagePath);
r2Put(`training-corpus/${docId}/ground-truth.txt`, groundTruthPath);

console.log(`Uploaded training pair for doc-id "${docId}".`);
