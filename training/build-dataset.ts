// ============================================================
// RMPG Flex — Serve-Intake LoRA dataset builder
// ============================================================
// Converts hand-labeled serve-intake documents into the chat-format
// JSONL a LoRA trainer (Cloudflare AutoTrain / HF TRL SFTTrainer)
// consumes. The whole point of this script: the (system,user) half of
// every training row is produced by the SAME buildExtractionMessages()
// that prod inference calls (src/utils/serveIntakeExtract.ts), so the
// adapter is trained on a byte-identical prompt to what it will see live.
//
// Run:  npx tsx training/build-dataset.ts
// In:   training/data/*.json     (one labeled doc per file — see schema below)
// Out:  training/dist/train.jsonl + training/dist/val.jsonl
//
// Labeled-doc schema (training/data/<id>.json):
//   {
//     "id": "job-13572468",          // stable id; also picks train/val split
//     "rawText": "...OCR text...",   // the EXACT text prod fed the model
//     "expected": {
//       "documentType": "summons",   // one of DOC_TYPES
//       "fields": {                  // GROUND TRUTH — flat string values
//         "recipient_first_name": "John",
//         "recipient_last_name": "Sample",
//         "recipient_dob": "1985-03-04",
//         "case_number": ""          // empty string = correctly-absent field
//         // ...any subset of TARGET_FIELDS; omitted fields default to ""
//       }
//     }
//   }
// ============================================================

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildExtractionMessages,
  TARGET_FIELDS,
  type ChatMessage,
  type TargetField,
} from '../src/utils/serveIntakeExtract';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, 'data');
const DIST_DIR = join(HERE, 'dist');

interface LabeledDoc {
  id: string;
  rawText: string;
  expected: { documentType?: string; fields: Partial<Record<TargetField, string>> };
  _verified?: boolean;
  _review?: string[];
}

// Safety gate: only human-verified docs train, so a bad auto-label can't
// silently poison the adapter weights. Pass --include-unverified to build from
// every draft anyway (fast experiments / smoke tests only).
const INCLUDE_UNVERIFIED = process.argv.includes('--include-unverified');

// Data augmentation (on by default; --no-augment to disable). For each doc whose
// source embeds the ServeManager "Imported CSV Row" JSON, emit a SECOND copy
// with that block REMOVED and the SAME target. The CSV is a near-answer-key the
// model can just transcribe; the stripped copy forces it to read the rendered
// Recipient/Court blocks instead — so the adapter learns extraction that
// generalizes to packets without a clean CSV. Both copies share the doc id, so
// they always land in the same train/val bucket (no leakage across the split).
const AUGMENT = !process.argv.includes('--no-augment');

function stripCsvBlock(text: string): string {
  return text.replace(
    /Imported CSV Row:[\s\S]*?\n\s*\}[^\n]*(?:\n|$)/,
    '[Imported CSV row omitted — read the fields from the rendered form]\n',
  );
}

// Build the assistant "target" completion: the exact JSON shape prod parses
// back (documentType, confidence, allDates, fields:{f:{value,confidence}}).
// Ground-truth confidence is 1.0 for a filled field and 0 for an empty one —
// we want the adapter to learn to be CONFIDENT when it reads a value and to
// emit empty+0 (not a hallucinated guess) when a field is absent.
function buildTargetCompletion(doc: LabeledDoc): string {
  const fields: Record<string, { value: string; confidence: number }> = {};
  for (const f of TARGET_FIELDS) {
    const value = (doc.expected.fields[f] ?? '').trim();
    fields[f] = { value, confidence: value ? 1 : 0 };
  }
  return JSON.stringify({
    documentType: doc.expected.documentType || 'other',
    confidence: 1,
    allDates: [],
    fields,
  });
}

function loadDocs(): LabeledDoc[] {
  if (!existsSync(DATA_DIR)) {
    throw new Error(`No training/data dir. Create it and add labeled <id>.json docs (see header).`);
  }
  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'));
  if (files.length === 0) throw new Error('training/data is empty — add labeled docs first.');
  const all = files.map((f) => {
    const doc = JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8')) as LabeledDoc;
    if (!doc.id || !doc.rawText || !doc.expected?.fields) {
      throw new Error(`${f}: missing id / rawText / expected.fields`);
    }
    return doc;
  });
  if (INCLUDE_UNVERIFIED) return all;
  const verified = all.filter((d) => d._verified === true);
  const held = all.length - verified.length;
  if (verified.length === 0) {
    throw new Error(
      `0 of ${all.length} docs are "_verified": true. Eyeball the drafts, fix fields, ` +
      `flip _verified to true — or re-run with --include-unverified to build from all drafts.`,
    );
  }
  if (held) console.log(`(holding ${held} unverified draft(s) out of the dataset)`);
  return verified;
}

// Deterministic train/val split: hash the id so the same doc always lands in
// the same bucket across runs (no Math.random — that would reshuffle the val
// set every build and make eval numbers incomparable). ~15% to val.
function isVal(id: string): boolean {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 100 < 15;
}

// Build one JSONL row from a doc + the input text to train on (lets us reuse
// the same target with an alternate, harder input for augmentation).
function toRow(doc: LabeledDoc, inputText: string): string {
  const messages: ChatMessage[] = [
    ...buildExtractionMessages(inputText),
    { role: 'assistant', content: buildTargetCompletion(doc) },
  ];
  return JSON.stringify({ messages });
}

function main() {
  const docs = loadDocs();
  const train: string[] = [];
  const val: string[] = [];
  let augmented = 0;
  for (const doc of docs) {
    const bucket = isVal(doc.id) ? val : train;
    bucket.push(toRow(doc, doc.rawText));               // primary view (matches prod input)
    if (AUGMENT) {
      const stripped = stripCsvBlock(doc.rawText);
      if (stripped !== doc.rawText && stripped.trim().length > 40) {
        bucket.push(toRow(doc, stripped));              // hard view: same answer, CSV removed
        augmented++;
      }
    }
  }

  mkdirSync(DIST_DIR, { recursive: true });
  writeFileSync(join(DIST_DIR, 'train.jsonl'), train.join('\n') + '\n');
  writeFileSync(join(DIST_DIR, 'val.jsonl'), val.join('\n') + '\n');

  console.log(`Built dataset from ${docs.length} labeled docs${AUGMENT ? ` (+${augmented} CSV-stripped augmented rows)` : ''}:`);
  console.log(`  train: ${train.length} rows → training/dist/train.jsonl`);
  console.log(`  val:   ${val.length} rows → training/dist/val.jsonl`);
  if (val.length === 0) console.warn('  ⚠ val is empty — add more docs so eval has a held-out set.');
}

main();
