// ============================================================
// centralia server-side extraction (freelawproject/centralia contract)
// ============================================================
// centralia proper is a Python geometry engine; Workers can't run it. This
// module fills the SAME typed contract (CentraliaResult) the way the dossier
// needs: unpdf pulls the opinion's text layer (worker-safe pdf.js), then the
// callAi provider chain (Claude → OpenAI → Workers AI) recovers the document
// parts — caption/cluster metadata and each writing with its author — into
// centralia's shape.
//
// Honesty rules mirrored from centralia: status is a REPORT, not a gate.
// 'review' means "read it, but confidence in placement is partial"; nothing
// is invented — every field the model didn't ground in the text stays unset,
// and diagnostics.warnings records what was uncertain so "did we lose
// anything?" stays arithmetic instead of a judgment call.
// ============================================================

import type { CentraliaResult } from './types';
import { normalizeCentraliaResult } from './centraliaModel';
import { extractPdfText } from '../warrantSources/pdfText';
import { callAi } from '../callAi';
import { parseJsonLoose } from '../researchEngine';

const MAX_TEXT_CHARS = 60_000;

export const CENTRALIA_SYSTEM = `You extract structured metadata from a court opinion's text (US appellate style).
Return ONLY a JSON object, no prose:
{"cluster":{"case_name":"","docket_number":"","citation":"","date_filed":"","date_filed_iso":"YYYY-MM-DD or null"},
 "opinions":[{"author":"","type":"majority|concurrence|dissent|in-part"}],
 "warnings":["anything uncertain, e.g. scanned pages or missing sections"]}
Rules:
- case_name: the caption's parties (e.g. "State v. Doe"). Never invent one.
- Only include opinions you can SEE in the text (author line like "Justice X delivered/special concurred/dissented").
- Omit fields you cannot find rather than guessing. Empty arrays are fine.`;

/**
 * Parse the LLM's JSON reply into a partial centralia result. Pure function;
 * exported for unit tests. Returns null for unparseable/garbage replies so the
 * caller can mark the row 'failed' instead of persisting hallucinated structure.
 */
export function parseCentraliaLlm(text: string): Partial<CentraliaResult> | null {
  const j = parseJsonLoose<any>(text);
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const clusterIn = (j.cluster && typeof j.cluster === 'object') ? j.cluster : {};
  const str = (v: unknown): string | undefined => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s && !/^(none|n\/?a|null|unknown)$/i.test(s) ? s : undefined;
  };
  const cluster: CentraliaResult['cluster'] = {
    case_name: str(clusterIn.case_name),
    docket_number: str(clusterIn.docket_number),
    citation: str(clusterIn.citation),
    date_filed: str(clusterIn.date_filed),
    date_filed_iso: str(clusterIn.date_filed_iso) ?? null,
  };
  const VALID_TYPES = new Set(['majority', 'concurrence', 'dissent', 'in-part']);
  const opinions = Array.isArray(j.opinions)
    ? j.opinions
        .map((o: any) => ({
          author: str(o?.author),
          type: VALID_TYPES.has(String(o?.type || '').toLowerCase()) ? String(o.type).toLowerCase() : undefined,
        }))
        .filter((o: { author?: string }) => !!o.author)
    : [];
  // A reading with neither cluster identity nor any writing is not a reading.
  const grounded = Object.values(cluster).some((v) => typeof v === 'string' && v) || opinions.length > 0;
  if (!grounded) return null;
  const warnings = Array.isArray(j.warnings) ? j.warnings.map((w: unknown) => String(w)).slice(0, 10) : [];
  return { cluster, opinions, warnings };
}

export interface CentraliaAiEnv {
  AI?: Ai;
  KV?: KVNamespace;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  [k: string]: unknown;
}

/**
 * Extract a court opinion PDF into the centralia contract using the text layer
 * + the callAi provider chain. Never throws — failures come back as a
 * status:'failed' result with a warning, matching centralia's own convention.
 */
export async function extractOpinionWithAi(env: CentraliaAiEnv, pdfBytes: ArrayBuffer): Promise<CentraliaResult> {
  const text = await extractPdfText(pdfBytes);
  if (!text.trim()) {
    return {
      status: 'scanned',
      court_id: '',
      cluster: {},
      opinions: [],
      warnings: ['PDF has no text layer — likely a scan; OCR pipeline required'],
    };
  }
  try {
    const { text: reply } = await callAi(env as never, {
      system: CENTRALIA_SYSTEM,
      text: text.slice(0, MAX_TEXT_CHARS),
      maxTokens: 1200,
    });
    const parsed = parseCentraliaLlm(reply);
    if (!parsed) {
      return {
        status: 'failed',
        court_id: '',
        cluster: {},
        opinions: [],
        warnings: ['extractor returned no grounded structure'],
      };
    }
    const result = normalizeCentraliaResult({
      ...parsed,
      warnings: parsed.warnings ?? [],
    } as Record<string, unknown>);
    // 'review' when only part of the document was recovered (e.g. caption but
    // no per-writing split) — mirrors centralia's honesty-about-placement rule.
    if (result.status === 'valid' && result.opinions.length === 0 && result.cluster.case_name) {
      result.status = 'review';
      result.warnings = [...(result.warnings ?? []), 'cluster recovered but individual writings were not separable'];
    }
    return result;
  } catch (err) {
    return {
      status: 'failed',
      court_id: '',
      cluster: {},
      opinions: [],
      warnings: [`extraction error: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}
