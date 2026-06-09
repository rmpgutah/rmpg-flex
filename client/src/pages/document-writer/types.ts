export type TemplateCategory =
  | 'incident' | 'arrest' | 'use-of-force' | 'supplemental' | 'evidence' | 'memo' | 'letter' | 'general'
  // Utah law enforcement specialty reports
  | 'le-traffic' | 'le-dv' | 'le-juvenile' | 'le-investigation' | 'le-pursuit' | 'le-property' | 'le-missing'
  // Private security
  | 'sec-post' | 'sec-dar' | 'sec-client' | 'sec-access' | 'sec-patrol'
  // HR / admin
  | 'hr-employee' | 'hr-discipline' | 'hr-training' | 'hr-leave'
  // Legal / court
  | 'legal-court' | 'legal-warrant' | 'legal-affidavit' | 'legal-discovery';

export interface DocumentTemplate {
  id: string;
  name: string;
  category: TemplateCategory;
  description: string;
  content: string; // HTML content with {{placeholder}} tokens
  fields: TemplateField[];
  /** Optional tags for search ("dv", "domestic", "victim") */
  tags?: string[];
  /** Optional Utah statute references shown as a banner */
  statutes?: string[];
}

export interface TemplateField {
  key: string;
  label: string;
  source?: 'cad' | 'user' | 'manual';
  cadPath?: string; // e.g. 'call.call_number', 'call.address'
}

export interface WriterDocument {
  id: string;
  title: string;
  content: string; // TipTap JSON
  templateId?: string;
  createdAt: string;
  updatedAt: string;
  authorId: number;
  authorName: string;
  status: 'draft' | 'final' | 'submitted';
  folderId?: number | null;
  fileId?: string | null;
  metadata: Record<string, string>;
}

export type PageSize = 'letter' | 'legal' | 'a4' | 'a3';

export interface PageSetup {
  size: PageSize;
  orientation: 'portrait' | 'landscape';
  margins: { top: number; right: number; bottom: number; left: number };
}

export const PAGE_SIZES: Record<PageSize, { width: number; height: number; css: string }> = {
  letter: { width: 816, height: 1056, css: 'letter' }, // 8.5x11 at 96dpi
  legal: { width: 816, height: 1344, css: 'legal' },
  a4: { width: 794, height: 1123, css: 'A4' },
  a3: { width: 1123, height: 1587, css: 'A3' },
};

export const DEFAULT_PAGE_SETUP: PageSetup = {
  size: 'letter',
  orientation: 'portrait',
  margins: { top: 72, right: 72, bottom: 72, left: 72 },
};

/** Editor display theme — only affects the on-screen canvas, never print/PDF. */
export type WriterTheme = 'light' | 'dark';

/** Document-level design settings (page geometry, headers/footers, watermark,
 *  columns, backgrounds, borders, line numbers). Serialized into saved HTML as a
 *  JSON comment so a document round-trips its layout, and applied both to the
 *  on-screen canvas and the print/PDF output. */
export interface DocSettings {
  page: PageSetup;
  columns: 1 | 2 | 3;
  background: string;             // page background color (editor only; print stays white)
  backgroundImage: string | null; // data-URL or remote URL
  header: { enabled: boolean; text: string; showPageNumber: boolean };
  footer: { enabled: boolean; text: string; showDate: boolean; showAuthor: boolean };
  watermark: { text: string; opacity: number };
  pageBorder: boolean;
  lineNumbers: boolean;
  widowControl: boolean; // CSS orphans/widows on every paragraph
  showRuler: boolean;    // horizontal margin-guide ruler above the page
}

export const DEFAULT_DOC_SETTINGS: DocSettings = {
  page: DEFAULT_PAGE_SETUP,
  columns: 1,
  background: '#ffffff',
  backgroundImage: null,
  header: { enabled: false, text: '', showPageNumber: true },
  footer: { enabled: false, text: '', showDate: true, showAuthor: true },
  watermark: { text: '', opacity: 0.12 },
  pageBorder: false,
  lineNumbers: false,
  widowControl: false,
  showRuler: false,
};

/** Curated font stack for the font-family selector (15 families). */
export const FONT_FAMILIES: { label: string; value: string }[] = [
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif' },
  { label: 'Impact', value: 'Impact, fantasy' },
  { label: 'Comic Sans MS', value: '"Comic Sans MS", cursive' },
  { label: 'Palatino', value: '"Palatino Linotype", Palatino, serif' },
  { label: 'Garamond', value: 'Garamond, serif' },
  { label: 'Bookman', value: '"Bookman Old Style", serif' },
  { label: 'Calibri', value: 'Calibri, sans-serif' },
  { label: 'Cambria', value: 'Cambria, serif' },
  { label: 'Consolas', value: 'Consolas, monospace' },
  { label: 'Tahoma', value: 'Tahoma, sans-serif' },
];

/** Font sizes 8–72 pt for the size selector. */
export const FONT_SIZES: number[] = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72];
