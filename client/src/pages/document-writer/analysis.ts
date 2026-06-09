// Document analysis + transform helpers for the Document Writer (wave 3).
// Pure functions over plain text / TipTap editor — no extra npm packages.
// Powers: readability scores, style checks (passive voice + long sentences),
// word/phrase frequency, case transforms, statute insertion, CSV→table, and a
// simple word-level document diff. Kept out of the React components so they're
// independently unit-testable.

import type { Editor } from '@tiptap/react';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── Readability (Flesch Reading Ease + Flesch-Kincaid Grade) ───────────────

/** Estimate the syllable count of a single English word (heuristic). */
export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  let trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

export interface Readability {
  words: number;
  sentences: number;
  syllables: number;
  fleschReadingEase: number;   // 0–100, higher = easier
  fleschKincaidGrade: number;  // US grade level
  ease: string;                // human label
}

/** Compute Flesch Reading Ease + Flesch-Kincaid Grade from plain text. */
export function computeReadability(text: string): Readability {
  const words = (text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || []);
  const wordCount = words.length;
  const sentences = Math.max(1, (text.match(/[.!?]+(?:\s|$)/g) || []).length);
  const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  if (wordCount === 0) {
    return { words: 0, sentences: 0, syllables: 0, fleschReadingEase: 0, fleschKincaidGrade: 0, ease: 'No text' };
  }
  const wps = wordCount / sentences;
  const spw = syllables / wordCount;
  const fre = Math.round((206.835 - 1.015 * wps - 84.6 * spw) * 10) / 10;
  const fkg = Math.round((0.39 * wps + 11.8 * spw - 15.59) * 10) / 10;
  let ease = 'Very difficult';
  if (fre >= 90) ease = 'Very easy';
  else if (fre >= 70) ease = 'Easy';
  else if (fre >= 60) ease = 'Plain English';
  else if (fre >= 50) ease = 'Fairly difficult';
  else if (fre >= 30) ease = 'Difficult';
  return {
    words: wordCount, sentences, syllables,
    fleschReadingEase: Math.max(0, Math.min(100, fre)),
    fleschKincaidGrade: Math.max(0, fkg),
    ease,
  };
}

// ── Style checks: passive voice + overly long sentences ────────────────────

export interface StyleIssue {
  kind: 'passive' | 'long' | 'weasel';
  sentence: string;
  detail: string;
}

const BE_FORMS = ['am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', "isn't", "wasn't", "aren't", "weren't"];
const WEASEL = ['very', 'really', 'quite', 'somewhat', 'fairly', 'rather', 'basically', 'actually', 'literally', 'clearly', 'obviously'];

/** Split plain text into sentences (keeps it simple — splits on . ! ?). */
export function splitSentences(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]*/g) || [])
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Heuristic passive-voice + long-sentence + weasel-word checker. */
export function runStyleChecks(text: string, longWordThreshold = 30): StyleIssue[] {
  const issues: StyleIssue[] = [];
  for (const sentence of splitSentences(text)) {
    const words = sentence.split(/\s+/).filter(Boolean);
    const lower = ' ' + sentence.toLowerCase() + ' ';
    // Passive voice: a "to be" form followed (within 2 words) by a past participle (…ed / known irregulars).
    const passiveMatch = /\b(am|is|are|was|were|be|been|being)\b\s+(\w+\s+){0,1}(\w+ed|done|made|seen|taken|given|found|known|held|told|shown|written|sent|placed|located|observed|advised|detained|arrested|cited|booked|transported)\b/i.test(sentence);
    if (passiveMatch && BE_FORMS.some((b) => lower.includes(` ${b} `))) {
      issues.push({ kind: 'passive', sentence, detail: 'Possible passive voice' });
    }
    if (words.length >= longWordThreshold) {
      issues.push({ kind: 'long', sentence, detail: `${words.length} words — consider splitting` });
    }
    const weasels = WEASEL.filter((w) => lower.includes(` ${w} `));
    if (weasels.length) {
      issues.push({ kind: 'weasel', sentence, detail: `Filler word(s): ${weasels.join(', ')}` });
    }
  }
  return issues;
}

// ── Word / phrase frequency ────────────────────────────────────────────────

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'with',
  'as', 'by', 'is', 'was', 'were', 'are', 'be', 'been', 'being', 'this', 'that',
  'these', 'those', 'it', 'its', 'i', 'he', 'she', 'they', 'we', 'you', 'his', 'her',
  'their', 'our', 'my', 'me', 'him', 'them', 'us', 'from', 'into', 'out', 'up', 'down',
  'who', 'whom', 'which', 'what', 'when', 'where', 'how', 'not', 'no', 'so', 'than',
  'then', 'there', 'here', 'had', 'has', 'have', 'do', 'did', 'does', 'will', 'would',
  'can', 'could', 'should', 'may', 'might', 'must', 'shall', 'about', 'after', 'before',
  'if', 'all', 'any', 'each', 'more', 'most', 'other', 'some', 'such', 'only', 'own',
]);

export interface WordFreq { word: string; count: number }

/** Top words (excluding stopwords) by frequency. */
export function wordFrequency(text: string, top = 25): WordFreq[] {
  const counts = new Map<string, number>();
  const words = text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [];
  for (const w of words) {
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, top);
}

/** Top 2-word phrases (bigrams) excluding ones starting/ending on a stopword. */
export function phraseFrequency(text: string, top = 15): WordFreq[] {
  const words = text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [];
  const counts = new Map<string, number>();
  for (let i = 0; i < words.length - 1; i++) {
    const a = words[i], b = words[i + 1];
    if (a.length < 3 || b.length < 3 || STOPWORDS.has(a) || STOPWORDS.has(b)) continue;
    const phrase = `${a} ${b}`;
    counts.set(phrase, (counts.get(phrase) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, c]) => c > 1)
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, top);
}

// ── Case transforms on the current selection ───────────────────────────────

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'if', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'via', 'with']);

export function toTitleCase(s: string): string {
  return s.toLowerCase().replace(/\b[\w']+\b/g, (word, idx) =>
    idx === 0 || !SMALL_WORDS.has(word) ? word.charAt(0).toUpperCase() + word.slice(1) : word,
  );
}

/** Capitalize the first letter of every sentence. */
export function toSentenceCase(s: string): string {
  return s.toLowerCase().replace(/(^\s*[a-z])|([.!?]\s+[a-z])/g, (m) => m.toUpperCase());
}

export type CaseTransform = 'upper' | 'lower' | 'title' | 'sentence';

/** Apply a case transform to the editor's current selection, in place.
 *  Returns true if any text was selected and transformed. */
export function transformSelection(editor: Editor, mode: CaseTransform): boolean {
  const { from, to } = editor.state.selection;
  if (from === to) return false;
  const text = editor.state.doc.textBetween(from, to, ' ');
  if (!text.trim()) return false;
  let out = text;
  if (mode === 'upper') out = text.toUpperCase();
  else if (mode === 'lower') out = text.toLowerCase();
  else if (mode === 'title') out = toTitleCase(text);
  else out = toSentenceCase(text);
  if (out === text) return true;
  editor.chain().focus().insertContentAt({ from, to }, esc(out)).run();
  return true;
}

// ── Statute reference insertion ────────────────────────────────────────────

/** Insert a formatted Utah Code citation at the cursor (feature 12). */
export function insertStatuteReference(editor: Editor, section: string, label?: string): void {
  const clean = section.trim().replace(/^(utah\s+code\s*)?§?\s*/i, '');
  const cite = `Utah Code § ${clean}`;
  const text = label ? `${cite} (${label})` : cite;
  editor.chain().focus().insertContent(
    `<span data-statute-ref="${esc(clean)}" style="font-variant:small-caps;white-space:nowrap;">${esc(text)}</span>`,
  ).run();
}

// ── CSV → TipTap table ─────────────────────────────────────────────────────

/** Parse a single line of CSV honouring double-quoted fields with embedded commas. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Parse CSV (auto-detecting comma vs tab delimiter) into a 2-D array. */
export function parseCsv(input: string): string[][] {
  const lines = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];
  // Tab-delimited paste from a spreadsheet is common — prefer tabs if present.
  const isTab = lines[0].includes('\t');
  return lines.map((l) => (isTab ? l.split('\t') : parseCsvLine(l)).map((c) => c.trim()));
}

/** Build a TipTap-compatible table HTML string from parsed CSV rows. The first
 *  row becomes a header row when `headerRow` is true. */
export function csvToTableHtml(rows: string[][], headerRow = true): string {
  if (rows.length === 0) return '';
  const cols = Math.max(...rows.map((r) => r.length));
  const cell = (v: string, header: boolean) => {
    const tag = header ? 'th' : 'td';
    const style = header
      ? 'border:1px solid #333;padding:6px;text-align:left;background:#1a1a1a;'
      : 'border:1px solid #333;padding:6px;';
    return `<${tag} style="${style}">${esc(v || '')}&nbsp;</${tag}>`;
  };
  const body = rows.map((r, ri) => {
    const isHeader = headerRow && ri === 0;
    const cells = Array.from({ length: cols }, (_, ci) => cell(r[ci] ?? '', isHeader)).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  return `<table style="width:100%;border-collapse:collapse;margin:8px 0;">${body}</table>`;
}

/** Insert a table parsed from CSV/TSV text at the cursor. Returns rows × cols, or
 *  null if nothing parseable. */
export function insertCsvTable(editor: Editor, csv: string, headerRow = true): { rows: number; cols: number } | null {
  const rows = parseCsv(csv);
  if (rows.length === 0) return null;
  const html = csvToTableHtml(rows, headerRow);
  editor.chain().focus().insertContent(html).run();
  return { rows: rows.length, cols: Math.max(...rows.map((r) => r.length)) };
}

// ── Word-level document diff ───────────────────────────────────────────────

export type DiffOp = { type: 'eq' | 'add' | 'del'; text: string };

/** Word-level LCS diff between two plain-text strings. Returns a sequence of
 *  equal/added/deleted runs, suitable for inline highlight rendering. */
export function diffWords(oldText: string, newText: string): DiffOp[] {
  const tokenize = (s: string) => s.match(/\S+|\s+/g) || [];
  const a = tokenize(oldText);
  const b = tokenize(newText);
  const n = a.length, m = b.length;
  // LCS table (O(n*m) — fine for report-length documents).
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0, j = 0;
  const push = (type: DiffOp['type'], text: string) => {
    const last = ops[ops.length - 1];
    if (last && last.type === type) last.text += text;
    else ops.push({ type, text });
  };
  while (i < n && j < m) {
    if (a[i] === b[j]) { push('eq', a[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push('del', a[i]); i++; }
    else { push('add', b[j]); j++; }
  }
  while (i < n) { push('del', a[i]); i++; }
  while (j < m) { push('add', b[j]); j++; }
  return ops;
}

export interface DiffSummary { added: number; removed: number; unchanged: number }

/** Count added / removed / unchanged words in a diff. */
export function summarizeDiff(ops: DiffOp[]): DiffSummary {
  const count = (t: DiffOp['type']) =>
    ops.filter((o) => o.type === t).reduce((s, o) => s + (o.text.match(/\S+/g) || []).length, 0);
  return { added: count('add'), removed: count('del'), unchanged: count('eq') };
}

// ── Page-count / print estimate ────────────────────────────────────────────

export interface PrintEstimate { pages: number; words: number; lines: number }

/** Estimate printed page count from word count + heading/table density.
 *  Roughly 500 words/page for a typed report; nudged up by tables/images. */
export function estimatePages(editor: Editor): PrintEstimate {
  const text = editor.state.doc.textContent;
  const words = (text.trim().match(/\S+/g) || []).length;
  let blockUnits = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'table') blockUnits += 6;       // a table ≈ a third of a page
    if (node.type.name === 'image') blockUnits += 8;
    if (node.type.name === 'heading') blockUnits += 1;
    if (node.type.name === 'pageBreak') blockUnits += 18;  // forces a new page
  });
  const lines = Math.ceil(words / 12) + blockUnits;
  const pages = Math.max(1, Math.ceil((words + blockUnits * 80) / 500));
  return { pages, words, lines };
}
