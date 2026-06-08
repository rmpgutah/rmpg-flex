export interface DocumentTemplate {
  id: string;
  name: string;
  category: 'incident' | 'arrest' | 'use-of-force' | 'supplemental' | 'evidence' | 'memo' | 'letter' | 'general';
  description: string;
  content: string; // HTML content with {{placeholder}} tokens
  fields: TemplateField[];
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

export interface PageSetup {
  size: 'letter' | 'legal' | 'a4';
  orientation: 'portrait' | 'landscape';
  margins: { top: number; right: number; bottom: number; left: number };
}

export const PAGE_SIZES: Record<string, { width: number; height: number }> = {
  letter: { width: 816, height: 1056 }, // 8.5x11 at 96dpi
  legal: { width: 816, height: 1344 },
  a4: { width: 794, height: 1123 },
};

export const DEFAULT_PAGE_SETUP: PageSetup = {
  size: 'letter',
  orientation: 'portrait',
  margins: { top: 72, right: 72, bottom: 72, left: 72 },
};
