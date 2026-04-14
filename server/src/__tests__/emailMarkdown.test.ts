import { describe, it, expect } from 'vitest';
import { renderEmailMarkdown } from '../utils/emailMarkdown';

describe('renderEmailMarkdown', () => {
  it('wraps in a full HTML document', () => {
    const out = renderEmailMarkdown('hello');
    expect(out).toMatch(/^<!DOCTYPE html>/);
    expect(out).toContain('<body');
  });

  it('renders bold and italic', () => {
    const out = renderEmailMarkdown('**bold** *italic*');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>italic</em>');
  });

  it('preserves safe http/https/mailto links', () => {
    expect(renderEmailMarkdown('[x](https://example.com)')).toContain('href="https://example.com"');
    expect(renderEmailMarkdown('[x](mailto:a@b.c)')).toContain('href="mailto:a@b.c"');
  });

  it('strips javascript: URLs', () => {
    const out = renderEmailMarkdown('[click](javascript:alert(1))');
    expect(out).not.toContain('javascript:');
  });

  it('strips data: URLs', () => {
    const out = renderEmailMarkdown('[click](data:text/html,<script>)');
    expect(out).not.toContain('data:text/html');
  });

  it('strips inline script tags from raw html', () => {
    const out = renderEmailMarkdown('hi <script>alert(1)</script>');
    expect(out).not.toContain('<script');
  });

  it('escapes ampersands and angle brackets in plain text', () => {
    const out = renderEmailMarkdown('a & b <c>');
    expect(out).toContain('a &amp; b');
  });

  it('preserves newlines via breaks', () => {
    const out = renderEmailMarkdown('line1\nline2');
    expect(out.toLowerCase()).toContain('<br');
  });
});
