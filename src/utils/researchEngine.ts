// src/utils/researchEngine.ts
// LLM engine ladder (Claude → OpenAI → Workers AI free) + PURE parsers and the
// derived trust model. Trust is DERIVED (consensus + verification), never the
// model's raw self-reported confidence — mirrors captureTrust()/OCR-trust.
import { callAi } from './callAi';

export interface ResearchEnv { DB: D1Database; AI: Ai; }

export interface LlmOpts { system?: string; user: string; maxTokens?: number; }

/** Claude → OpenAI → Workers AI fallback chain (via callAi router). Never
 *  throws on transient/credit failure of paid tiers — Workers AI is the
 *  always-available floor. JSON responses from Workers AI may come back
 *  pre-parsed; downstream parsers run JSON.parse on strings, so the router
 *  surfaces text and we re-serialize objects defensively below. */
export async function runResearchLLM(env: ResearchEnv, opts: LlmOpts): Promise<string> {
  const { system, user, maxTokens = 2048 } = opts;
  try {
    const { text } = await callAi(env, { system, text: user, maxTokens });
    return text || '';
  } catch {
    return '';
  }
}

function clamp01(n: number): number { return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; }

/** Pure: tolerant JSON parse — strips markdown fences + leading prose. */
export function parseJsonLoose<T = any>(text: string): T | null {
  if (!text) return null;
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.search(/[[{]/);
  if (start > 0) s = s.slice(start);
  try { return JSON.parse(s) as T; } catch { return null; }
}

/** Pure: parse 3-6 angle strings from an LLM reply. */
export function parseAngles(text: string, max = 6): string[] {
  const j = parseJsonLoose<any>(text);
  let arr: any[] = [];
  if (Array.isArray(j)) arr = j;
  else if (j && Array.isArray(j.angles)) arr = j.angles;
  else arr = String(text).split('\n').map((l) => l.replace(/^[-*\d.\s]+/, '').trim());
  return dedupeCap(arr.map((x) => String(x).trim()).filter(Boolean), max);
}

/** Pure: seed angles first, then expanded; dedupe case-insensitively, cap. */
export function mergeAngles(seed: string[], expanded: string[], max = 6): string[] {
  return dedupeCap([...seed, ...expanded].map((x) => String(x).trim()).filter(Boolean), max);
}

function dedupeCap(items: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    const k = it.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
    if (out.length >= max) break;
  }
  return out;
}

export const FINDING_TYPES = ['entity', 'risk_flag', 'fact', 'relationship', 'contact', 'asset', 'timeline'] as const;
export type FindingType = typeof FINDING_TYPES[number];
export interface RawFinding { finding_type: FindingType; title: string; detail: string; confidence: number; source_urls: string[]; }

/** Pure: parse structured findings, normalizing type + clamping confidence. */
export function parseFindings(text: string): RawFinding[] {
  const j = parseJsonLoose<any>(text);
  const arr = Array.isArray(j) ? j : Array.isArray(j?.findings) ? j.findings : [];
  return arr
    .filter((f: any) => f && typeof f.title === 'string')
    .map((f: any) => ({
      finding_type: (FINDING_TYPES as readonly string[]).includes(f.finding_type) ? f.finding_type : 'fact',
      title: String(f.title).slice(0, 300),
      detail: typeof f.detail === 'string' ? f.detail : '',
      confidence: clamp01(Number(f.confidence)),
      source_urls: Array.isArray(f.source_urls) ? f.source_urls.filter((u: any) => typeof u === 'string') : [],
    }));
}

export type Verdict = 'supported' | 'uncertain' | 'refuted';

/** Pure: classify a verification reply. */
export function parseVerdict(text: string): Verdict {
  const j = parseJsonLoose<any>(text);
  const v = String(j?.verdict ?? text).toLowerCase();
  if (v.includes('refut')) return 'refuted';
  if (v.includes('support')) return 'supported';
  return 'uncertain';
}

/** Pure: DERIVED trust. Single-source claims cap at 0.85; each extra
 *  corroborating source adds (diminishing, max +0.15); uncertain ×0.6;
 *  refuted floored. */
export function deriveTrust(opts: { confidence: number; sourceCount: number; verdict: Verdict }): number {
  const { confidence, sourceCount, verdict } = opts;
  if (verdict === 'refuted') return 0.05;
  const base = Math.min(clamp01(confidence), 0.85);
  const consensus = Math.min(0.15, Math.max(0, sourceCount - 1) * 0.07);
  let t = base + consensus;
  if (verdict === 'uncertain') t *= 0.6;
  return Math.max(0.05, Math.min(1, t));
}

/** Pure: [n] per unique url in first-seen order. */
export function numberCitations(urls: string[]): Map<string, number> {
  const m = new Map<string, number>();
  let n = 1;
  for (const u of urls) if (!m.has(u)) m.set(u, n++);
  return m;
}
