import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

// Convert markdown to safe HTML wrapped in a full document.
// Safe: rejects javascript:, vbscript:, and data: schemes on links.
export function renderEmailMarkdown(src: string): string {
  const raw = marked.parse(src, { async: false, breaks: true, gfm: true }) as string;
  const clean = sanitizeHtml(raw, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https', 'cid'] },
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      '*': ['style'],
    },
    transformTags: {
      a: (tag, attribs) => ({
        tagName: 'a',
        attribs: { ...attribs, rel: 'noopener noreferrer', target: '_blank' },
      }),
    },
  });
  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8"></head>',
    '<body style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1a1a1a;">',
    clean,
    '</body></html>',
  ].join('');
}
