# Evidence-Gated Move to Workers-AI-Only OCR (design)

**Date:** 2026-08-08
**Context:** Serve Intake OCR (`docs/superpowers/specs/2026-07-26-serve-intake-ocr-enhancement-design.md`)

## 1. Background

The current serve-intake OCR pipeline routes both text extraction and vision/scan OCR through `callAi()`, which tries Claude → OpenAI → Cloudflare Workers AI in order (`src/utils/callAi.ts` `DEFAULT_CHAIN`). This was a deliberate, measured choice:

- A 2026-07-26 A/B on the 10-packet ICU fixture corpus (`scripts/serve-intake-model-ab.ts`, `tests/fixtures/serve-intake/expected.json`) tested three Workers AI text candidates. The incumbent — `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, reached via the same `callAi()` chain — scored 35/36 after prompt fixes; `@cf/meta/llama-4-scout-17b-16e-instruct` was rejected at 26–28/36 after it misread the ICU letterhead address as the service address (a wrong-building dispatch risk).
- A vision-tier A/B (incumbent `@cf/meta/llama-3.2-11b-vision-instruct` vs. `@cf/moondream/moondream3.1-9B-A2B`, added to Workers AI 2026-07-08) was explicitly deferred and has never been run. Claude vision remains the first leg of the vision chain today (`src/utils/visionExtract.ts` `extractVision()`, restricted to `['claude', 'openai']`), with Workers AI vision (`extractVisionWorkersAI()`) as the free-tier fallback.

**Request:** remove Claude and OpenAI from the OCR pipeline entirely, so all serve-intake OCR runs on Cloudflare Workers AI only.

**Constraint the operator set on this request:** the switch is evidence-gated. A Workers AI candidate must match or beat the existing incumbent's measured accuracy on the same fixture corpus before Claude/OpenAI are removed for that tier. If no candidate clears the bar for a given tier, Claude/OpenAI stay in the chain for that tier — the two tiers (text, vision) are graded and gated independently.

**Live catalog check (2026-08-08, via Cloudflare docs/changelog search — the models index page itself could not be fetched, so this is not a guaranteed-complete scan):**
- No new vision-capable model was found beyond the already-known `@cf/moondream/moondream3.1-9B-A2B`. Cloudflare's own model description names "OCR" and "structured output" as capabilities, at $0.30/M input + $1.00/M output tokens (vs. the incumbent Llama vision model's $0.049/M in + $0.676/M out).
- One new text candidate not in the 2026-07-26 comparison: `@cf/zai-org/glm-4.7-flash`, free-tier eligible, 131,072-token context, Cloudflare's own copy describes it as suited to long-document tasks. (`@cf/zai-org/glm-5.2` and the Kimi K2.x models are also new but are paid-plan-only and marketed for agentic/coding work, not document extraction — excluded as poor fits.)

## 2. Design

### 2.1 Text-tier A/B (extend the existing harness)

Add `@cf/zai-org/glm-4.7-flash` as a fourth candidate in `scripts/serve-intake-model-ab.ts`'s `CANDIDATES` array. Re-run against the same `tests/fixtures/serve-intake/expected.json` corpus, using the same per-field scoring the 2026-07-26 A/B used. No harness changes needed — this model takes the same text-completion request shape as the three existing candidates.

**Gate:** the text tier only drops Claude/OpenAI if a Workers AI candidate scores **≥35/36** (the incumbent's re-measured 2026-07-27 score) on this harness. If the incumbent `llama-3.3-70b-instruct-fp8-fast` still wins outright, that's not a reason to keep Claude/OpenAI — the incumbent is *already* a Workers AI model, reached via the free/low-cost leg of `callAi()`'s chain. The question this A/B actually answers is narrower than it looks: it's not "should we use Workers AI for text," it already does by default when Claude/OpenAI are unavailable — it's "does removing the Claude/OpenAI legs entirely from `DEFAULT_CHAIN` cost any accuracy," which this harness cannot answer, because it calls Workers AI models directly and was never wired to also grade what Claude/OpenAI return on the same fixtures. **This design extends the harness to add that missing comparison**: run the *same* fixture corpus through `callClaude()`/`callOpenAi()` (already available via `src/utils/anthropic.ts` / `src/utils/openai.ts`) using the identical prompt-building functions (`buildExtractionMessages`), and score them on the same expected-field rubric, so all of Claude, OpenAI, and every Workers AI candidate are graded on one apples-to-apples table.

### 2.2 Vision-tier A/B (new harness AND new fixtures — the deferred one)

`scripts/serve-intake-model-ab.ts` only exercises text models against `tests/fixtures/serve-intake/*.txt`. **There is no existing image fixture corpus** — `tests/fixtures/serve-intake/` contains only two synthetic `.txt` files (per `tests/fixtures/serve-intake/README.md`, which documents these as text derivatives with fabricated identities, not scans). The vision A/B this design calls for cannot reuse the text fixtures; it needs its own fixture set, built the same way the existing ones were: synthetic re-creations of the real ICU packets' *visual* hazards (watermark bleed, homoglyph-bearing fonts, two-column layout, low scan quality/skew) rendered as actual images, with fabricated identities, following the exact same policy already enforced by `tests/serveIntakeFixtures.test.ts` (denylist + content-hash ratchet) — extended to cover image files, not just text.

Concretely: create `tests/fixtures/serve-intake/images/` with 2-3 synthetic scanned-page images (e.g. rendered from the existing `.txt` fixtures' content, styled to mimic a real scan — skew, watermark, the Cyrillic-homoglyph font substitution), plus a matching `expected-vision.json` recording the fields each should extract. Add a new script, `scripts/serve-intake-vision-ab.ts`, mirroring `serve-intake-model-ab.ts`'s structure: call each candidate on each fixture image, score against `expected-vision.json`. Candidates: incumbent `@cf/meta/llama-3.2-11b-vision-instruct` (via Workers AI directly, mirroring `extractVisionWorkersAI()`), `@cf/moondream/moondream3.1-9B-A2B`, and Claude/OpenAI vision (via `callAi()` restricted to `['claude','openai']`, mirroring `extractVision()`'s exact call shape). Same ≥35/36-equivalent-style gate (rescaled to whatever total field count the smaller image fixture set has).

### 2.3 Wiring the result (per-tier, only after both A/Bs return real numbers)

This design does **not** pre-commit to an outcome — the two A/Bs above are new evidence-gathering work, not yet run. Whichever tier's Workers AI candidate clears the bar gets its `callAi()`/`extractVision()` call site changed from the default `['claude','openai','workers-ai']` (or `['claude','openai']`) chain to `['workers-ai']`-only for that tier; whichever tier doesn't clear the bar is left exactly as it is today. This is a small, mechanical edit once the A/B numbers exist — the actual code change per tier is one `providers:` array literal at each call site (`src/utils/visionExtract.ts` for vision, wherever the text tier's `callAi()` call sets its `providers:` option, or the `DEFAULT_CHAIN` itself if text-tier removal applies globally).

## 3. Non-goals

- No model is swapped without a fresh, passing A/B number on the existing fixture corpus. This design ships the *measurement tooling*, not a predetermined model choice.
- No change to the D-3 decision from the 2026-07-26 spec (no new third-party vendor) — Claude and OpenAI are being potentially *removed*, not replaced with a different external vendor.
- No change to non-OCR uses of `callAi()` elsewhere in the codebase (if any exist outside serve-intake) — scope is the serve-intake OCR pipeline only.

## 4. Testing

- Both A/B scripts are spend-real-money/neurons scripts run deliberately, not in CI — same convention as the existing `serve-intake-model-ab.ts` header warning.
- The new image fixtures (§2.2) go through the same two-guard policy as the text fixtures: a denylist test and a content-hash ratchet test, extended in `tests/serveIntakeFixtures.test.ts` to also cover the new image files. This is not optional — it is the only thing currently preventing a real client packet from landing in this public-ish repo.
- Whichever provider-chain edit ships (per §2.3) is covered by the existing test suite for that call site (`tests/`, `test-workers/`) — no new test types needed beyond what already exists for `callAi()`/`visionExtract.ts`, since this design doesn't change their function signatures, only which providers a given call site passes in.
