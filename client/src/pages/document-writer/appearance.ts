// Editor appearance preferences for the Document Writer.
//
// Persisted, document-independent display settings that only affect the editing
// canvas (never the printed/PDF output, which always uses the document's own
// fonts). Drives the unused `--writer-font` / `--writer-size` CSS variables in
// writer.css plus a few extra knobs (line height, content max-width, paper
// tint). localStorage-backed so a user's preferred writing environment sticks.

export interface EditorAppearance {
  /** Base editor font family (CSS value), '' = use document default. */
  fontFamily: string;
  /** Base editor font size in pt. */
  fontSize: number;
  /** Editor line height (unitless). */
  lineHeight: number;
  /** Max content column width in px (writing measure); 0 = full page width. */
  maxWidth: number;
  /** Paper tint overlay (hex) applied over the page background; '' = none. */
  paperTint: string;
}

export const DEFAULT_APPEARANCE: EditorAppearance = {
  fontFamily: '',
  fontSize: 12,
  lineHeight: 1.5,
  maxWidth: 0,
  paperTint: '',
};

const KEY = 'rmpg_writer_appearance';

export function loadAppearance(): EditorAppearance {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_APPEARANCE };
    return { ...DEFAULT_APPEARANCE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export function saveAppearance(a: EditorAppearance): void {
  try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* storage full */ }
}

/** Apply appearance to a writer-page element via CSS variables + inline styles.
 *  Returns nothing; mutates the element. Safe to call on every change. */
export function applyAppearance(el: HTMLElement | null, a: EditorAppearance): void {
  if (!el) return;
  el.style.setProperty('--writer-font', a.fontFamily || '');
  el.style.setProperty('--writer-size', `${a.fontSize}pt`);
  el.style.setProperty('--writer-line-height', String(a.lineHeight));
  el.style.setProperty('--writer-measure', a.maxWidth > 0 ? `${a.maxWidth}px` : 'none');
}
