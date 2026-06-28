// Lightweight, dependency-free exporters + clipboard helpers for the Document
// Writer (features 26–30, 128–131). DOCX/RTF-with-full-fidelity need libraries
// and are out of scope; these cover Markdown, plain text, a minimal RTF, HTML,
// and clipboard format conversions. HTML is parsed with DOMParser (no innerHTML,
// no script execution) since the input is the editor's own serialized content.

/** Trigger a browser download of `content` as `filename`. */
export function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function parseBody(html: string): HTMLElement {
  return new DOMParser().parseFromString(html, 'text/html').body;
}

/** Strip all tags → plain text (feature 130). */
export function htmlToPlainText(html: string): string {
  return (parseBody(html).textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Convert the editor HTML to GitHub-flavored Markdown (features 28, 129).
 *  Handles headings, bold/italic/strike/code, links, lists, blockquotes, hr. */
export function htmlToMarkdown(html: string): string {
  const walk = (node: Node, listDepth = 0): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as HTMLElement;
    const inner = Array.from(el.childNodes).map((c) => walk(c, listDepth)).join('');
    switch (el.tagName) {
      case 'H1': return `\n# ${inner}\n`;
      case 'H2': return `\n## ${inner}\n`;
      case 'H3': return `\n### ${inner}\n`;
      case 'H4': return `\n#### ${inner}\n`;
      case 'STRONG': case 'B': return `**${inner}**`;
      case 'EM': case 'I': return `*${inner}*`;
      case 'S': case 'STRIKE': case 'DEL': return `~~${inner}~~`;
      case 'CODE': return `\`${inner}\``;
      case 'PRE': return `\n\`\`\`\n${inner}\n\`\`\`\n`;
      case 'A': return `[${inner}](${el.getAttribute('href') || ''})`;
      case 'BLOCKQUOTE': return `\n> ${inner.trim()}\n`;
      case 'HR': return `\n---\n`;
      case 'BR': return `  \n`;
      case 'P': return `\n${inner}\n`;
      case 'UL': return `\n${Array.from(el.children).map((li) => `${'  '.repeat(listDepth)}- ${walk(li, listDepth + 1).trim()}`).join('\n')}\n`;
      case 'OL': return `\n${Array.from(el.children).map((li, i) => `${'  '.repeat(listDepth)}${i + 1}. ${walk(li, listDepth + 1).trim()}`).join('\n')}\n`;
      default: return inner;
    }
  };
  return walk(parseBody(html)).replace(/\n{3,}/g, '\n\n').trim();
}

/** Minimal RTF export (feature 131). Paragraphs + bold/italic/underline only —
 *  enough for Word/Pages to open; not a full-fidelity converter. */
export function htmlToRtf(html: string): string {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/{/g, '\\{').replace(/}/g, '\\}');
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return esc(node.textContent || '');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as HTMLElement;
    const inner = Array.from(el.childNodes).map(walk).join('');
    switch (el.tagName) {
      case 'STRONG': case 'B': return `{\\b ${inner}}`;
      case 'EM': case 'I': return `{\\i ${inner}}`;
      case 'U': return `{\\ul ${inner}}`;
      case 'H1': case 'H2': case 'H3': case 'H4': return `{\\b\\fs32 ${inner}}\\par\n`;
      case 'P': case 'DIV': case 'LI': return `${inner}\\par\n`;
      case 'BR': return `\\line\n`;
      default: return inner;
    }
  };
  return `{\\rtf1\\ansi\\deff0 ${walk(parseBody(html))}}`;
}

/** Write multiple clipboard formats (plain + HTML) where supported (27, 30). */
export async function copyRich(html: string): Promise<boolean> {
  try {
    const plain = htmlToPlainText(html);
    if (navigator.clipboard && (window as any).ClipboardItem) {
      const item = new (window as any).ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      });
      await navigator.clipboard.write([item]);
      return true;
    }
    await navigator.clipboard.writeText(plain);
    return true;
  } catch { return false; }
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

// ── Clipboard history (feature 29) — last 10 copies, in-memory + localStorage ──
const CLIP_KEY = 'rmpg_writer_clip_history';
export function pushClipHistory(text: string): void {
  if (!text.trim()) return;
  const hist = listClipHistory().filter((t) => t !== text);
  hist.unshift(text);
  try { localStorage.setItem(CLIP_KEY, JSON.stringify(hist.slice(0, 10))); } catch { /* quota */ }
}
export function listClipHistory(): string[] {
  try { return JSON.parse(localStorage.getItem(CLIP_KEY) || '[]') as string[]; } catch { return []; }
}
