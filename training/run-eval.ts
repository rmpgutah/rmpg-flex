// ============================================================
// RMPG Flex — Serve-Intake LoRA eval runner
// ============================================================
// Runs the held-out val docs through Workers AI (REST ai/run) and scores
// the result with training/eval.ts. Compares the stock 70B against your
// LoRA so you can SEE whether the fine-tune helped before flipping it on
// in prod. Uses the SAME prompt builder, parse, and normalizers as the
// live Worker (imported from src/), so the numbers reflect production.
//
// Run (base only — baseline):
//   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... npx tsx training/run-eval.ts
// Run (compare against an uploaded LoRA):
//   ... SERVE_INTAKE_LORA=serve-intake-v1 npx tsx training/run-eval.ts
//
// The API token needs the "Workers AI: Read" permission.
// ============================================================

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildExtractionMessages,
  normalizeModelOutput,
  normalizeFields,
  TARGET_FIELDS,
  type TargetField,
} from '../src/utils/serveIntakeExtract';
import { scoreDoc, aggregate, type DocScore } from './eval';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, 'data');
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const LORA = process.env.SERVE_INTAKE_LORA;
if (!ACCOUNT || !TOKEN) {
  console.error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.');
  process.exit(1);
}

// Same deterministic 15% val split as build-dataset.ts, so we evaluate on the
// exact rows the trainer never saw. (Inlined to avoid importing build-dataset,
// whose module body runs on import.)
function isVal(id: string): boolean {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 100 < 15;
}

interface LabeledDoc {
  id: string;
  rawText: string;
  expected: { documentType?: string; fields: Partial<Record<TargetField, string>> };
}

async function runModel(rawText: string, lora?: string): Promise<any> {
  const body: Record<string, unknown> = {
    messages: buildExtractionMessages(rawText),
    temperature: 0.1,
    max_tokens: 2048,
    ...(lora ? { lora, raw: true } : {}),
  };
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${MODEL}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  const json = (await res.json()) as any;
  if (!res.ok || json?.success === false) {
    throw new Error(`ai/run ${res.status}: ${JSON.stringify(json?.errors ?? json).slice(0, 300)}`);
  }
  return json.result; // { response: string | object }
}

// Run one doc, return the flat {field: value} the SAME way prod does:
// model output → normalizeModelOutput (parse + scrub placeholders) →
// normalizeFields (deterministic phone/state/zip/date shaping).
async function predict(rawText: string, lora?: string): Promise<Partial<Record<TargetField, string>>> {
  const out = await runModel(rawText, lora);
  const result = normalizeModelOutput(out, rawText, MODEL);
  const normalized = normalizeFields(result.fields);
  const flat: Partial<Record<TargetField, string>> = {};
  for (const f of TARGET_FIELDS) flat[f] = normalized[f]?.value ?? '';
  return flat;
}

async function evalArm(docs: LabeledDoc[], lora?: string): Promise<DocScore[]> {
  const scores: DocScore[] = [];
  for (const doc of docs) {
    try {
      const pred = await predict(doc.rawText, lora);
      scores.push(scoreDoc(doc.id, doc.expected.fields, pred));
    } catch (e) {
      console.error(`  ${doc.id}: ${(e as Error).message}`);
    }
  }
  return scores;
}

function pct(n: number): string { return `${(n * 100).toFixed(1)}%`; }

function report(label: string, scores: ReturnType<typeof aggregate>) {
  console.log(`\n── ${label} ──`);
  console.log(`  docs: ${scores.docs}   weighted score: ${pct(scores.meanWeightedScore)}`);
  console.log(`  outcomes:`, scores.totals);
  console.log(`  weakest fields (recall, n present):`);
  for (const r of scores.perFieldRecall.slice(0, 8)) {
    console.log(`    ${r.field.padEnd(24)} ${pct(r.recall)}  (n=${r.n})`);
  }
}

async function main() {
  if (!existsSync(DATA_DIR)) { console.error('No training/data dir.'); process.exit(1); }
  const all: LabeledDoc[] = readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8')));
  const val = all.filter((d) => isVal(d.id));
  if (val.length === 0) { console.error('Val split is empty — add more labeled docs.'); process.exit(1); }

  console.log(`Evaluating ${val.length} held-out docs on ${MODEL}…`);
  const base = aggregate(await evalArm(val));
  report('BASE (stock 70B)', base);

  if (LORA) {
    const tuned = aggregate(await evalArm(val, LORA));
    report(`LoRA (${LORA})`, tuned);
    const delta = tuned.meanWeightedScore - base.meanWeightedScore;
    console.log(`\n=> LoRA delta: ${delta >= 0 ? '+' : ''}${pct(delta)} weighted score`);
    console.log(delta > 0 ? '   ✅ fine-tune improved extraction.' : '   ⚠ fine-tune did NOT improve — do not promote.');
  } else {
    console.log('\n(Set SERVE_INTAKE_LORA to compare an uploaded adapter against this baseline.)');
  }
}

main();
