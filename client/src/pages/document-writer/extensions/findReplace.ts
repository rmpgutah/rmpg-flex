// Find & Replace for TipTap — a ProseMirror plugin that scans the doc's text,
// highlights every match with decorations, tracks a "current" match, and exposes
// commands for next/prev/replace/replaceAll. Supports case-sensitivity, whole-
// word, regex, and find-in-selection. No external dependencies.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  inSelection: boolean;
}

export interface SearchMatch { from: number; to: number }

interface SearchState {
  term: string;
  options: SearchOptions;
  matches: SearchMatch[];
  current: number; // index into matches, -1 when none
}

export const findReplaceKey = new PluginKey<SearchState>('findReplace');

const DEFAULTS: SearchOptions = { caseSensitive: false, wholeWord: false, regex: false, inSelection: false };

function buildRegex(term: string, opts: SearchOptions): RegExp | null {
  if (!term) return null;
  try {
    let source = opts.regex ? term : term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (opts.wholeWord) source = `\\b${source}\\b`;
    return new RegExp(source, opts.caseSensitive ? 'g' : 'gi');
  } catch {
    return null; // invalid regex — treat as no matches
  }
}

/** Walk the doc collecting absolute positions of every regex match in text. */
function findMatches(doc: any, term: string, opts: SearchOptions, selFrom?: number, selTo?: number): SearchMatch[] {
  const re = buildRegex(term, opts);
  if (!re) return [];
  const matches: SearchMatch[] = [];
  doc.descendants((node: any, pos: number) => {
    if (!node.isText || !node.text) return;
    const start = pos;
    for (const m of (node.text as string).matchAll(re)) {
      const matched = m[0];
      if (!matched.length || m.index == null) continue;
      const from = start + m.index;
      const to = from + matched.length;
      if (opts.inSelection && selFrom != null && selTo != null && (from < selFrom || to > selTo)) continue;
      matches.push({ from, to });
    }
  });
  return matches;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    findReplace: {
      setSearchTerm: (term: string, options?: Partial<SearchOptions>) => ReturnType;
      clearSearch: () => ReturnType;
      findNext: () => ReturnType;
      findPrevious: () => ReturnType;
      replaceCurrent: (replacement: string) => ReturnType;
      replaceAll: (replacement: string) => ReturnType;
    };
  }
}

export const FindReplace = Extension.create({
  name: 'findReplace',

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: findReplaceKey,
        state: {
          init: (): SearchState => ({ term: '', options: { ...DEFAULTS }, matches: [], current: -1 }),
          apply(tr, value): SearchState {
            const meta = tr.getMeta(findReplaceKey) as Partial<SearchState> | undefined;
            let next = value;
            if (meta) next = { ...value, ...meta };
            // Recompute match positions if the doc changed (keep current index).
            if (tr.docChanged && next.term) {
              const sel = next.options.inSelection ? tr.selection : null;
              next = { ...next, matches: findMatches(tr.doc, next.term, next.options, sel?.from, sel?.to) };
            }
            return next;
          },
        },
        props: {
          decorations(state) {
            const s = findReplaceKey.getState(state);
            if (!s || !s.matches.length) return DecorationSet.empty;
            const decos = s.matches.map((mt, i) =>
              Decoration.inline(mt.from, mt.to, {
                class: i === s.current ? 'search-match search-current' : 'search-match',
              }),
            );
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      setSearchTerm:
        (term, options) =>
        ({ state, dispatch }) => {
          const cur = findReplaceKey.getState(state)!;
          const opts = { ...cur.options, ...options };
          const sel = opts.inSelection ? state.selection : null;
          const matches = findMatches(state.doc, term, opts, sel?.from, sel?.to);
          if (dispatch) {
            dispatch(state.tr.setMeta(findReplaceKey, { term, options: opts, matches, current: matches.length ? 0 : -1 }));
          }
          return true;
        },
      clearSearch:
        () =>
        ({ state, dispatch }) => {
          if (dispatch) dispatch(state.tr.setMeta(findReplaceKey, { term: '', matches: [], current: -1 }));
          return true;
        },
      findNext:
        () =>
        ({ state, dispatch, view }) => {
          const s = findReplaceKey.getState(state)!;
          if (!s.matches.length) return false;
          const next = (s.current + 1) % s.matches.length;
          if (dispatch) dispatch(state.tr.setMeta(findReplaceKey, { current: next }));
          if (view) scrollToMatch(view, s.matches[next]);
          return true;
        },
      findPrevious:
        () =>
        ({ state, dispatch, view }) => {
          const s = findReplaceKey.getState(state)!;
          if (!s.matches.length) return false;
          const prev = (s.current - 1 + s.matches.length) % s.matches.length;
          if (dispatch) dispatch(state.tr.setMeta(findReplaceKey, { current: prev }));
          if (view) scrollToMatch(view, s.matches[prev]);
          return true;
        },
      replaceCurrent:
        (replacement) =>
        ({ state, dispatch }) => {
          const s = findReplaceKey.getState(state)!;
          if (s.current < 0 || !s.matches[s.current]) return false;
          const m = s.matches[s.current];
          if (dispatch) {
            const tr = state.tr.insertText(replacement, m.from, m.to);
            tr.setMeta(findReplaceKey, {
              matches: findMatches(tr.doc, s.term, s.options),
              current: Math.max(0, s.current),
            });
            dispatch(tr);
          }
          return true;
        },
      replaceAll:
        (replacement) =>
        ({ state, dispatch }) => {
          const s = findReplaceKey.getState(state)!;
          if (!s.matches.length) return false;
          if (dispatch) {
            const tr = state.tr;
            // Replace from the end backwards so earlier positions stay valid.
            for (let i = s.matches.length - 1; i >= 0; i--) {
              const m = s.matches[i];
              tr.insertText(replacement, m.from, m.to);
            }
            tr.setMeta(findReplaceKey, { matches: [], current: -1 });
            dispatch(tr);
          }
          return true;
        },
    };
  },
});

function scrollToMatch(view: any, m: SearchMatch) {
  try {
    const dom = view.domAtPos(m.from);
    const node = dom?.node as HTMLElement | undefined;
    (node?.nodeType === 1 ? node : node?.parentElement)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  } catch { /* off-screen */ }
}

export default FindReplace;
