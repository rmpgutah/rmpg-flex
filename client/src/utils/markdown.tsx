import { ReactNode } from 'react';

// Tiny inline-markdown renderer for the RichTextArea storage convention.
// Intentionally minimal — we only render the syntax our toolbar can produce,
// so we never have to sanitize user-supplied HTML beyond what we know about.
//
// Supported:
//   **bold**           → <strong>
//   *italic*           → <em>
//   <ins>x</ins>       → <u> (semantic <ins> styled as underline)
//   __x__              → <u> (alternate underline syntax — same output)
//   [text](url)        → <a href> (http/https/mailto/tel only — others stripped)
//   - item   (line)    → <ul><li>
//   1. item  (line)    → <ol><li>
//
// Everything else is rendered as plain text. Angle brackets that aren't <ins>/</ins>
// are escaped via React's default text-node behavior, so XSS surface is zero.

const SAFE_URL = /^(https?:|mailto:|tel:|\/)/i;

type Token =
  | { kind: 'text'; value: string }
  | { kind: 'bold'; children: Token[] }
  | { kind: 'italic'; children: Token[] }
  | { kind: 'underline'; children: Token[] }
  | { kind: 'link'; href: string; children: Token[] };

// Tokenize a single line of inline content. Order matters: longer markers first.
function tokenizeInline(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let buf = '';
  const flush = () => { if (buf) { tokens.push({ kind: 'text', value: buf }); buf = ''; } };

  while (i < input.length) {
    // <ins>...</ins>
    if (input.startsWith('<ins>', i)) {
      const close = input.indexOf('</ins>', i + 5);
      if (close !== -1) {
        flush();
        tokens.push({ kind: 'underline', children: tokenizeInline(input.substring(i + 5, close)) });
        i = close + 6;
        continue;
      }
    }
    // **bold**
    if (input.startsWith('**', i)) {
      const close = input.indexOf('**', i + 2);
      if (close !== -1) {
        flush();
        tokens.push({ kind: 'bold', children: tokenizeInline(input.substring(i + 2, close)) });
        i = close + 2;
        continue;
      }
    }
    // __underline__
    if (input.startsWith('__', i)) {
      const close = input.indexOf('__', i + 2);
      if (close !== -1) {
        flush();
        tokens.push({ kind: 'underline', children: tokenizeInline(input.substring(i + 2, close)) });
        i = close + 2;
        continue;
      }
    }
    // *italic* — single asterisk; require non-space immediately after to avoid
    // matching multiplication or stray asterisks.
    if (input[i] === '*' && input[i + 1] && input[i + 1] !== '*' && input[i + 1] !== ' ') {
      const close = input.indexOf('*', i + 1);
      if (close !== -1 && input[close - 1] !== ' ') {
        flush();
        tokens.push({ kind: 'italic', children: tokenizeInline(input.substring(i + 1, close)) });
        i = close + 1;
        continue;
      }
    }
    // [text](url)
    if (input[i] === '[') {
      const closeText = input.indexOf(']', i + 1);
      if (closeText !== -1 && input[closeText + 1] === '(') {
        const closeUrl = input.indexOf(')', closeText + 2);
        if (closeUrl !== -1) {
          const text = input.substring(i + 1, closeText);
          const url = input.substring(closeText + 2, closeUrl).trim();
          if (SAFE_URL.test(url)) {
            flush();
            tokens.push({ kind: 'link', href: url, children: tokenizeInline(text) });
            i = closeUrl + 1;
            continue;
          }
        }
      }
    }
    buf += input[i];
    i++;
  }
  flush();
  return tokens;
}

function renderTokens(tokens: Token[], keyPrefix: string): ReactNode[] {
  return tokens.map((t, idx) => {
    const k = `${keyPrefix}-${idx}`;
    switch (t.kind) {
      case 'text': return <span key={k}>{t.value}</span>;
      case 'bold': return <strong key={k}>{renderTokens(t.children, k)}</strong>;
      case 'italic': return <em key={k}>{renderTokens(t.children, k)}</em>;
      case 'underline': return <u key={k}>{renderTokens(t.children, k)}</u>;
      case 'link':
        return (
          <a key={k} href={t.href} target="_blank" rel="noopener noreferrer" className="text-[#d4a017] underline hover:text-[#e8b830]">
            {renderTokens(t.children, k)}
          </a>
        );
    }
  });
}

type Block =
  | { kind: 'p'; line: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] };

function blockify(input: string): Block[] {
  const lines = input.split(/\r?\n/);
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*-\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*-\s+/, ''));
        i++;
      }
      blocks.push({ kind: 'ul', items });
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ kind: 'ol', items });
      continue;
    }
    blocks.push({ kind: 'p', line });
    i++;
  }
  return blocks;
}

export function renderMarkdown(input: string | null | undefined): ReactNode {
  if (!input) return null;
  const blocks = blockify(input);
  return blocks.map((b, idx) => {
    const k = `b-${idx}`;
    if (b.kind === 'ul') {
      return (
        <ul key={k} className="list-disc list-inside ml-2 my-1">
          {b.items.map((item, i) => (
            <li key={`${k}-${i}`}>{renderTokens(tokenizeInline(item), `${k}-${i}`)}</li>
          ))}
        </ul>
      );
    }
    if (b.kind === 'ol') {
      return (
        <ol key={k} className="list-decimal list-inside ml-2 my-1">
          {b.items.map((item, i) => (
            <li key={`${k}-${i}`}>{renderTokens(tokenizeInline(item), `${k}-${i}`)}</li>
          ))}
        </ol>
      );
    }
    return (
      <div key={k} className="whitespace-pre-wrap">
        {b.line === '' ? ' ' : renderTokens(tokenizeInline(b.line), k)}
      </div>
    );
  });
}

export default function MarkdownText({ value, className }: { value: string | null | undefined; className?: string }) {
  return <div className={className}>{renderMarkdown(value)}</div>;
}
