// Per-heading section word counts for the Document Writer.
//
// Walks the document, segmenting it by headings (h1–h4): each heading starts a
// new section that runs until the next heading of the same-or-higher level.
// Produces a flat list of sections with their word counts + optional per-section
// word goals (persisted in localStorage, keyed by heading text). Lets a writer
// see how long each part of a report is and target a length per section.

import type { Editor } from '@tiptap/react';

export interface SectionStat {
  level: number;
  title: string;
  words: number;
  /** ProseMirror position of the heading (for click-to-scroll). */
  pos: number;
  /** Optional word goal for this section (by title). */
  goal: number;
  /** Percent of goal (0 if no goal). */
  pct: number;
}

const GOAL_KEY = 'rmpg_writer_section_goals';

function loadGoals(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(GOAL_KEY) || '{}'); } catch { return {}; }
}
function saveGoals(g: Record<string, number>): void {
  try { localStorage.setItem(GOAL_KEY, JSON.stringify(g)); } catch { /* noop */ }
}

/** Set (or clear with 0) a section's word goal, keyed by heading text. */
export function setSectionGoal(title: string, goal: number): void {
  const g = loadGoals();
  if (goal > 0) g[title] = goal; else delete g[title];
  saveGoals(g);
}

const countWords = (s: string) => (s.trim().match(/\S+/g) || []).length;

/** Compute word counts per heading-delimited section. Content before the first
 *  heading is reported under a "(Preamble)" pseudo-section when non-empty. */
export function computeSectionStats(editor: Editor): SectionStat[] {
  const goals = loadGoals();
  const sections: SectionStat[] = [];
  let preambleWords = 0;
  let current: SectionStat | null = null;

  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const title = node.textContent.trim() || `(Untitled ${node.attrs.level === 1 ? 'H1' : 'heading'})`;
      const goal = goals[title] || 0;
      current = { level: node.attrs.level as number, title, words: 0, pos, goal, pct: 0 };
      sections.push(current);
      return false; // don't double-count heading text as body words
    }
    if (node.isTextblock) {
      const w = countWords(node.textContent);
      if (current) current.words += w;
      else preambleWords += w;
      return false;
    }
    return true;
  });

  for (const s of sections) {
    s.pct = s.goal > 0 ? Math.min(100, Math.round((s.words / s.goal) * 100)) : 0;
  }

  if (preambleWords > 0) {
    sections.unshift({ level: 0, title: '(Preamble)', words: preambleWords, pos: 0, goal: 0, pct: 0 });
  }
  return sections;
}
