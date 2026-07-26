import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const SRC_DIR = resolve(__dirname, '../..');
const css = readFileSync(resolve(SRC_DIR, 'styles/theme-palettes.css'), 'utf8');

function blueSilverBlock(): string {
  const start = css.indexOf('html.theme-blue-silver {');
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('\n}', start));
}

describe('Blue & Silver accent tokens', () => {
  const block = blueSilverBlock();

  it('defines the deepened brand gold, not legacy #d4a017', () => {
    expect(block).toContain('--accent-gold-500: #b8912f');
    expect(block).not.toContain('#d4a017');
  });

  it('defines the full gold and silver ramps with rgb triples', () => {
    for (const step of [300, 400, 500, 600, 700]) {
      expect(block).toMatch(new RegExp(`--accent-gold-${step}:`));
      expect(block).toMatch(new RegExp(`--accent-gold-${step}-rgb:`));
      expect(block).toMatch(new RegExp(`--accent-silver-${step}:`));
      expect(block).toMatch(new RegExp(`--accent-silver-${step}-rgb:`));
    }
  });

  it('keeps --brand-gold rendering silver for the ~500 existing consumers', () => {
    expect(block).toMatch(/--brand-gold:\s*var\(--accent-silver-500\)/);
  });

  it('routes both gold text roles through the AA-passing 300 step', () => {
    // 300 (#d9bd72), NOT 500 (#b8912f): 500 measures 2.88:1 on --surface-raised,
    // below WCAG AA, and raised panels are where field labels live.
    expect(block).toMatch(/--field-label-color:\s*var\(--accent-gold-300\)/);
    expect(block).toMatch(/--panel-header-color:\s*var\(--accent-gold-300\)/);
  });

  it('does not alter the warning severity hues', () => {
    expect(block).toContain('--sev-warn: #f59e0b');
    expect(block).toContain('--sev-caution: #facc15');
  });
});

describe('theme-block completeness', () => {
  const BLOCKS = [
    { name: 'night', marker: ':root,' },
    { name: 'day', marker: 'html.theme-light {' },
    { name: 'legacy-black', marker: 'html.theme-legacy-black {' },
    { name: 'blue-silver', marker: 'html.theme-blue-silver {' },
  ];

  // A var consumed as text-[color:var(--x)] silently drops the color if the
  // active theme block doesn't define it. Every role variable must exist in
  // EVERY block, or opting out of Blue & Silver strips styling.
  const ROLE_VARS = ['--field-label-color', '--panel-header-color'];

  for (const block of BLOCKS) {
    for (const roleVar of ROLE_VARS) {
      it(`${block.name} defines ${roleVar}`, () => {
        const start = css.indexOf(block.marker);
        expect(start).toBeGreaterThan(-1);
        const body = css.slice(start, css.indexOf('\n}', start));
        expect(body).toMatch(new RegExp(`${roleVar}\\s*:`));
      });
    }
  }
});

// ── Palette blocks, shared by the suites below ──────────────────────────
const PALETTE_BLOCKS = [
  { name: 'night', marker: ':root,' },
  { name: 'day', marker: 'html.theme-light {' },
  { name: 'legacy-black', marker: 'html.theme-legacy-black {' },
  { name: 'blue-silver', marker: 'html.theme-blue-silver {' },
];

function paletteBlockBody(marker: string): string {
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('\n}', start));
}

describe('rmpg bare-alias completeness', () => {
  // Tailwind consumes --rmpg-NNN-rgb via rgb(var(--x-rgb) / <alpha-value>), but
  // ~440 inline sites consume the BARE var(--rmpg-NNN). When only the triple
  // existed, every one of those declarations was invalid at computed-value time
  // and silently inherited (headings rendered pure white instead of muted).
  const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

  for (const block of PALETTE_BLOCKS) {
    it(`${block.name} defines every bare --rmpg-* alias`, () => {
      const body = paletteBlockBody(block.marker);
      for (const step of STEPS) {
        // Derived from the triple, never a literal hex -- a literal would let the
        // bare and -rgb forms drift apart silently.
        expect(body).toMatch(
          new RegExp(`--rmpg-${step}:\\s*rgb\\(var\\(--rmpg-${step}-rgb\\)\\)`),
        );
      }
    });
  }

  it('repeats the aliases per block rather than hoisting them to one rule', () => {
    // Not stylistic. Custom properties substitute var() at computed-value time on
    // the element holding the declaration, and the SUBSTITUTED result inherits.
    // A single hoisted alias would bake in the page-root theme's color, and
    // .tactical-dark -- a DESCENDANT class that re-declares these triples to force
    // night on map/MDT/dashcam -- could never override it.
    const aliasCount = (css.match(/--rmpg-500:\s*rgb\(var\(--rmpg-500-rgb\)\)/g) ?? []).length;
    expect(aliasCount).toBe(PALETTE_BLOCKS.length);
  });
});

describe('no new dead CSS variables', () => {
  // A var consumed WITHOUT a fallback and defined nowhere makes the whole
  // declaration invalid at computed-value time, so the property silently falls
  // back to the inherited value. That is the bug class that hid --rmpg-* (440
  // sites), --green-500 and --brand-200/300. This is a ratchet: the allowlist
  // below is pre-existing debt, and nothing new may be added to it.
  const KNOWN_DEAD = new Set([
    // "rt-" radio-theme tokens: 142 occurrences, defined in no stylesheet.
    '--rt-accent', '--rt-bg', '--rt-border', '--rt-muted', '--rt-panel',
    '--rt-text', '--rt-tx',
    // Raw Tailwind-ish color names that were never palette tokens. The correct
    // tokens are --sev-ok / --sev-warn / --sev-critical / --brand-*.
    '--amber-400', '--amber-500', '--amber-500-rgb', '--green-400', '--green-500',
    '--green-500-rgb', '--orange-400', '--orange-500-rgb', '--purple-400',
    '--purple-500-rgb', '--red-400', '--red-500-rgb',
    // Undefined brand ramp steps (--brand-400 alone has 19 consumers).
    '--brand-400', '--brand-500',
    // Grid tokens referenced by a table skin that never shipped its palette.
    '--grid-header-text', '--grid-row-even', '--grid-row-selected',
    '--grid-row-selected-border',
    // NOTE: '--sev-warning' was removed from this list once its sole consumer
    // (NavigationPage.tsx's crime-layer toggle) was corrected to --sev-warn. It
    // was a typo, never a real token, so it could never become *defined* — the
    // "already fixed" test below would never have evicted it. Entries whose last
    // consumer is gone have to be pulled out by hand, or the list rots exactly
    // the way that test's comment warns about.
  ]);

  // Set at runtime via element.style.setProperty(), so they never appear in CSS.
  const RUNTIME_SET = new Set([
    '--crt-scanline-alpha', '--crt-vignette-alpha', '--user-font-scale',
    '--writer-font', '--writer-line-height', '--writer-measure', '--writer-size',
  ]);

  function stripComments(text: string): string {
    // Block comments first: their CONTINUATION lines do not start with a comment
    // marker, so a purely line-based filter leaks illustrative `var(--x)` examples.
    // Only treat "//" as a comment at line start, so URLs (https://) survive.
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  }

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(full, out);
      } else if (/\.(tsx?|css)$/.test(entry.name)) {
        out.push(full);
      }
    }
    return out;
  }

  it('every var(--x) consumed without a fallback is defined somewhere', () => {
    const files = walk(SRC_DIR);
    expect(files.length).toBeGreaterThan(100);

    const defined = new Set<string>();
    for (const file of files) {
      if (!file.endsWith('.css')) continue;
      for (const m of readFileSync(file, 'utf8').matchAll(/(--[A-Za-z0-9-]+)\s*:/g)) {
        defined.add(m[1]);
      }
    }

    const offenders = new Map<string, string[]>();
    for (const file of files) {
      const text = stripComments(readFileSync(file, 'utf8'));
      for (const m of text.matchAll(/var\(\s*(--[A-Za-z0-9-]+)\s*\)/g)) {
        const name = m[1];
        if (defined.has(name) || RUNTIME_SET.has(name)) continue;
        if (name.startsWith('--tw-')) continue; // injected by Tailwind at runtime
        if (KNOWN_DEAD.has(name)) continue;
        const rel = file.slice(SRC_DIR.length + 1);
        if (!offenders.has(name)) offenders.set(name, []);
        if (!offenders.get(name)!.includes(rel)) offenders.get(name)!.push(rel);
      }
    }

    expect(
      Object.fromEntries([...offenders].map(([k, v]) => [k, v.slice(0, 5)])),
    ).toEqual({});
  });

  it('does not carry allowlist entries that are already fixed', () => {
    // Keeps the ratchet honest: once a dead var is defined, it must leave the
    // allowlist, otherwise the list rots into a permanent excuse.
    const defined = new Set<string>();
    for (const file of walk(SRC_DIR)) {
      if (!file.endsWith('.css')) continue;
      for (const m of readFileSync(file, 'utf8').matchAll(/(--[A-Za-z0-9-]+)\s*:/g)) {
        defined.add(m[1]);
      }
    }
    expect([...KNOWN_DEAD].filter((v) => defined.has(v))).toEqual([]);
  });
});

describe('the --rmpg-* ramp is never used as a text colour', () => {
  // Defining the bare aliases fixed the "renders as inherited white" bug, but it
  // also made a WRONG colour renderable. The ramp encodes SURFACE ELEVATION and
  // inverts between themes (day: low index = dark text; dark themes: low index =
  // light), so it only ever read correctly as text under the day theme. Measured
  // against --surface-raised on the default blue-silver theme:
  //
  //   --rmpg-300  3.77:1   AA-large only
  //   --rmpg-400  2.75:1   fails AA
  //   --rmpg-500  1.82:1   fails badly
  //   --rmpg-600  1.18:1   effectively invisible
  //
  // Use --text-primary / --text-secondary / --text-muted for any colour, all of
  // which are theme-stable and do not invert.
  const TEXT_CONTEXTS: Array<[string, RegExp]> = [
    ['color:', /(?<![-\w])color:\s*['"`]?var\(\s*--rmpg-\d+\s*[,)]/],
    ['.style.color =', /\.style\.color\s*=\s*['"`]var\(\s*--rmpg-\d+\s*[,)]/],
    ['WebkitTextFillColor', /WebkitTextFillColor:\s*['"`]?var\(\s*--rmpg-\d+\s*[,)]/],
    // Colour maps key by semantic ROLE, not by CSS property. These reach a
    // `color:` downstream and are invisible to a plain `color:` scan -- worse, a
    // neighbouring `border: string` type annotation makes an automated classifier
    // read them as borders. Three separate passes over this ramp missed them.
    ['text: role key', /(?<![-\w])text:\s*['"`]var\(\s*--rmpg-\d+\s*[,)]/],
  ];

  function walkSrc(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__' && entry.name !== 'node_modules') walkSrc(full, out);
      } else if (/\.(tsx?|css)$/.test(entry.name)) {
        out.push(full);
      }
    }
    return out;
  }

  // Blank comment bodies, preserving newlines so line numbers stay correct.
  // Documentation legitimately quotes the broken form as an example -- the palette
  // file's own alias comment does exactly that -- and must not trip the guard.
  // String literals are neutralised FIRST: `input.accept = 'image/*'` would
  // otherwise open a bogus block comment and swallow real code, hiding violations.
  function blankComments(src: string): string {
    const noStrings = src.replace(
      /(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g,
      (m) => m[0] + m.slice(1, -1).replace(/./g, '') + m[0],
    );
    const blanked = noStrings
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + m.slice(p.length).replace(/./g, ' '));
    return [...src].map((ch, i) => (blanked[i] === ' ' && ch !== ' ' ? ' ' : ch)).join('');
  }

  it('has no text-context var(--rmpg-N) anywhere in client/src', () => {
    const offenders: string[] = [];
    for (const file of walkSrc(SRC_DIR)) {
      const raw = readFileSync(file, 'utf8');
      blankComments(raw).split('\n').forEach((line, i) => {
        for (const [label, re] of TEXT_CONTEXTS) {
          if (re.test(line)) {
            const original = raw.split('\n')[i].trim().slice(0, 90);
            offenders.push(`${file.slice(SRC_DIR.length + 1)}:${i + 1} [${label}] ${original}`);
          }
        }
      });
    }
    expect(offenders, `Use a --text-* token instead:\n${offenders.join('\n')}`).toEqual([]);
  });
});
