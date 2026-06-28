// Heuristic proofreader for the Document Writer.
//
// Distinct from analysis.ts' style checks (passive / long / filler — advisory,
// no fix). This finds concrete, mechanically-fixable mistakes and returns the
// exact character range + replacement so the UI can offer one-click fixes by
// mapping the plain-text offset back to a ProseMirror document position.
//
// Pure functions over the editor's plain text — no extra npm packages.

import type { Editor } from '@tiptap/react';

export type ProofKind =
  | 'repeated-word'
  | 'a-an'
  | 'double-space'
  | 'space-before-punct'
  | 'sentence-cap'
  | 'lowercase-i';

export interface ProofIssue {
  kind: ProofKind;
  /** Plain-text start offset of the flagged span. */
  start: number;
  /** Plain-text end offset (exclusive). */
  end: number;
  /** The flagged text. */
  text: string;
  /** What to replace it with on "fix". */
  fix: string;
  /** Human-readable description. */
  message: string;
}

const VOWEL_SOUND = /^[aeiou]/i;
// Common "h is silent → use an" and "u/eu sounds like 'you' → use a" exceptions.
const AN_EXCEPTIONS = /^(hour|honest|honou?r|heir)/i;
const A_EXCEPTIONS = /^(uni|use|user|usual|euro|once|one|ouija)/i;

/** Run all proofreading checks against a plain-text string. */
export function proofread(text: string): ProofIssue[] {
  const issues: ProofIssue[] = [];

  // 1. Repeated word ("the the", case-insensitive, same word twice in a row).
  for (const m of text.matchAll(/\b([A-Za-z]+)(\s+)(\1)\b/gi)) {
    const w = m[1].toLowerCase();
    if (w === 'had' || w === 'that') continue; // legitimate doubles
    const idx = m.index ?? 0;
    issues.push({
      kind: 'repeated-word', start: idx, end: idx + m[0].length,
      text: m[0], fix: m[1], message: `Repeated word "${m[1]}"`,
    });
  }

  // 2. a/an agreement before the next word.
  for (const m of text.matchAll(/\b(a|an)\s+([A-Za-z]+)/gi)) {
    const article = m[1];
    const word = m[2];
    const lowerArticle = article.toLowerCase();
    let wantsAn = VOWEL_SOUND.test(word);
    if (AN_EXCEPTIONS.test(word)) wantsAn = true;   // honest, hour…
    if (A_EXCEPTIONS.test(word)) wantsAn = false;   // university, one…
    const correctArticle = wantsAn ? 'an' : 'a';
    if (lowerArticle !== correctArticle) {
      const cased = article[0] === article[0].toUpperCase()
        ? correctArticle[0].toUpperCase() + correctArticle.slice(1)
        : correctArticle;
      const aStart = m.index ?? 0;
      issues.push({
        kind: 'a-an', start: aStart, end: aStart + article.length,
        text: article, fix: cased, message: `Use "${cased}" before "${word}"`,
      });
    }
  }

  // 3. Double (or more) spaces between words.
  for (const m of text.matchAll(/\S(  +)\S/g)) {
    const spaceStart = (m.index ?? 0) + 1;
    issues.push({
      kind: 'double-space', start: spaceStart, end: spaceStart + m[1].length,
      text: m[1], fix: ' ', message: 'Multiple spaces',
    });
  }

  // 4. Space before punctuation ("word ." → "word.").
  for (const m of text.matchAll(/\s+([,.;:!?])/g)) {
    const idx = m.index ?? 0;
    issues.push({
      kind: 'space-before-punct', start: idx, end: idx + m[0].length,
      text: m[0], fix: m[1], message: `Space before "${m[1]}"`,
    });
  }

  // 5. Sentence should start with a capital letter.
  for (const m of text.matchAll(/(^|[.!?]\s+)([a-z])/g)) {
    const letterIdx = (m.index ?? 0) + m[1].length;
    issues.push({
      kind: 'sentence-cap', start: letterIdx, end: letterIdx + 1,
      text: m[2], fix: m[2].toUpperCase(), message: 'Capitalize sentence start',
    });
  }

  // 6. Lone lowercase "i" pronoun.
  for (const m of text.matchAll(/\b(i)\b(?!['’])/g)) {
    const idx = m.index ?? 0;
    issues.push({
      kind: 'lowercase-i', start: idx, end: idx + 1,
      text: 'i', fix: 'I', message: 'Capitalize the pronoun "I"',
    });
  }

  // Sort by position so fixes/highlights read top-to-bottom.
  return issues.sort((a, b) => a.start - b.start);
}

/** Map a plain-text offset (as produced by editor.getText()) to a ProseMirror
 *  document position. TipTap joins textblocks with "\n\n" by default; we mirror
 *  that by walking the doc and accumulating text-node lengths plus separators. */
function buildOffsetMap(editor: Editor): (offset: number) => number {
  const segments: { textStart: number; textEnd: number; docStart: number }[] = [];
  let textPos = 0;
  let firstBlock = true;
  const sep = '\n\n'; // TipTap default blockSeparator
  editor.state.doc.descendants((node, pos) => {
    if (node.isTextblock) {
      if (!firstBlock) textPos += sep.length;
      firstBlock = false;
    }
    if (node.isText && node.text) {
      segments.push({ textStart: textPos, textEnd: textPos + node.text.length, docStart: pos });
      textPos += node.text.length;
    }
    return true;
  });
  return (offset: number): number => {
    for (const s of segments) {
      if (offset >= s.textStart && offset <= s.textEnd) {
        return s.docStart + (offset - s.textStart);
      }
    }
    return editor.state.doc.content.size; // fallback: end of document
  };
}

/** Apply a single proofreading fix to the editor by replacing the flagged
 *  plain-text range with the corrected text. Returns true on success. */
export function applyProofFix(editor: Editor, issue: ProofIssue): boolean {
  const toDocPos = buildOffsetMap(editor);
  const from = toDocPos(issue.start);
  const to = toDocPos(issue.end);
  if (from >= to) return false;
  // Verify the doc text at that range still matches what we flagged (guards
  // against edits that happened after the scan).
  const actual = editor.state.doc.textBetween(from, to, '');
  if (actual !== issue.text) return false;
  editor.chain().focus().insertContentAt({ from, to }, issue.fix).run();
  return true;
}

/** Select (highlight) a proofreading issue's range in the editor without
 *  changing it, so the user can see the flagged span before fixing. */
export function selectProofIssue(editor: Editor, issue: ProofIssue): void {
  const toDocPos = buildOffsetMap(editor);
  const from = toDocPos(issue.start);
  const to = toDocPos(issue.end);
  editor.chain().focus().setTextSelection({ from, to }).scrollIntoView().run();
}
