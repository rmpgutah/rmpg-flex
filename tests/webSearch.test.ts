import { describe, it, expect } from 'vitest';
import { parseDdgHtml, htmlToText, isFetchableUrl, wantsWeb } from '../src/utils/webSearch';

describe('webSearch pure helpers', () => {
  it('parseDdgHtml unwraps uddg redirects, decodes entities, skips ads and dupes', () => {
    const html = `
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Flegacy.utcourts.gov%2Frules%2Fview.php%3Ftype%3Durcp%26rule%3D4&amp;rut=abc">URCP Rule 4 &amp; Process</a>
      <a class="result__snippet" href="#">Time limit for service &#39;120 days&#39;</a>
      <a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Sponsored</a>
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Flegacy.utcourts.gov%2Frules%2Fview.php%3Ftype%3Durcp%26rule%3D4">dupe</a>
      <a class="result__a" href="http://127.0.0.1/admin">private</a>
      <a class="result__a" href="https://rulesofcivilprocedure.com/ut/rule-4/">Utah R. Civ. P. 4</a>`;
    const hits = parseDdgHtml(html, 10);
    expect(hits.map((h) => h.url)).toEqual([
      'https://legacy.utcourts.gov/rules/view.php?type=urcp&rule=4',
      'https://rulesofcivilprocedure.com/ut/rule-4/',
    ]);
    expect(hits[0].title).toBe('URCP Rule 4 & Process');
    expect(hits[0].snippet).toBe("Time limit for service '120 days'");
  });

  it('parseDdgHtml honours the limit', () => {
    const html = Array.from({ length: 6 }, (_, i) => `<a class="result__a" href="https://example.org/${i}">t${i}</a>`).join('');
    expect(parseDdgHtml(html, 3)).toHaveLength(3);
  });

  it('htmlToText drops chrome and keeps structure', () => {
    const html = `<html><head><style>.x{}</style><script>alert(1)</script></head>
      <body><nav>Menu</nav><h1>Rule 4</h1><p>Serve within <b>120</b> days.</p>
      <ul><li>one</li><li>two</li></ul><table><tr><td>a</td><td>b</td></tr></table><footer>foot</footer></body></html>`;
    const t = htmlToText(html);
    expect(t).toContain('## Rule 4');
    expect(t).toContain('Serve within 120 days.');
    expect(t).toContain('one\ntwo');
    expect(t).toContain('a | b |');
    expect(t).not.toContain('Menu');
    expect(t).not.toContain('alert');
    expect(t).not.toContain('foot');
  });

  it('isFetchableUrl blocks non-http and private hosts', () => {
    expect(isFetchableUrl('https://utcourts.gov/x')).toBe(true);
    expect(isFetchableUrl('http://10.0.0.5/')).toBe(false);
    expect(isFetchableUrl('http://192.168.1.1/')).toBe(false);
    expect(isFetchableUrl('http://172.20.0.1/')).toBe(false);
    expect(isFetchableUrl('http://169.254.169.254/latest')).toBe(false);
    expect(isFetchableUrl('http://localhost:8787/')).toBe(false);
    expect(isFetchableUrl('ftp://example.com/')).toBe(false);
    expect(isFetchableUrl('not a url')).toBe(false);
  });

  it('wantsWeb separates internal SOP questions from external ones', () => {
    expect(wantsWeb('How do I escape Flex Kiosk Mode?')).toBe(false);
    expect(wantsWeb('Who can authorize a redaction of dashcam evidence?')).toBe(false);
    expect(wantsWeb('What does Utah Rule of Civil Procedure 4 say about the time limit for service?')).toBe(true);
    expect(wantsWeb('What is the current filing fee at Salt Lake County Justice Court?')).toBe(true);
    expect(wantsWeb('latest news on Utah HB 2026 process server licensing')).toBe(true);
  });
});
