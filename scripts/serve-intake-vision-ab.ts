// ============================================================
// Serve Intake — vision/scan-OCR model A/B
// ============================================================
// Spends neurons AND Anthropic/OpenAI credits. Run deliberately, not in CI.
//
//   npx tsx scripts/serve-intake-vision-ab.ts
//
// Grades each vision candidate against tests/fixtures/serve-intake/vision/
// expected-vision.json. This is the vision-tier counterpart to
// scripts/serve-intake-model-ab.ts — see that file's header for the same
// "grades raw model output, not what production commits" caveat, which
// applies here identically (finalizeFields() still runs after extraction
// in production).
// ============================================================

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tryParseModelJson } from '../src/utils/serveIntakeExtract';
import { visionSystemPrompt, buildVisionUserPrompt } from '../src/utils/ocrProfiles';
import { callClaude, DEFAULT_CLAUDE_MODEL } from '../src/utils/anthropic';
import { callOpenAi, DEFAULT_OPENAI_MODEL } from '../src/utils/openai';

const FIXTURE_DIR = join(process.cwd(), 'tests', 'fixtures', 'serve-intake', 'vision');
const API = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run`;
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

const WORKERS_AI_CANDIDATES = [
  '@cf/meta/llama-3.2-11b-vision-instruct', // incumbent
  '@cf/moondream/moondream3.1-9B-A2B',      // deferred candidate, never tested
];

async function runWorkersAiVision(model: string, imageBase64: string): Promise<Record<string, string>> {
  if (!CF_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
    console.error(`  ${model}: CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID not set, skipping`);
    return {};
  }
  const res = await fetch(`${API}/${model}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: Array.from(Buffer.from(imageBase64, 'base64')),
      prompt: `${visionSystemPrompt()}\n\n${buildVisionUserPrompt('auto')}`,
      max_tokens: 2048,
      temperature: 0.1,
    }),
  });
  if (!res.ok) { console.error(`  ${model}: HTTP ${res.status}`); return {}; }
  const body = await res.json() as { result?: unknown };
  const parsed = tryParseModelJson(body.result);
  if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length === 0) {
    console.error(`  ${model}: unparseable response`);
    return {};
  }
  return (parsed as any).fields ?? parsed;
}

async function runClaudeVision(imageBase64: string): Promise<Record<string, string>> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { console.error('  claude-vision: ANTHROPIC_API_KEY not set, skipping'); return {}; }
  try {
    const raw = await callClaude(key, {
      system: visionSystemPrompt(),
      text: buildVisionUserPrompt('auto'),
      image: { base64: imageBase64, mediaType: 'image/png' },
      model: DEFAULT_CLAUDE_MODEL,
      maxTokens: 2048,
    });
    const parsed = tryParseModelJson({ response: raw });
    if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length === 0) {
      console.error('  claude-vision: unparseable response');
      return {};
    }
    return (parsed as any).fields ?? parsed;
  } catch (e) {
    console.error(`  claude-vision: ${e instanceof Error ? e.message : String(e)}`);
    return {};
  }
}

async function runOpenAiVision(imageBase64: string): Promise<Record<string, string>> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) { console.error('  openai-vision: OPENAI_API_KEY not set, skipping'); return {}; }
  try {
    const raw = await callOpenAi(key, {
      system: visionSystemPrompt(),
      text: buildVisionUserPrompt('auto'),
      image: { base64: imageBase64, mediaType: 'image/png' },
      model: DEFAULT_OPENAI_MODEL,
      maxTokens: 2048,
    });
    const parsed = tryParseModelJson({ response: raw });
    if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length === 0) {
      console.error('  openai-vision: unparseable response');
      return {};
    }
    return (parsed as any).fields ?? parsed;
  } catch (e) {
    console.error(`  openai-vision: ${e instanceof Error ? e.message : String(e)}`);
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
  const expected = JSON.parse(readFileSync(join(FIXTURE_DIR, 'expected-vision.json'), 'utf8'));
  const fixtures = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.png'));

  const runners: Array<{ label: string; run: (imageBase64: string) => Promise<Record<string, string>> }> = [
    ...WORKERS_AI_CANDIDATES.map((model) => ({ label: model, run: (img: string) => runWorkersAiVision(model, img) })),
    { label: 'claude-vision (Anthropic API)', run: runClaudeVision },
    { label: 'openai-vision (OpenAI API)', run: runOpenAiVision },
  ];

  for (const { label, run } of runners) {
    let hit = 0, total = 0;
    console.log(`\n=== ${label}`);
    for (const file of fixtures) {
      const name = file.replace(/\.png$/, '');
      const want = expected[name];
      if (!want) continue;
      const imageBase64 = readFileSync(join(FIXTURE_DIR, file)).toString('base64');
      const got = await run(imageBase64);
      const s = scoreOne(got, want);
      hit += s.hit; total += s.total;
      console.log(`  ${name}: ${s.hit}/${s.total}`);
      for (const m of s.misses) console.log(`      ${m}`);
    }
    console.log(`  TOTAL: ${hit}/${total} (${total ? Math.round((hit / total) * 100) : 0}%)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
