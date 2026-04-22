import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

// Convert markdown to safe HTML wrapped in a full document.
// Security notes:
//   - allowedSchemes restricts <a href> to http/https/mailto — blocks javascript:,
//     vbscript:, data:, file:, blob:, etc.
//   - allowedSchemesByTag adds 'cid:' for <img> only (inline email attachments).
//   - transformTags.a adds rel="noopener noreferrer" target="_blank" to close the
//     tabnabbing hole.
//   - <script>, <style>, <iframe>, <svg>, and event handlers (onerror, onclick,
//     …) are rejected because they are not in sanitize-html's default allowedTags.
//   - `style` attribute is NOT allowed — CSS-based XSS (url('javascript:…') in
//     background-image, etc.) is prevented by dropping it entirely. Markdown does
//     not emit style attributes.
export function renderEmailMarkdown(src: string): string {
  const safeSrc = src == null ? '' : String(src);
  const raw = marked.parse(safeSrc, { async: false, breaks: true, gfm: true }) as string;
  const clean = sanitizeHtml(raw, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https', 'cid'] },
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height'],
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
