// Regression guard for the signature-block page-overflow bug.
//
// Signature blocks render a fixed run of underscores as the "line" (the editor
// schema strips border-bottom, so the line must be literal characters). Those
// underscores cannot wrap, so under the default `table-layout: auto` a 3- or
// 4-cell signature row demands more width than the printable page and the table
// overflows the right margin in every PDF/print/export path. The fix is
// `table-layout: fixed` (+ cell `overflow: hidden`) so columns divide the page
// width evenly and the unbreakable line is clipped to its cell instead of
// pushing the table off-page.
import { describe, it, expect } from 'vitest';
import { buildStandaloneHtml } from '../docTools';
import { SIG_BLOCK, DUAL_SIG_BLOCK, sigRow } from '../templates/_shared';

describe('signature block layout', () => {
  it('exported HTML pins table-layout:fixed so signature rows cannot overflow the page', () => {
    const html = buildStandaloneHtml({ title: 'T', bodyHtml: SIG_BLOCK });
    const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>')).replace(/\s+/g, '');
    expect(css).toContain('table-layout:fixed');
  });

  it('exported cells clip overflow so the underscore line stays inside its column', () => {
    const html = buildStandaloneHtml({ title: 'T', bodyHtml: SIG_BLOCK });
    const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>')).replace(/\s+/g, '');
    expect(css).toMatch(/(td|th)[^}]*overflow:hidden/);
  });

  it('signature rows are real tables whose column count drives the per-cell width', () => {
    // 3-cell (SIG_BLOCK) and 4-cell (DUAL_SIG_BLOCK) rows are the worst cases —
    // with fixed layout each is 1/N of the page, so neither can overflow.
    expect((SIG_BLOCK.match(/<td>/g) || []).length).toBe(3);
    expect((DUAL_SIG_BLOCK.match(/<td>/g) || []).length).toBe(4);
    expect(sigRow(['A', 'B']).startsWith('<table>')).toBe(true);
  });
});
