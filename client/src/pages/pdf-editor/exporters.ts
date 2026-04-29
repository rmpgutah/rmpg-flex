// Annotation export formats — beyond the v1 JSON dump.
//
// CSV: spreadsheet-friendly for audit/discovery review.
// XFDF: Adobe-standard exchange format; pasting into Acrobat re-creates
//   annotations there too. Critical for legal handoffs.
// Markdown: human-readable summary report — every annotation as a bullet
//   grouped by page; used in case-file documentation packets.
//
// All exporters consume the editor's annotation array directly. None touch
// the proprietary writer — these are independent text outputs.

import { Annotation } from './types';

function csvEscape(v: string): string {
  if (/[,"\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function annotationSummary(a: Annotation): string {
  if (a.type === 'text') return a.text;
  if (a.type === 'sticky') return a.text;
  if (a.type === 'stamp') return String(a.label);
  if (a.type === 'link') return `${a.text} → ${a.url}`;
  if (a.type === 'redact') return '[redacted region]';
  if (a.type === 'highlight') return '[highlight]';
  if (a.type === 'cloud') return '[cloud]';
  return `[${a.type}]`;
}

export function exportAnnotationsAsCsv(annotations: Annotation[], fileName: string): string {
  const rows = [
    ['page', 'type', 'x', 'y', 'w', 'h', 'color', 'fillColor', 'opacity', 'rotation',
     'locked', 'layer', 'authorName', 'createdAt', 'status', 'note', 'summary'].join(','),
  ];
  for (const a of annotations) {
    rows.push([
      a.page, a.type,
      a.x.toFixed(2), a.y.toFixed(2), a.w.toFixed(2), a.h.toFixed(2),
      csvEscape(a.color ?? ''),
      csvEscape(a.fillColor ?? ''),
      a.opacity ?? '',
      a.rotation ?? '',
      a.locked ? 'true' : 'false',
      csvEscape(a.layer ?? ''),
      csvEscape(a.authorName ?? ''),
      csvEscape(a.createdAt ?? ''),
      csvEscape(a.status ?? ''),
      csvEscape(a.note ?? ''),
      csvEscape(annotationSummary(a)),
    ].join(','));
  }
  return rows.join('\n');
}

export function exportAnnotationsAsMarkdown(annotations: Annotation[], fileName: string, meta: { title?: string }): string {
  const lines: string[] = [];
  lines.push(`# Annotation Summary`);
  lines.push('');
  lines.push(`**Document:** ${meta.title ?? fileName}`);
  lines.push(`**Generated:** ${new Date().toLocaleString()}`);
  lines.push(`**Annotations:** ${annotations.length}`);
  lines.push('');
  const byPage = new Map<number, Annotation[]>();
  for (const a of annotations) {
    const list = byPage.get(a.page) ?? []; list.push(a); byPage.set(a.page, list);
  }
  const pages = [...byPage.keys()].sort((a, b) => a - b);
  for (const p of pages) {
    lines.push(`## Page ${p}`);
    lines.push('');
    for (const a of byPage.get(p)!) {
      const summary = annotationSummary(a);
      const meta: string[] = [];
      if (a.authorName) meta.push(`by ${a.authorName}`);
      if (a.createdAt) meta.push(new Date(a.createdAt).toLocaleString());
      if (a.status) meta.push(a.status);
      if (a.layer) meta.push(`layer: ${a.layer}`);
      const metaStr = meta.length > 0 ? ` _(${meta.join(' · ')})_` : '';
      lines.push(`- **${a.type}** — ${summary}${metaStr}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** XFDF export — Adobe XML Forms Data Format. Acrobat will re-create the
 *  annotations from this when imported. We only emit the subset of types
 *  Acrobat directly supports (text → /FreeText, highlight → /Highlight, etc.). */
export function exportAnnotationsAsXfdf(annotations: Annotation[], pageHeights: number[], renderScale = 1.5): string {
  const xmlEscape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve">');
  lines.push('  <annots>');
  for (const a of annotations) {
    const pageH = pageHeights[a.page - 1] ?? 792;
    // Convert screen-px (top-down) → PDF user-space (bottom-up)
    const px = a.x / renderScale;
    const pw = a.w / renderScale;
    const ph = a.h / renderScale;
    const py = pageH - (a.y / renderScale) - ph;
    const rect = `${px.toFixed(2)},${py.toFixed(2)},${(px + pw).toFixed(2)},${(py + ph).toFixed(2)}`;
    const common = `page="${a.page - 1}" rect="${rect}"`;
    const date = a.createdAt ? ` date="D:${a.createdAt.replace(/[-:T]/g, '').slice(0, 14)}Z"` : '';
    const author = a.authorName ? ` title="${xmlEscape(a.authorName)}"` : '';
    if (a.type === 'text') {
      const text = xmlEscape(a.text);
      lines.push(`    <freetext ${common}${date}${author}><contents>${text}</contents></freetext>`);
    } else if (a.type === 'sticky') {
      const text = xmlEscape(a.text);
      lines.push(`    <text ${common}${date}${author}><contents>${text}</contents></text>`);
    } else if (a.type === 'highlight') {
      lines.push(`    <highlight ${common}${date}${author}/>`);
    } else if (a.type === 'redact') {
      lines.push(`    <redact ${common}${date}${author}/>`);
    } else if (a.type === 'rect') {
      lines.push(`    <square ${common}${date}${author}/>`);
    } else if (a.type === 'ellipse') {
      lines.push(`    <circle ${common}${date}${author}/>`);
    } else if (a.type === 'line') {
      lines.push(`    <line ${common}${date}${author}/>`);
    } else if (a.type === 'link' && a.type === 'link') {
      const link = a as Annotation & { url: string; text: string };
      lines.push(`    <link ${common} action="${xmlEscape(link.url)}"><contents>${xmlEscape(link.text)}</contents></link>`);
    }
  }
  lines.push('  </annots>');
  lines.push('</xfdf>');
  return lines.join('\n');
}

export function downloadText(content: string, fileName: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
