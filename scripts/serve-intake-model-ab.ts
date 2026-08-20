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
//
// ⚠️ THIS GRADES RAW MODEL OUTPUT, NOT WHAT PRODUCTION COMMITS. The route
// runs finalizeFields() (normalizeFields → validateFields) before anything is
// written, which fixes shapes this harness scores as misses: "6/26/2026" →
// "2026-06-26", "Utah" → "UT", "(435) 986-1200" → "4359861200", plus the
// party-name de-noiser. So the score here is a FLOOR on end-to-end accuracy,
// not a measurement of it. Use it to compare models against each other — that
// comparison is fair because every candidate is graded identically — and never
// as a claim about how often the committed record is right.
// ============================================================

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildExtractionMessages, tryParseModelJson, familyFromFileName } from '../src/utils/serveIntakeExtract';
import { callClaude, DEFAULT_CLAUDE_MODEL } from '../src/utils/anthropic';
import { callOpenAi, DEFAULT_OPENAI_MODEL } from '../src/utils/openai';

const FIXTURE_DIR = join(process.cwd(), 'tests', 'fixtures', 'serve-intake');
const API = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run`;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;

const CANDIDATES = [
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/mistralai/mistral-small-3.1-24b-instruct',
  '@cf/zai-org/glm-4.7-flash',
];

if (!TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
  console.error('CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID not set — Workers AI candidates will fail per-call, Claude/OpenAI rows still run if their keys are set.');
}

async function runModel(model: string, text: string, docType: string | undefined): Promise<Record<string, string>> {
  const res = await fetch(`${API}/${model}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: buildExtractionMessages(text, docType),
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

async function runClaude(text: string, docType: string | undefined): Promise<Record<string, string>> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { console.error('  claude: ANTHROPIC_API_KEY not set, skipping'); return {}; }
  const [sys, user] = buildExtractionMessages(text, docType);
  try {
    const raw = await callClaude(key, { system: sys.content, text: user.content, model: DEFAULT_CLAUDE_MODEL, maxTokens: 2048 });
    const parsed = tryParseModelJson({ response: raw });
    if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length === 0) {
      console.error('  claude: unparseable response');
      return {};
    }
    return (parsed as any).fields ?? parsed;
  } catch (e) {
    console.error(`  claude: ${e instanceof Error ? e.message : String(e)}`);
    return {};
  }
}

async function runOpenAi(text: string, docType: string | undefined): Promise<Record<string, string>> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) { console.error('  openai: OPENAI_API_KEY not set, skipping'); return {}; }
  const [sys, user] = buildExtractionMessages(text, docType);
  try {
    const raw = await callOpenAi(key, { system: sys.content, text: user.content, model: DEFAULT_OPENAI_MODEL, maxTokens: 2048 });
    const parsed = tryParseModelJson({ response: raw });
    if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length === 0) {
      console.error('  openai: unparseable response');
      return {};
    }
    return (parsed as any).fields ?? parsed;
  } catch (e) {
    console.error(`  openai: ${e instanceof Error ? e.message : String(e)}`);
    return {};
  }
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

  const runners: Array<{ label: string; run: (text: string, docType: string | undefined) => Promise<Record<string, string>> }> = [
    ...CANDIDATES.map((model) => ({ label: model, run: (text: string, docType: string | undefined) => runModel(model, text, docType) })),
    { label: 'claude (Anthropic API)', run: runClaude },
    { label: 'openai (OpenAI API)', run: runOpenAi },
  ];

  for (const { label, run } of runners) {
    let hit = 0, total = 0;
    console.log(`\n=== ${label}`);
    for (const file of fixtures) {
      const name = file.replace(/\.txt$/, '');
      const want = expected[name];
      if (!want) continue;
      const text = readFileSync(join(FIXTURE_DIR, file), 'utf8');
      // Matches production wiring (src/routes/serveIntake.ts): the document
      // family is derived from the source file's own name, not guessed from
      // content. Today's fixture names (business-subpoena.txt,
      // individual-employment.txt) don't follow the real ICU packet naming
      // convention, so this resolves to undefined for both — the harness
      // still measures the untargeted prompt for now — but any fixture
      // added later with a conventionally-named file gets the SAME family
      // prompt production would send it, keeping this harness honest.
      const got = await run(text, familyFromFileName(file));
      const s = scoreOne(got, want);
      hit += s.hit; total += s.total;
      console.log(`  ${name}: ${s.hit}/${s.total}`);
      for (const m of s.misses) console.log(`      ${m}`);
    }
    console.log(`  TOTAL: ${hit}/${total} (${total ? Math.round((hit / total) * 100) : 0}%)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
