import { describe, it, expect } from 'vitest';
import { stampCfAsync } from '../rocketLoaderOptout';

// Regression cover for the 2026-07-31 live outage: Cloudflare Rocket Loader
// rewrote the Vite entry script's `type="module"` to `type="<cf-hash>-module"`,
// so the browser fetched the bundle (200) but never executed it and the SPA sat
// on "INITIALIZING" forever. `data-cfasync="false"` is Cloudflare's documented
// opt-out and MUST appear before `src`.
describe('stampCfAsync', () => {
  it('stamps the module entry script and keeps type="module" intact', () => {
    const html = '<script type="module" crossorigin src="/assets/index-abc.js"></script>';
    const out = stampCfAsync(html);
    expect(out).toContain('data-cfasync="false"');
    // The whole point is that the module type SURVIVES — if a transform ever
    // mangled it we would have reproduced the bug we are preventing.
    expect(out).toContain('type="module"');
  });

  it('places the attribute BEFORE src, as Cloudflare requires', () => {
    const out = stampCfAsync('<script type="module" crossorigin src="/assets/index-abc.js"></script>');
    expect(out.indexOf('data-cfasync')).toBeLessThan(out.indexOf('src='));
  });

  it('stamps inline scripts too — the pre-paint theme resolver must not be deferred', () => {
    // Deferring the inline theme script would reintroduce the FOUC it exists to
    // prevent, so it needs the opt-out just as much as the entry bundle.
    const out = stampCfAsync('<script>document.documentElement.className="theme-blue-silver"</script>');
    expect(out).toBe('<script data-cfasync="false">document.documentElement.className="theme-blue-silver"</script>');
  });

  it('stamps every script in a multi-script document', () => {
    const html = [
      '<script>boot()</script>',
      '<script type="module" src="/assets/index-abc.js"></script>',
      '<script src="https://example.com/third-party.js"></script>',
    ].join('\n');
    const out = stampCfAsync(html);
    expect(out.match(/data-cfasync="false"/g)).toHaveLength(3);
  });

  it('is idempotent — a second pass does not double-stamp', () => {
    const once = stampCfAsync('<script type="module" src="/a.js"></script>');
    const twice = stampCfAsync(once);
    expect(twice).toBe(once);
    expect(twice.match(/data-cfasync/g)).toHaveLength(1);
  });

  it('does not touch non-script tags that merely start with the same letters', () => {
    // Guards the regex against matching <scripting> or similar; also confirms
    // link/modulepreload tags are left alone (Rocket Loader only rewrites scripts).
    const html = '<link rel="modulepreload" href="/assets/x.js"><noscript>no js</noscript>';
    expect(stampCfAsync(html)).toBe(html);
  });

  it('leaves a document with no scripts unchanged', () => {
    expect(stampCfAsync('<html><body><div id="root"></div></body></html>'))
      .toBe('<html><body><div id="root"></div></body></html>');
  });
});
