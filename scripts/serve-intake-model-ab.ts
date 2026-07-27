// ============================================================
// Serve Intake — extraction model A/B
// ============================================================
// Spends neurons. Run deliberately, not in CI.
//
//   npx tsx scripts/serve-intake-model-ab.ts
//
// Grades each candidate model against tests/fixtures/serve-intake/expected.json
// and prints a per-field accuracy table. The winner becomes the default in
// serveIntakeExtract.ts — this script is the evidence for that edit.
// ============================================================

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildExtractionMessages, tryParseModelJson } from '../src/utils/serveIntakeExtract';

const FIXTURE_DIR = join(process.cwd(), 'tests', 'fixtures', 'serve-intake');
const API = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run`;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;

const CANDIDATES = [
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/mistralai/mistral-small-3.1-24b-instruct',
];

if (!TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
  console.error('Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.');
  process.exit(1);
}

async function runModel(model: string, text: string): Promise<Record<string, string>> {
  const res = await fetch(`${API}/${model}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: buildExtractionMessages(text),
      temperature: 0.1,
      max_tokens: 2048,
    }),
  });
  if (!res.ok) {
    console.error(`  ${model}: HTTP ${res.status}`);
    return {};
  }
  const body = await res.json() as { result?: { response?: unknown } };
  const raw = body.result?.response;
  if (raw === undefined || raw === null) {
    console.error(`  ${model}: no response`);
    return {};
  }
  // Workers AI returns result.response as EITHER a string (needs parsing,
  // possibly ```/```json fenced) or an already-parsed object, depending on
  // the model/gateway path. tryParseModelJson() in serveIntakeExtract.ts is
  // the SAME parser production uses for this ambiguity — importing it here
  // (instead of a local reimplementation) is what keeps this A/B harness
  // measuring what actually ships. A prior local copy of this logic drifted
  // from prod at least twice (see git history), each time silently zeroing
  // out every candidate's score.
  const parsed = tryParseModelJson({ response: raw });
  if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length === 0) {
    console.error(`  ${model}: unparseable response`);
    return {};
  }
  return (parsed as any).fields ?? parsed;
}

function scoreOne(got: Record<string, unknown>, want: Record<string, string>) {
  let hit = 0;
  const misses: string[] = [];
  for (const [k, expected] of Object.entries(want)) {
    if (!expected) continue;
    const actual = String((got as any)?.[k]?.value ?? (got as any)?.[k] ?? '').trim();
    if (actual.toLowerCase() === expected.toLowerCase()) hit++;
    else misses.push(`${k}: want "${expected}", got "${actual}"`);
  }
  const total = Object.values(want).filter(Boolean).length;
  return { hit, total, misses };
}

async function main() {
  const expected = JSON.parse(readFileSync(join(FIXTURE_DIR, 'expected.json'), 'utf8'));
  const fixtures = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.txt'));

  for (const model of CANDIDATES) {
    let hit = 0, total = 0;
    console.log(`\n=== ${model}`);
    for (const file of fixtures) {
      const name = file.replace(/\.txt$/, '');
      const want = expected[name];
      if (!want) continue;
      const text = readFileSync(join(FIXTURE_DIR, file), 'utf8');
      const got = await runModel(model, text);
      const s = scoreOne(got, want);
      hit += s.hit; total += s.total;
      console.log(`  ${name}: ${s.hit}/${s.total}`);
      for (const m of s.misses) console.log(`      ${m}`);
    }
    console.log(`  TOTAL: ${hit}/${total} (${total ? Math.round((hit / total) * 100) : 0}%)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
