// Pure helpers for the Intel AI engine — prompt construction + response parsing
// for Claude-powered NL search ("ask"), entity/link extraction, and dossier
// summaries. Dependency-free → vitest without Claude or D1. The routes
// (routes/intelAi.ts) supply the live data and call callClaude.

export interface IntelHitLite {
  type: string;
  id: number;
  label: string;
  snippet?: string;
}

// ── Ask (NL search over the index) ──────────────────────────────
export const ASK_SYSTEM =
  'You are an intelligence analyst for a law-enforcement records system. Answer ONLY from the provided SOURCES. ' +
  'Cite every claim with [n] referencing the source number. If the sources do not answer the question, say so plainly. ' +
  'Be concise and factual. Never invent records, names, plates, or dates.';

export function buildAskPrompt(question: string, hits: IntelHitLite[]): string {
  const sources = hits
    .map((h, i) => `[${i + 1}] (${h.type} #${h.id}) ${h.label}${h.snippet ? ' — ' + h.snippet : ''}`)
    .join('\n');
  return `QUESTION: ${question}\n\nSOURCES:\n${sources || '(none)'}\n\nAnswer with inline [n] citations.`;
}

/** Map the [n] citations appearing in an answer back to the source hits. */
export function citationsFrom(answer: string, hits: IntelHitLite[]): IntelHitLite[] {
  const nums = new Set<number>();
  for (const m of answer.matchAll(/\[(\d+)\]/g)) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= hits.length) nums.add(n);
  }
  return [...nums].sort((a, b) => a - b).map((n) => hits[n - 1]);
}

// ── Extract (entities + links from a narrative) ─────────────────
export const EXTRACT_SYSTEM =
  'You extract structured intelligence from a narrative. Return ONLY a JSON object with keys ' +
  '"persons" (array of {name, dob?, role?}), "vehicles" (array of {plate?, description?}), ' +
  '"locations" (array of strings), and "links" (array of {from, to, relationship}). ' +
  'Use only what the text states. No commentary, no markdown — JSON only.';

export function buildExtractPrompt(text: string): string {
  return `NARRATIVE:\n${text}\n\nReturn the JSON object.`;
}

export interface ExtractResult {
  persons: any[];
  vehicles: any[];
  locations: any[];
  links: any[];
}

export function parseExtract(reply: string): ExtractResult {
  const obj = extractJson(reply) as any;
  return {
    persons: Array.isArray(obj?.persons) ? obj.persons : [],
    vehicles: Array.isArray(obj?.vehicles) ? obj.vehicles : [],
    locations: Array.isArray(obj?.locations) ? obj.locations : [],
    links: Array.isArray(obj?.links) ? obj.links : [],
  };
}

// ── Summarize (dossier) ─────────────────────────────────────────
export const SUMMARY_SYSTEM =
  'You are an intelligence analyst. Write a brief, factual dossier summary (3–6 sentences) from the provided ' +
  'record sections. Lead with anything officer-safety-relevant (active warrants, violent history, weapons). ' +
  'Only state what the records show. No speculation, no markdown.';

export function buildSummaryPrompt(label: string, sections: Record<string, any[]>): string {
  const parts: string[] = [`SUBJECT: ${label}`];
  for (const [name, rows] of Object.entries(sections || {})) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    parts.push(`\n${name.toUpperCase()} (${rows.length}):`);
    for (const r of rows.slice(0, 12)) parts.push('- ' + summarizeRow(r));
  }
  return parts.join('\n') + '\n\nWrite the dossier summary.';
}

function summarizeRow(r: any): string {
  if (r == null) return '';
  if (typeof r === 'string') return r;
  const keys = [
    'warrant_number', 'incident_number', 'call_number', 'citation_number', 'status', 'disposition',
    'incident_type', 'description', 'violation_description', 'detail', 'severity', 'created_at', 'date',
  ];
  const picked = keys.map((k) => r[k]).filter((v) => v != null && v !== '');
  return picked.length ? picked.map(String).join(' · ') : JSON.stringify(r).slice(0, 120);
}

// ── Robust JSON extraction from a model reply ───────────────────
/** Pull the first JSON object/array out of a reply (strips ``` fences + prose). */
export function extractJson(reply: string): any {
  if (!reply) return null;
  let s = reply.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.search(/[{[]/);
  if (start < 0) return null;
  s = s.slice(start);
  try {
    return JSON.parse(s);
  } catch {
    // Shrink from the end to drop trailing prose until it parses.
    for (let end = s.length; end > 0; end--) {
      const ch = s[end - 1];
      if (ch !== '}' && ch !== ']') continue;
      try {
        return JSON.parse(s.slice(0, end));
      } catch {
        /* keep shrinking */
      }
    }
    return null;
  }
}
