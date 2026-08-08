# Evidence-Gated Workers-AI-Only OCR A/B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the measurement tooling needed to decide, per-tier (text extraction vs. vision/scan OCR), whether Claude and OpenAI can be removed from RMPG Flex's serve-intake OCR pipeline in favor of Cloudflare Workers AI alone — without pre-committing to that outcome.

**Architecture:** Extend the existing text-model A/B script (`scripts/serve-intake-model-ab.ts`) with a new Workers AI candidate and, for the first time, Claude/OpenAI rows scored on the same rubric. Separately, build a new vision-tier A/B script plus the synthetic image fixtures it needs (none currently exist — the fixture corpus is text-only). Run both, record the numbers in a decision log. This plan does **not** include the provider-chain wiring change itself — per the design's non-goal, that's a one-line-per-tier edit made only after real numbers exist, which cannot be written today without guessing the outcome.

**Tech Stack:** TypeScript (`tsx` script execution), `sharp` (SVG→PNG rasterization, already present in `node_modules` as a transitive dependency — this plan adds it as an explicit `devDependency`), Vitest.

## Global Constraints

- No model swap ships without a passing A/B number on a checked-in fixture corpus (per `docs/superpowers/specs/2026-08-08-workers-ai-only-ocr-ab-design.md` §2).
- The accuracy gate for removing Claude/OpenAI on a tier: a Workers AI candidate must score **≥35/36-equivalent** (i.e., match or beat the incumbent's score on that tier's fixture corpus) — see spec §2.1.
- No new third-party vendor is introduced (spec §3) — this plan only measures Cloudflare Workers AI candidates against the already-integrated Claude/OpenAI baseline.
- New image fixtures MUST follow the exact two-guard policy already enforced on text fixtures in `tests/serveIntakeFixtures.test.ts`: a denylist test for known real-packet identities, and a content-hash ratchet test that fails on any undeclared edit (per `tests/fixtures/serve-intake/README.md` and spec §4).
- Both A/B scripts spend real money/neurons and must be run deliberately, never in CI — matching the existing header warning in `scripts/serve-intake-model-ab.ts:1-19`.

---

### Task 1: Extend the text-tier A/B with GLM-4.7-flash and Claude/OpenAI comparison rows

**Files:**
- Modify: `scripts/serve-intake-model-ab.ts`

**Interfaces:**
- Consumes: `buildExtractionMessages(rawText: string, docType?: string): ChatMessage[]` from `src/utils/serveIntakeExtract.ts` (already imported in this file) — returns exactly `[{role:'system',content},{role:'user',content}]`, per `src/utils/serveIntakeExtract.ts:509-516`. `callClaude(apiKey: string, opts: ClaudeCallOpts): Promise<string>` from `src/utils/anthropic.ts` (`ClaudeCallOpts = {system?, text, image?, model?, maxTokens?}`), `DEFAULT_CLAUDE_MODEL = 'claude-opus-4-8'`. `callOpenAi(apiKey: string, opts: OpenAiCallOpts): Promise<string>` from `src/utils/openai.ts` (`OpenAiCallOpts = {system?, text, image?, model?, maxTokens?}`), `DEFAULT_OPENAI_MODEL = 'gpt-4o-mini'`. `tryParseModelJson` (already imported).
- Produces: nothing new consumed by later tasks — this task is independent of Tasks 2-3.

- [ ] **Step 1: Add the new Workers AI candidate**

In `scripts/serve-intake-model-ab.ts`, change the `CANDIDATES` array (currently at line 30):

```ts
const CANDIDATES = [
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/mistralai/mistral-small-3.1-24b-instruct',
  '@cf/zai-org/glm-4.7-flash',
];
```

- [ ] **Step 2: Add Claude/OpenAI runner functions**

Add this import at the top of the file, alongside the existing imports:

```ts
import { callClaude, DEFAULT_CLAUDE_MODEL } from '../src/utils/anthropic';
import { callOpenAi, DEFAULT_OPENAI_MODEL } from '../src/utils/openai';
```

Add these two functions immediately after the existing `runModel` function (which ends around line 74, just before `function scoreOne`):

```ts
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
```

- [ ] **Step 3: Score Claude and OpenAI alongside the Workers AI candidates**

Replace the `main()` function's candidate loop (currently `for (const model of CANDIDATES) { ... }`) with a version that also runs the two new runners as their own labeled rows. Replace the entire `main()` function with:

```ts
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
```

Also relax the top-of-file credential check (currently `if (!TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) { ... process.exit(1); }`) since Claude/OpenAI rows can now run even without Cloudflare credentials (and vice versa) — replace it with a warning instead of a hard exit:

```ts
if (!TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
  console.error('CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID not set — Workers AI candidates will fail per-call, Claude/OpenAI rows still run if their keys are set.');
}
```

- [ ] **Step 4: Verify the script still type-checks and runs its non-network code paths**

This script is excluded from the Worker's `tsconfig` compile target (it lives under `scripts/`, imports from `../src/utils/*`) — confirm it at least parses and type-checks standalone:

Run: `npx tsc --noEmit scripts/serve-intake-model-ab.ts --esModuleInterop --resolveJsonModule --skipLibCheck --module esnext --moduleResolution bundler --target es2022`
Expected: no type errors. (This is a standalone syntax/type check, not the project's real `tsconfig` — the project's own `npm run typecheck` does not include `scripts/`, so this step is how you catch a typo before spending real API credits running it live.)

Do NOT run the script live in this task (it spends real Anthropic/OpenAI/Workers AI credits) — that happens in Task 4, after Tasks 2-3 are also ready, so both A/Bs can be run and reported together.

- [ ] **Step 5: Commit**

```bash
git add scripts/serve-intake-model-ab.ts
git commit -m "feat(serve-intake): add GLM-4.7-flash + Claude/OpenAI rows to text-tier OCR A/B"
```

---

### Task 2: Build synthetic vision-A/B image fixtures

**Files:**
- Create: `tests/fixtures/serve-intake/vision/watermark-bleed.svg`
- Create: `tests/fixtures/serve-intake/vision/homoglyph-address.svg`
- Create: `tests/fixtures/serve-intake/vision/expected-vision.json`
- Create: `scripts/generate-vision-ab-fixtures.ts`
- Modify: `tests/serveIntakeFixtures.test.ts` (extend both guard tests to cover the two new `.svg` files)
- Modify: `package.json` (add `sharp` as an explicit devDependency — it is already present transitively in `node_modules` at version `0.35.2`, per `package-lock.json:3558`, but this task makes the dependency explicit rather than relying on an unpinned transitive resolution)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: the two `.svg` fixture files, `expected-vision.json` (shape: `Record<string, Record<string,string>>`, same shape as the existing `tests/fixtures/serve-intake/expected.json`, keyed by fixture base name), and `scripts/generate-vision-ab-fixtures.ts` which Task 3's vision A/B script does NOT need to invoke at run time (the generator is a one-time/regenerate-on-edit tool — the A/B script reads the rasterized `.png` files it produces, checked into `tests/fixtures/serve-intake/vision/*.png`).

- [ ] **Step 1: Add `sharp` as an explicit devDependency**

Run: `npm install --save-dev sharp@0.35.2`
Expected: `package.json`'s `devDependencies` gains `"sharp": "0.35.2"`; `package-lock.json` changes minimally since this version is already resolved transitively.

- [ ] **Step 2: Write the two synthetic SVG fixtures**

These reproduce the same class of hazard as the real ICU packets (per the existing text fixtures' documented hazards), with entirely fabricated identities — following the exact pattern `tests/fixtures/serve-intake/README.md` already documents for the `.txt` fixtures.

Create `tests/fixtures/serve-intake/vision/watermark-bleed.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="500" viewBox="0 0 900 500">
  <rect width="900" height="500" fill="white"/>
  <g font-family="Courier New, monospace" font-size="18" fill="black">
    <text x="30" y="40">Meridian Investigations, LLC</text>
    <text x="30" y="65">400 S Commerce Way, Suite 210</text>
    <text x="30" y="90">Ogden, UT 84401</text>
    <text x="500" y="40">Job: 77000015   Due: 08/14/2026</text>
    <text x="500" y="65">Party to Serve: Wasatch Freight Solutions, LLC</text>
    <text x="30" y="160">Case</text>
    <text x="350" y="160">Plaintiff</text>
    <text x="470" y="220">H</text>
    <text x="30" y="260">Court</text>
    <text x="350" y="260">Defendant</text>
    <text x="470" y="320">S</text>
    <text x="30" y="360">Documents</text>
    <text x="120" y="360">UT Subpoena; UT Application for Subpoena</text>
    <text x="470" y="420">U</text>
    <text x="30" y="460">Instructions</text>
    <text x="150" y="460">RUSH - SERVE AT THIS BUSINESS ADDRESS BEFORE 5PM FRIDAY.</text>
    <text x="470" y="480">R</text>
  </g>
</svg>
```

Create `tests/fixtures/serve-intake/vision/homoglyph-address.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="300" viewBox="0 0 900 300">
  <rect width="900" height="300" fill="white"/>
  <g font-family="Courier New, monospace" font-size="18" fill="black">
    <text x="30" y="40">Superior Court of the State of Arizona</text>
    <text x="30" y="70">Recipient: Dana Whitfield</text>
    <text x="30" y="100">Address: 1220 E Baseline Rd</text>
    <text x="30" y="130">Tempe, СA 85283</text>
    <text x="30" y="160">Job: 51000042   Due: 09/02/2026</text>
  </g>
</svg>
```

Note: the `С` in `"Tempe, СA 85283"` on line 4 of the second fixture is Cyrillic U+0421, not Latin C (U+0043) — this is the deliberate hazard under test, matching the real-world example already documented in `src/utils/serveIntakePreclean.ts:12` (`"Palo Alto, СA 94304"`). When editing this file, use a hex/codepoint-aware editor or verify with `node -e "console.log([...'СA'].map(c=>c.codePointAt(0).toString(16)))"` (expect `['421','41']`) to confirm the substitution survives your editor's autocorrect.

- [ ] **Step 3: Write the expected-fields file**

Create `tests/fixtures/serve-intake/vision/expected-vision.json`:

```json
{
  "watermark-bleed": {
    "recipient_business_name": "Wasatch Freight Solutions, LLC",
    "recipient_city": "Ogden",
    "recipient_state": "UT",
    "job_number": "77000015",
    "priority": "rush"
  },
  "homoglyph-address": {
    "recipient_city": "Tempe",
    "recipient_state": "AZ",
    "recipient_zip": "85283",
    "job_number": "51000042"
  }
}
```

- [ ] **Step 4: Write the SVG→PNG rasterizer script**

Create `scripts/generate-vision-ab-fixtures.ts`:

```ts
// ============================================================
// Generates the rasterized PNG fixtures the vision A/B (Task 3)
// reads, from the checked-in SVG sources. Re-run this whenever an
// .svg fixture changes — the PNGs are checked in too, so a vision
// A/B run never depends on this script executing first, but the
// PNGs must match their .svg source or the fixture guard test
// (Task 2, Step 5) has nothing to say about what the model actually saw.
//
//   npx tsx scripts/generate-vision-ab-fixtures.ts
// ============================================================
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const DIR = join(process.cwd(), 'tests', 'fixtures', 'serve-intake', 'vision');

async function main() {
  const svgFiles = readdirSync(DIR).filter((f) => f.endsWith('.svg'));
  for (const file of svgFiles) {
    const svg = readFileSync(join(DIR, file));
    const pngPath = join(DIR, file.replace(/\.svg$/, '.png'));
    await sharp(svg).png().toFile(pngPath);
    console.log(`wrote ${pngPath}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 5: Run the generator and verify the PNGs exist**

Run: `npx tsx scripts/generate-vision-ab-fixtures.ts`
Expected output: `wrote .../tests/fixtures/serve-intake/vision/watermark-bleed.png` and `wrote .../tests/fixtures/serve-intake/vision/homoglyph-address.png`

Run: `ls -la tests/fixtures/serve-intake/vision/`
Expected: both `.svg` files, both `.png` files (each with a non-zero byte size), and `expected-vision.json` present.

- [ ] **Step 6: Extend the fixture guard tests to cover the new SVGs**

`tests/serveIntakeFixtures.test.ts` currently defines `FIXTURE_DIR = join(__dirname, 'fixtures', 'serve-intake')` (line 16) and a `loadFixture(name)` helper that reads `${name}.txt` from it (lines 18-20). The two guards — "carries no real client identities" (lines 27-37) and the `FIXTURE_HASHES` content ratchet (lines 56-75) — both iterate only `['business-subpoena', 'individual-employment']`. Add a second, parallel set for the vision fixtures rather than overloading `loadFixture` (which is `.txt`-specific and used elsewhere in this file for the pre-clean tests).

First, get the two new files' SHA-256 hashes:

```bash
node -e "const {createHash}=require('crypto'); const {readFileSync}=require('fs'); for (const f of ['tests/fixtures/serve-intake/vision/watermark-bleed.svg','tests/fixtures/serve-intake/vision/homoglyph-address.svg']) console.log(f, createHash('sha256').update(readFileSync(f)).digest('hex'));"
```

Then add this new `describe` block to `tests/serveIntakeFixtures.test.ts`, immediately after the closing `});` of the `describe('fixture corpus integrity', ...)` block (after line 76, before `describe('pre-clean against real hazards', ...)`):

```ts
describe('vision fixture corpus integrity', () => {
  const VISION_DIR = join(__dirname, 'fixtures', 'serve-intake', 'vision');
  const VISION_FIXTURES = ['watermark-bleed', 'homoglyph-address'];

  function loadVisionSvg(name: string): string {
    return readFileSync(join(VISION_DIR, `${name}.svg`), 'utf8');
  }

  it('carries no real client identities', () => {
    const forbidden = ['Telarus', 'Anderson', 'Clough', 'Foothill', 'Telarus, LLC', 'Currie'];
    for (const name of VISION_FIXTURES) {
      const svg = loadVisionSvg(name);
      for (const f of forbidden) {
        expect(svg.toLowerCase()).not.toContain(f.toLowerCase());
      }
    }
  });

  it('every vision fixture has an expected-vision block', () => {
    const expected = JSON.parse(readFileSync(join(VISION_DIR, 'expected-vision.json'), 'utf8'));
    expect(Object.keys(expected).sort()).toEqual([...VISION_FIXTURES].sort());
  });

  // Content ratchet — same rationale as FIXTURE_HASHES above: pins the exact
  // SVG source bytes so any edit (not just a re-paste of a known forbidden
  // name) is caught and forces a deliberate, reviewed hash update.
  const VISION_FIXTURE_HASHES: Record<string, string> = {
    'watermark-bleed': '<PASTE HASH FROM THE node -e COMMAND ABOVE>',
    'homoglyph-address': '<PASTE HASH FROM THE node -e COMMAND ABOVE>',
  };

  it('vision fixture content matches its recorded hash (content ratchet)', () => {
    for (const name of VISION_FIXTURES) {
      const raw = readFileSync(join(VISION_DIR, `${name}.svg`));
      const actual = createHash('sha256').update(raw).digest('hex');
      expect(
        actual,
        `${name}.svg content changed (hash ${actual} != recorded ${VISION_FIXTURE_HASHES[name]}). ` +
          `If this is an intentional, reviewed edit to SYNTHETIC content, verify the new SVG text ` +
          `still contains no real names/case data, then update VISION_FIXTURE_HASHES['${name}'] in ` +
          `tests/serveIntakeFixtures.test.ts to the new hash, and re-run ` +
          `scripts/generate-vision-ab-fixtures.ts to regenerate the matching .png.`
      ).toBe(VISION_FIXTURE_HASHES[name]);
    }
  });
});
```

Replace the two `<PASTE HASH FROM THE node -e COMMAND ABOVE>` placeholders with the actual hashes the command printed — these are real, deterministic SHA-256 values of the exact SVG content you wrote in Step 2, not values to guess or leave unfilled.

- [ ] **Step 7: Run the fixture tests to verify the new guards pass**

Run: `npx vitest run tests/serveIntakeFixtures.test.ts`
Expected: PASS — all existing tests plus the extended denylist/hash coverage for the two new `.svg` files.

- [ ] **Step 8: Run the full test suite**

Run: `npx vitest run`
Expected: PASS, no regressions (this task touches only test fixtures, a new generator script, and a devDependency addition — no production code path changes).

- [ ] **Step 9: Commit**

```bash
git add tests/fixtures/serve-intake/vision/ scripts/generate-vision-ab-fixtures.ts tests/serveIntakeFixtures.test.ts package.json package-lock.json
git commit -m "feat(serve-intake): add synthetic vision-tier OCR A/B fixtures"
```

---

### Task 3: Build the vision-tier A/B script

**Files:**
- Create: `scripts/serve-intake-vision-ab.ts`

**Interfaces:**
- Consumes: the `.png` files and `expected-vision.json` from Task 2 (`tests/fixtures/serve-intake/vision/`); `tryParseModelJson` from `src/utils/serveIntakeExtract.ts`; `visionSystemPrompt()` and `buildVisionUserPrompt(sel: OcrProfileSelector)` from `src/utils/ocrProfiles.ts` (same functions `src/utils/visionExtract.ts` already uses at `extractVision()`/`extractVisionWorkersAI()`); `callClaude`/`DEFAULT_CLAUDE_MODEL` and `callOpenAi`/`DEFAULT_OPENAI_MODEL` (same as Task 1).
- Produces: nothing consumed by later tasks — Task 4 runs this script and reads its console output, it does not import from it.

- [ ] **Step 1: Confirm the exact vision prompt-builder signatures before writing the script**

Read `src/utils/ocrProfiles.ts`'s exports for `visionSystemPrompt` and `buildVisionUserPrompt`, and `src/utils/visionExtract.ts:29-42` (`extractVision`) to confirm the exact `OcrProfileSelector` value this plan should pass (the existing production call site uses `sel` from the caller — for this A/B, use the literal `'auto'` selector, which `src/routes/serveIntake.ts`'s comments describe as "Claude classifies the document AND extracts its fields," the most representative single selector for an A/B that isn't targeting one specific document family).

- [ ] **Step 2: Write the vision A/B script**

Create `scripts/serve-intake-vision-ab.ts`:

```ts
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
```

- [ ] **Step 3: Verify the script type-checks**

Run: `npx tsc --noEmit scripts/serve-intake-vision-ab.ts --esModuleInterop --resolveJsonModule --skipLibCheck --module esnext --moduleResolution bundler --target es2022`
Expected: no type errors.

Do NOT run this script live in this task — that happens in Task 4, alongside Task 1's script, so both results land in the same decision record.

- [ ] **Step 4: Commit**

```bash
git add scripts/serve-intake-vision-ab.ts
git commit -m "feat(serve-intake): add vision-tier OCR A/B script"
```

---

### Task 4: Run both A/Bs and record the decision

**Files:**
- Create: `docs/superpowers/specs/2026-08-08-workers-ai-only-ocr-ab-results.md`

**Interfaces:**
- Consumes: the console output of `scripts/serve-intake-model-ab.ts` (Task 1) and `scripts/serve-intake-vision-ab.ts` (Task 3).
- Produces: a decision record; no code interface, since this task's very purpose is to determine whether a follow-up plan (the actual provider-chain wiring, per spec §2.3) gets written at all, and for which tier(s).

This task requires live credentials this plan cannot supply: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` set in the shell environment (or `.dev.vars`-equivalent for a local script — these are read via `process.env` directly, not through Worker bindings, so `.dev.vars` alone will NOT populate them; they must be exported in the shell running the script). If you don't have these on hand, report BLOCKED with exactly which are missing — do not fabricate results or skip a row silently without noting it in the results doc.

- [ ] **Step 1: Run the text-tier A/B**

Run: `npx tsx scripts/serve-intake-model-ab.ts 2>&1 | tee /tmp/text-ab-results.txt`
Expected: one `TOTAL: X/36 (Y%)` line per runner (4 Workers AI models + claude + openai). Capture the full output.

- [ ] **Step 2: Run the vision-tier A/B**

Run: `npx tsx scripts/serve-intake-vision-ab.ts 2>&1 | tee /tmp/vision-ab-results.txt`
Expected: one `TOTAL: X/9 (Y%)` line per runner (2 Workers AI models + claude-vision + openai-vision — 9 is the total field count across both `expected-vision.json` fixtures: 5 + 4).

- [ ] **Step 3: Write the results doc**

Create `docs/superpowers/specs/2026-08-08-workers-ai-only-ocr-ab-results.md` with this structure (fill in the actual numbers from Steps 1-2 — do not invent numbers if a run failed or a key was missing, write "not run: <reason>" for that row instead):

```markdown
# Workers-AI-Only OCR A/B Results

**Date run:** <fill in>
**Ran by:** <fill in>

## Text tier (bar: incumbent scored 35/36 on 2026-07-27)

| Candidate | Score | Notes |
|---|---|---|
| @cf/meta/llama-3.3-70b-instruct-fp8-fast (incumbent) | <fill in> | |
| @cf/meta/llama-4-scout-17b-16e-instruct | <fill in> | |
| @cf/mistralai/mistral-small-3.1-24b-instruct | <fill in> | |
| @cf/zai-org/glm-4.7-flash | <fill in> | |
| claude (Anthropic API) | <fill in> | |
| openai (OpenAI API) | <fill in> | |

**Text-tier verdict:** [Remove Claude/OpenAI from the text tier | Keep Claude/OpenAI in the text tier] — <one sentence citing the actual numbers>

## Vision tier (bar: whatever the incumbent scores this run — no prior baseline exists, this is the first time this tier has been measured)

| Candidate | Score | Notes |
|---|---|---|
| @cf/meta/llama-3.2-11b-vision-instruct (incumbent) | <fill in> | |
| @cf/moondream/moondream3.1-9B-A2B | <fill in> | |
| claude-vision (Anthropic API) | <fill in> | |
| openai-vision (OpenAI API) | <fill in> | |

**Vision-tier verdict:** [Remove Claude/OpenAI from the vision tier | Keep Claude/OpenAI in the vision tier] — <one sentence citing the actual numbers>

## Next step

<If either tier's verdict is "Remove Claude/OpenAI": note that a follow-up plan is needed for the one-line-per-tier `providers:` array edit described in spec §2.3, scoped to only the tier(s) that cleared the bar. If neither tier clears the bar: note that the pipeline stays as-is and this work is complete as a measurement-only exercise.>
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-08-08-workers-ai-only-ocr-ab-results.md
git commit -m "docs(serve-intake): record Workers-AI-only OCR A/B results"
```
