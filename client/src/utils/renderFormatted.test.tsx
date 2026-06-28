import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { renderFormattedText, renderInline } from './renderFormatted';

describe('renderFormattedText', () => {
  it('applies inline marks to spans', () => {
    const { container } = render(<>{renderFormattedText('**bold** and *italic* and ~~struck~~ and __under__')}</>);
    expect(container.querySelector('.font-bold')?.textContent).toBe('bold');
    expect(container.querySelector('.italic')?.textContent).toBe('italic');
    expect(container.querySelector('.line-through')?.textContent).toBe('struck');
    expect(container.querySelector('.underline')?.textContent).toBe('under');
  });

  it('renderInline returns styled runs directly (shared by the document preview)', () => {
    const nodes = renderInline('**b** plain', 'k');
    expect(Array.isArray(nodes)).toBe(true);
    const { container } = render(<>{nodes}</>);
    expect(container.querySelector('.font-bold')?.textContent).toBe('b');
    expect(container.textContent).toContain('plain');
  });

  it('renders an outline list with computed numbers', () => {
    const { container } = render(<>{renderFormattedText('1. first\n  1. nested\n- bullet')}</>);
    const text = container.textContent || '';
    expect(text).toContain('1.');     // top-level ordered marker
    expect(text).toContain('1.1.');   // nested outline number
    expect(text).toContain('•');      // bullet glyph
  });

  it('returns the raw string for empty input', () => {
    expect(renderFormattedText('')).toBe('');
  });
});
