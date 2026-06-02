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
// Run (compare against Claude — same prompt, fair A/B):
//   ... ANTHROPIC_API_KEY=sk-ant-... [CLAUDE_MODEL=claude-opus-4-8] npx tsx training/run-eval.ts
//
// The CF token needs "Workers AI: Read". The 70B baseline always runs; the
// LoRA and Claude arms are optional and compared against it.
// ============================================================

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
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
  console.error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (the 70B baseline always runs).');
  process.exit(1);
}
// Optional Claude arm: when ANTHROPIC_API_KEY is set, the SAME docs run through
// Claude with the SAME prompt, so the delta vs the 70B baseline is apples-to-apples.
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-8';
let _anthropic: Anthropic | null = null;
const anthropicClient = () => (_anthropic ??= new Anthropic({ apiKey: ANTHROPIC_KEY }));

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

const CALL_TIMEOUT_MS = 90_000;   // a single ai/run that hangs must not stall the whole eval
const CONCURRENCY = 5;            // parallelize — CF tolerates a handful of concurrent calls

async function runModel(rawText: string, lora?: string): Promise<any> {
  const body: Record<string, unknown> = {
    messages: buildExtractionMessages(rawText),
    temperature: 0.1,
    max_tokens: 2048,
    ...(lora ? { lora, raw: true } : {}),
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${MODEL}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      },
    );
    const json = (await res.json()) as any;
    if (!res.ok || json?.success === false) {
      throw new Error(`ai/run ${res.status}: ${JSON.stringify(json?.errors ?? json).slice(0, 300)}`);
    }
    return json.result; // { response: string | object }
  } finally {
    clearTimeout(timer);
  }
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

// Claude predictor — feeds the SAME (system, user) prompt buildExtractionMessages
// produced for the 70B, so this is a fair head-to-head. The strict-JSON system
// prompt + normalizeModelOutput's tolerant parse handle any stray prose, so we
// don't need structured-output mode for the comparison. Reuses prod's
// normalizeFields, exactly like the 70B path.
async function predictClaude(rawText: string): Promise<Partial<Record<TargetField, string>>> {
  const msgs = buildExtractionMessages(rawText);
  const system = msgs.find((m) => m.role === 'system')!.content;
  const user = msgs.find((m) => m.role === 'user')!.content;
  const resp = await anthropicClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
  });
  const text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
  const result = normalizeModelOutput({ response: text }, rawText, CLAUDE_MODEL);
  const normalized = normalizeFields(result.fields);
  const flat: Partial<Record<TargetField, string>> = {};
  for (const f of TARGET_FIELDS) flat[f] = normalized[f]?.value ?? '';
  return flat;
}

type Predictor = (rawText: string) => Promise<Partial<Record<TargetField, string>>>;

async function evalArm(docs: LabeledDoc[], predictFn: Predictor): Promise<DocScore[]> {
  const scores: DocScore[] = [];
  let next = 0;
  // Bounded worker pool: CONCURRENCY docs in flight at once, each call
  // timeout-guarded, with per-doc progress so the run is visible and a single
  // slow packet can't stall the rest.
  async function worker() {
    while (next < docs.length) {
      const doc = docs[next++];
      try {
        const pred = await predictFn(doc.rawText);
        const s = scoreDoc(doc.id, doc.expected.fields, pred);
        scores.push(s);
        console.log(`  [${scores.length}/${docs.length}] ${doc.id}  ${(s.weightedScore * 100).toFixed(0)}%`);
      } catch (e) {
        console.error(`  ${doc.id}: ${(e as Error).message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, docs.length) }, worker));
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
  const base = aggregate(await evalArm(val, (t) => predict(t)));
  report('BASE (stock 70B)', base);

  if (LORA) {
    const tuned = aggregate(await evalArm(val, (t) => predict(t, LORA)));
    report(`LoRA (${LORA})`, tuned);
    const delta = tuned.meanWeightedScore - base.meanWeightedScore;
    console.log(`\n=> LoRA delta: ${delta >= 0 ? '+' : ''}${pct(delta)} weighted score`);
    console.log(delta > 0 ? '   ✅ fine-tune improved extraction.' : '   ⚠ fine-tune did NOT improve — do not promote.');
  }

  if (ANTHROPIC_KEY) {
    console.log(`\nEvaluating the same docs on Claude (${CLAUDE_MODEL})…`);
    const claude = aggregate(await evalArm(val, predictClaude));
    report(`CLAUDE (${CLAUDE_MODEL})`, claude);
    const delta = claude.meanWeightedScore - base.meanWeightedScore;
    console.log(`\n=> Claude vs base 70B: ${delta >= 0 ? '+' : ''}${pct(delta)} weighted score`);
    console.log(delta > 0
      ? '   ✅ Claude extracts better than the 70B on this set.'
      : '   ⚠ Claude did NOT beat the 70B here.');
  }

  if (!LORA && !ANTHROPIC_KEY) {
    console.log('\n(Set SERVE_INTAKE_LORA to compare a LoRA, or ANTHROPIC_API_KEY to compare Claude, against this baseline.)');
  }
}

main();
