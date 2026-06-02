// ============================================================
// RMPG Flex — training-set pre-flight validator
// ============================================================
// Catches the silent failures that waste GPU hours BEFORE you train:
//
//   1. TRUNCATION — if a row's (system+user+assistant) length exceeds
//      max_seq_len, the trainer cuts the END, which is the assistant JSON
//      TARGET. That row then trains on a truncated/empty target — worse than
//      useless. This is the #1 thing to catch for long legal packets.
//   2. MALFORMED TARGET — assistant content must be valid JSON with the
//      documentType + fields shape the model is meant to emit.
//   3. CLASS / FIELD BALANCE — what the LoRA can actually learn: person vs
//      business mix, and per-field fill rate (a field present in 2 rows won't
//      be learned).
//   4. DUPLICATE INPUTS — near-identical prompts inflate the row count without
//      adding signal.
//
// Token counts are ESTIMATES (~chars/4 + chat overhead) — no tokenizer needed.
// They're conservative enough to flag the 20K-token packets; verify exact
// counts with the real tokenizer if a row sits right at the boundary.
//
// Run:  npx tsx training/validate-dataset.ts [--max-seq-len 8192]
// Exits non-zero if any row would truncate its target (so CI/you can gate on it).
// ============================================================

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGET_FIELDS } from '../src/utils/serveIntakeExtract';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, 'dist');
const argMax = process.argv.indexOf('--max-seq-len');
const MAX_SEQ = argMax >= 0 ? Number(process.argv[argMax + 1]) : 8192;

// ~4 chars/token for English; legal text with numbers/punct runs a bit denser,
// so divide by 3.6 to stay conservative (over-estimate tokens → fewer surprises).
const approxTokens = (s: string) => Math.ceil(s.length / 3.6);
const CHAT_OVERHEAD = 12; // rough per-turn header/special-token cost

interface Row { messages: Array<{ role: string; content: string }> }

function load(file: string): Row[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function main() {
  const train = load(join(DIST, 'train.jsonl'));
  const val = load(join(DIST, 'val.jsonl'));
  const rows = [...train, ...val];
  if (rows.length === 0) {
    console.error('No dist/*.jsonl — run build-dataset.ts first.');
    process.exit(1);
  }
  console.log(`Validating ${rows.length} rows (${train.length} train / ${val.length} val) @ max_seq_len=${MAX_SEQ}\n`);

  let truncating = 0, malformed = 0;
  const lens: number[] = [];
  const fieldFill: Record<string, number> = {};
  let person = 0, business = 0;
  const docTypes: Record<string, number> = {};
  const seenPrompts = new Map<string, number>();
  let dupes = 0;

  for (const [i, row] of rows.entries()) {
    const sys = row.messages.find((m) => m.role === 'system')?.content ?? '';
    const usr = row.messages.find((m) => m.role === 'user')?.content ?? '';
    const asst = row.messages.find((m) => m.role === 'assistant')?.content ?? '';
    const promptTok = approxTokens(sys) + approxTokens(usr) + 2 * CHAT_OVERHEAD;
    const targetTok = approxTokens(asst) + CHAT_OVERHEAD;
    const total = promptTok + targetTok;
    lens.push(total);

    // CRITICAL: if prompt alone already eats the window, the target is gone.
    if (promptTok + 8 >= MAX_SEQ) {
      truncating++;
      if (truncating <= 5) console.log(`  ✗ TRUNCATE row ${i}: prompt≈${promptTok} tok ≥ max ${MAX_SEQ} — target lost`);
    } else if (total > MAX_SEQ) {
      truncating++;
      if (truncating <= 5) console.log(`  ✗ TRUNCATE row ${i}: total≈${total} tok > ${MAX_SEQ} — target tail cut`);
    }

    // target shape
    try {
      const t = JSON.parse(asst);
      if (!t.fields || typeof t.fields !== 'object') throw new Error('no fields');
      const fields = t.fields as Record<string, { value?: string }>;
      for (const f of TARGET_FIELDS) if (fields[f]?.value) fieldFill[f] = (fieldFill[f] ?? 0) + 1;
      const rt = fields.recipient_type?.value;
      if (rt === 'business') business++; else if (rt === 'person') person++;
      const dt = t.documentType || 'other'; docTypes[dt] = (docTypes[dt] ?? 0) + 1;
    } catch {
      malformed++;
      if (malformed <= 5) console.log(`  ✗ MALFORMED target row ${i}: not valid JSON / no fields`);
    }

    // Dedup on the FULL user content — the first ~hundreds of chars are the
    // shared instruction boilerplate (identical across every row), so a prefix
    // key would falsely flag everything as a duplicate. The document text that
    // actually distinguishes rows lives near the end.
    seenPrompts.set(usr, (seenPrompts.get(usr) ?? 0) + 1);
  }
  for (const c of seenPrompts.values()) if (c > 1) dupes += c - 1;

  lens.sort((a, b) => a - b);
  const pct = (p: number) => lens[Math.min(lens.length - 1, Math.floor(p * lens.length))];
  console.log(`\nlength (est. tokens):  min ${lens[0]}  median ${pct(0.5)}  p90 ${pct(0.9)}  max ${lens[lens.length - 1]}`);
  console.log(`recipient_type:        ${person} person / ${business} business`);
  console.log(`document types:        ${Object.entries(docTypes).map(([k, v]) => `${k}:${v}`).join('  ')}`);
  if (dupes) console.log(`near-duplicate inputs: ${dupes}`);

  // Fields that are too sparse to learn (present in < 3 rows) — the LoRA won't
  // reliably pick these up; surfaces what the adapter can and can't improve.
  const sparse = TARGET_FIELDS.filter((f) => (fieldFill[f] ?? 0) > 0 && (fieldFill[f] ?? 0) < 3);
  const empty = TARGET_FIELDS.filter((f) => !(fieldFill[f] ?? 0));
  console.log(`\nfield coverage (rows with a value):`);
  for (const f of [...TARGET_FIELDS].sort((a, b) => (fieldFill[b] ?? 0) - (fieldFill[a] ?? 0)).slice(0, 12)) {
    console.log(`  ${f.padEnd(24)} ${fieldFill[f] ?? 0}`);
  }
  if (sparse.length) console.log(`  ⚠ sparse (<3 rows, won't learn well): ${sparse.join(', ')}`);
  if (empty.length) console.log(`  ⚠ never present (LoRA can't learn): ${empty.join(', ')}`);

  console.log('\n── verdict ──');
  if (malformed) console.log(`  ✗ ${malformed} malformed targets — fix build-dataset/labels.`);
  if (truncating) {
    console.log(`  ✗ ${truncating} rows would TRUNCATE the target at max_seq_len=${MAX_SEQ}.`);
    console.log(`     Fix: raise --max-seq-len in train_lora.py (cost: VRAM), or lower`);
    console.log(`     MAX_PROMPT_CHARS in serveIntakeExtract.ts so prompts fit.`);
  }
  if (!truncating && !malformed) console.log('  ✅ no truncation, all targets well-formed — safe to train.');
  process.exit(truncating || malformed ? 1 : 0);
}

main();
