// ============================================================
// Serve Intake — shared OCR fallback chains
// ============================================================
// Split out of src/routes/serveIntake.ts (2026-07-26) so these pure
// Claude-first/Workers-AI-fallback helpers can be unit-tested under plain
// Node vitest (`tests/`). The route file imports `@cloudflare/containers`
// at module scope, which itself imports the `cloudflare:workers` runtime
// module — that import fails outside a Workers/Miniflare runtime, so any
// test that imports serveIntake.ts directly (even just for these
// container-independent functions) blows up with "Cannot find package
// 'cloudflare:workers'". None of aiBudget/withTimeout/ocrImage/ocrText
// touch containers, so hoisting them here removes that dependency for
// free — the route file re-exports/uses them unchanged.
import type { Env } from '../types';
import {
  extractFromText,
  extractFromImage,
  extractFromImageClaude,
  extractFromTextClaude,
  type ExtractionResult,
} from './serveIntakeExtract';

// Per-call ceiling on any single Workers AI invocation (per-doc text
// extraction or per-image Vision). Without this a slow/stalled model
// call hangs the whole /upload request — the original "stuck on upload"
// cause. On timeout we record the doc as failed rather than blocking.
// 35s (was 25s): real extractions land ~20-22s even after dropping the
// json_schema constraint, so 25s left only a 3-5s margin and tipped over
// under model load. Calls run in PARALLEL, so this is the per-doc ceiling
// AND roughly the whole-request ceiling — not additive across docs.
// Per-ATTEMPT ceiling. Raised from 35s on 2026-07-24: the recorded live failure
// (`Extraction failed: Text extraction timed out`) was a legitimately slow
// extraction on a large document, not a hung call, so the old ceiling was simply
// too tight.
export const AI_TIMEOUT_MS = 45_000;

// Per-attempt ceilings do NOT compose. The fallback chains below run
// SEQUENTIALLY, so their worst case is the SUM of their legs — and Cloudflare's
// edge abandons a request at ~100s with a 524, which would replace our clean
// "timed out" error with an opaque edge failure and lose the message entirely.
//
// Rather than hand-tune each leg, every chain shares one deadline: each attempt
// gets min(perLegCeiling, budgetRemaining). Per-attempt generosity can go up
// without the total ever breaching the edge cutoff.
export const TOTAL_AI_BUDGET_MS = 90_000;

/**
 * A shared deadline for one sequential fallback chain. Call the returned
 * function per attempt to get that attempt's timeout:
 *
 *   const leg = aiBudget();
 *   await withTimeout(first(),  leg(), 'first timed out');
 *   await withTimeout(second(), leg(), 'second timed out');  // gets what's left
 *
 * Once the budget is spent the next attempt times out immediately rather than
 * pushing the request past the edge cutoff.
 */
export function aiBudget(totalMs: number = TOTAL_AI_BUDGET_MS): (perLegMs?: number) => number {
  const start = Date.now();
  return (perLegMs: number = AI_TIMEOUT_MS) =>
    Math.min(perLegMs, Math.max(0, totalMs - (Date.now() - start)));
}

export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ]);
}

// Claude-first OCR with Workers-AI fallback. Claude (extractFrom*Claude) uses the
// SAME rich serve-doc prompt + parser, so the result shape is identical and the
// merge/commit code is unchanged. Returns null from the Claude leg (no key / no
// credits / error) → we transparently fall back to the free Workers-AI path.
// extraction.model carries 'claude:…' vs the Llama id so callers can label engine.
export async function ocrImage(env: Env['Bindings'], bytes: Uint8Array, mime: string): Promise<ExtractionResult> {
  const leg = aiBudget();
  const claude = await withTimeout(
    extractFromImageClaude(env, bytes, mime), leg(), 'Claude OCR timed out',
  ).catch(() => null);
  return claude ?? withTimeout(extractFromImage(env.AI, bytes), leg(), 'Vision OCR timed out');
}
// docType (see familyFromFileName / buildFamilyPrompt) reaches BOTH legs. It
// used to be passed only to the Workers-AI fallback, which meant that the
// moment anthropic_api_key was configured the Claude leg succeeded first and
// the family-prompt wiring became silently inert on the primary path — a
// capability regression triggered by setting a secret. Callers that omit
// docType still get byte-identical behavior to before this parameter existed.
export async function ocrText(env: Env['Bindings'], text: string, docType?: string): Promise<ExtractionResult> {
  const leg = aiBudget();
  const claude = await withTimeout(
    extractFromTextClaude(env, text, docType), leg(), 'Claude text timed out',
  ).catch(() => null);
  return claude ?? withTimeout(
    extractFromText(env.AI, text, env.SERVE_INTAKE_LORA, docType), leg(), 'Text extraction timed out',
  );
}
