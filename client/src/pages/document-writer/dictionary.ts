// Custom spell-check / proofreading dictionary for the Document Writer.
//
// A user-maintained "ignore list" of words the proofreader should never flag
// (officer surnames, agency-specific jargon, abbreviations, callsigns, etc.).
// Stored in localStorage under the SAME key the command-palette spell helpers
// use (`rmpg_writer_spell_ignore`) so the two surfaces stay in sync — this
// module just adds a managed UI + proofreader integration on top.
//
// Pure helpers; no React, no npm deps. Words are matched case-insensitively.

import type { ProofIssue } from './proofread';

const DICT_KEY = 'rmpg_writer_spell_ignore';

/** All words in the ignore list (original casing preserved, newest last). */
export function listDictionary(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(DICT_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((w): w is string => typeof w === 'string') : [];
  } catch {
    return [];
  }
}

/** Lower-cased Set for fast membership checks. */
export function dictionarySet(): Set<string> {
  return new Set(listDictionary().map((w) => w.toLowerCase()));
}

/** True if a word (any casing) is in the ignore list. */
export function isIgnored(word: string): boolean {
  return dictionarySet().has(word.trim().toLowerCase());
}

/** Add one or more words (comma / whitespace separated). Returns the new count
 *  of distinct words actually added. */
export function addToDictionary(input: string): number {
  const incoming = input
    .split(/[\s,]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}'\-]/gu, '').trim())
    .filter(Boolean);
  if (incoming.length === 0) return 0;
  const existing = listDictionary();
  const seen = new Set(existing.map((w) => w.toLowerCase()));
  let added = 0;
  for (const w of incoming) {
    if (!seen.has(w.toLowerCase())) {
      existing.push(w);
      seen.add(w.toLowerCase());
      added++;
    }
  }
  if (added > 0) {
    try { localStorage.setItem(DICT_KEY, JSON.stringify(existing)); } catch { /* quota */ }
  }
  return added;
}

/** Remove a single word (case-insensitive). */
export function removeFromDictionary(word: string): void {
  const next = listDictionary().filter((w) => w.toLowerCase() !== word.toLowerCase());
  try { localStorage.setItem(DICT_KEY, JSON.stringify(next)); } catch { /* noop */ }
}

/** Clear the whole dictionary. */
export function clearDictionary(): void {
  try { localStorage.removeItem(DICT_KEY); } catch { /* noop */ }
}

/** Drop any proofreading issues whose flagged word is in the ignore list. Used
 *  by the proofreader panel so officer names / jargon stop getting flagged for
 *  capitalization, a/an, repeated-word, etc. */
export function filterIgnoredIssues(issues: ProofIssue[]): ProofIssue[] {
  const dict = dictionarySet();
  if (dict.size === 0) return issues;
  return issues.filter((iss) => {
    // Compare the core flagged token (strip surrounding punctuation/space).
    const token = iss.text.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase();
    if (token && dict.has(token)) return false;
    // For repeated-word / a-an the meaningful word is in `fix`; also check it.
    const fixTok = iss.fix.trim().toLowerCase();
    if (fixTok && dict.has(fixTok)) return false;
    return true;
  });
}
