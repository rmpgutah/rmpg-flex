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
  const { buildExtractionMessages } = await import('../src/utils/serveIntakeExtract');
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
  // Workers AI returns result.response as EITHER a string (needs parsing)
  // or an already-parsed object, depending on the model/gateway path — the
  // same ambiguity tryParseModelJson() in serveIntakeExtract.ts handles for
  // production. A version of this script that assumed "always string" (via
  // raw.indexOf('{')) threw on the object case and every candidate showed
  // as "unparseable response" with 0/0 scores across the board — a script
  // bug, not a model signal.
  if (raw && typeof raw === 'object') {
    return (raw as any).fields ?? raw;
  }
  if (typeof raw !== 'string') {
    console.error(`  ${model}: no response`);
    return {};
  }
  // Some models (Scout, Mistral) wrap the JSON in ```/```json fences. A
  // naive raw.slice(raw.indexOf('{')) takes everything to the END of the
  // string, including the trailing ``` fence marker, which breaks
  // JSON.parse — that was silently making every fenced response look
  // "unparseable" even though the JSON itself was well-formed. Strip
  // fences first, then fall back to a greedy {...} match (mirrors
  // tryParseModelJson() in serveIntakeExtract.ts) so we bound the match
  // to the actual JSON object instead of slicing to end-of-string.
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(cleaned).fields ?? JSON.parse(cleaned);
  } catch { /* fall through */ }
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const parsed = JSON.parse(m[0]);
      return parsed.fields ?? parsed;
    } catch { /* fall through */ }
  }
  console.error(`  ${model}: unparseable response`);
  return {};
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
