import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const SRC_DIR = resolve(__dirname, '../..');
const css = readFileSync(resolve(SRC_DIR, 'styles/theme-palettes.css'), 'utf8');

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

/** Custom properties declared anywhere in a chunk of CSS text. */
function declaredIn(text: string): Set<string> {
  const names = new Set<string>();
  for (const m of text.matchAll(/(--[A-Za-z0-9-]+)\s*:/g)) names.add(m[1]);
  return names;
}

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
  // Explicitly Set<string>: with the list empty, an inferred Set<never> makes the
  // .has(name) calls below a type error.
  const KNOWN_DEAD = new Set<string>([
    // EMPTY as of 2026-07-26 — the debt this list tracked is paid off:
    //   - '--rt-*' (7 names, 161 occurrences): the radio console rendered
    //     entirely inherited colors. Now declared in all four palette blocks as
    //     role aliases (bg/panel/border/text/muted/accent/tx).
    //   - Raw Tailwind-ish names ('--red-500', '--amber-400', ...): never palette
    //     tokens. Their 27 call sites were re-pointed to the --sev-* equivalents
    //     rather than legitimising a parallel naming scheme.
    //   - '--grid-header-text' / '--grid-row-even' / '--grid-row-selected(-border)':
    //     half of the grid family was already declared in all four blocks; the
    //     missing four are now declared alongside their siblings.
    //   - '--sev-warning' was a typo, evicted when #3028 fixed its sole consumer.
    // Keep it empty. An entry here is a promise to a future reader that the site
    // is knowingly broken, so adding one needs a reason in the same commit.
    // NOTE: '--sev-warning' was removed from this list once its sole consumer
    // (NavigationPage.tsx's crime-layer toggle) was corrected to --sev-warn. It
    // was a typo, never a real token, so it could never become *defined* — the
    // "already fixed" test below could not have evicted it on the defined-ness
    // check alone. That test now ALSO fails when an entry loses its last
    // consumer, so this class of rot is caught mechanically rather than needing
    // to be pulled out by hand.
  ]);

  // Set at runtime via element.style.setProperty(), so they never appear in CSS.
  const RUNTIME_SET = new Set([
    '--crt-scanline-alpha', '--crt-vignette-alpha', '--user-font-scale',
    '--writer-font', '--writer-line-height', '--writer-measure', '--writer-size',
  ]);

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
    // Keeps the ratchet honest in BOTH directions -- a dead var leaves the debt
    // list either by being defined or by losing its last consumer, and an entry
    // that outlives its reason rots into a permanent excuse. --sev-warning was
    // exactly the second case: a typo for --sev-warn with one consumer, so fixing
    // the call site leaves nothing for the allowlist to excuse.
    const files = walk(SRC_DIR);

    const defined = new Set<string>();
    for (const file of files) {
      if (!file.endsWith('.css')) continue;
      for (const name of declaredIn(readFileSync(file, 'utf8'))) defined.add(name);
    }

    const referenced = new Set<string>();
    for (const file of files) {
      const text = stripComments(readFileSync(file, 'utf8'));
      for (const m of text.matchAll(/var\(\s*(--[A-Za-z0-9-]+)\s*\)/g)) referenced.add(m[1]);
    }

    expect({
      nowDefined: [...KNOWN_DEAD].filter((v) => defined.has(v)),
      noLongerReferenced: [...KNOWN_DEAD].filter((v) => !referenced.has(v)),
    }).toEqual({ nowDefined: [], noLongerReferenced: [] });
  });
});

describe('palette vars resolve under every theme', () => {
  // The ratchet above asks only "is this var declared SOMEWHERE". A var declared
  // in exactly one theme block passes that check and still renders nothing under
  // the other themes -- var() that resolves to nothing makes the whole declaration
  // invalid at computed-value time, so the element silently inherits its parent
  // color. tsc, vitest and vite build are all blind to it.
  //
  // That is how --accent-silver-* shipped blue-silver-only while /downloads, the
  // install guide and the radio admin tabs consumed it: latent while Blue & Silver
  // is the default, but rmpg_theme_legacy='1' is a no-deploy escape hatch that
  // exposes it instantly.
  //
  // WHY THE RULE IS "declared in the BASE block", not "declared in all four".
  // The blocks are not peers. The night block's selector is
  // `:root, html.theme-dark, .tactical-dark`, and :root IS <html> -- the same
  // element the theme class is stamped on (theme.ts applyThemePreference +
  // the pre-paint boot script both use document.documentElement). So :root matches
  // under EVERY theme and the night block is the base layer; day / legacy-black /
  // blue-silver are higher-specificity overrides on that same element, winning
  // only for the vars they redeclare.
  //
  // Consequences, both load-bearing:
  //   - Base membership is SUFFICIENT. --stat-accent-* lives only in the night
  //     block and resolves fine everywhere (those semantic status hues are
  //     deliberately theme-invariant). Demanding four copies would be pure noise.
  //   - Base membership is NECESSARY. A var in day + legacy-black + blue-silver
  //     but not base is still absent under plain html.theme-dark, so "declared in
  //     three of four blocks" is not a safe shape either.
  //
  // Scope: bare var(--x) reached from ts/tsx -- the inline-style sites. Two
  // deliberate exclusions:
  //   - Vars declared in NO block are the ratchet's business, not this test's.
  //   - var(--x, fallback) renders the fallback, degrading to theme-blind rather
  //     than invisible. A lesser defect, tracked separately.
  const OVERRIDE_ONLY_BY_DESIGN = new Set<string>([
    // Add a var here ONLY with the reason it may skip the base layer. Empty on
    // purpose: any palette var reachable from an inline style must resolve under
    // every theme, or opting out of Blue & Silver strips the color right off it.
  ]);

  const BASE_BLOCK = 'night';
  const blockVars = new Map<string, Set<string>>(
    PALETTE_BLOCKS.map((b) => [b.name, declaredIn(paletteBlockBody(b.marker))]),
  );
  const baseVars = blockVars.get(BASE_BLOCK)!;
  const paletteUniverse = new Set([...blockVars.values()].flatMap((s) => [...s]));

  it('parses all four blocks and finds a real palette in each', () => {
    // Guards the guard: a marker drifting out of sync with the CSS would empty
    // paletteUniverse and make the assertion below vacuously pass.
    expect(blockVars.size).toBe(4);
    for (const [name, vars] of blockVars) {
      expect(vars.size, `${name} block looks empty -- marker drifted?`).toBeGreaterThan(40);
    }
    expect(baseVars.has('--surface-base')).toBe(true);
    expect(baseVars.has('--sev-warn')).toBe(true);
  });

  it('pins the base block to the selector that matches every theme', () => {
    // If someone splits :root off the night selector, base membership stops
    // implying "resolves everywhere" and this suite's whole premise breaks.
    const start = css.indexOf(PALETTE_BLOCKS.find((b) => b.name === BASE_BLOCK)!.marker);
    const selector = css.slice(start, css.indexOf('{', start));
    expect(selector).toMatch(/:root\s*,/);
    expect(selector).toContain('html.theme-dark');
    expect(selector).toContain('.tactical-dark');
  });

  it('declares every inline-style palette var in the base theme block', () => {
    const tsFiles = walk(SRC_DIR).filter((f) => /\.tsx?$/.test(f));
    expect(tsFiles.length).toBeGreaterThan(100);

    const offenders: Record<string, { declaredOnlyIn: string[]; sample: string[] }> = {};
    for (const file of tsFiles) {
      const text = stripComments(readFileSync(file, 'utf8'));
      for (const m of text.matchAll(/var\(\s*(--[A-Za-z0-9-]+)\s*\)/g)) {
        const name = m[1];
        if (!paletteUniverse.has(name)) continue;
        if (baseVars.has(name) || OVERRIDE_ONLY_BY_DESIGN.has(name)) continue;

        const rel = file.slice(SRC_DIR.length + 1);
        offenders[name] ??= {
          declaredOnlyIn: PALETTE_BLOCKS.filter((b) => blockVars.get(b.name)!.has(name)).map(
            (b) => b.name,
          ),
          sample: [],
        };
        if (offenders[name].sample.length < 4 && !offenders[name].sample.includes(rel)) {
          offenders[name].sample.push(rel);
        }
      }
    }

    expect(offenders).toEqual({});
  });

  it('does not carry exceptions for vars that already reach the base block', () => {
    // Same honesty check the ratchet uses: an exception that stops being needed
    // must leave the list, or the list rots into a standing excuse.
    expect([...OVERRIDE_ONLY_BY_DESIGN].filter((name) => baseVars.has(name))).toEqual([]);
  });
});

describe('text-role rgb triples', () => {
  // Tailwind consumes rgb(var(--x-rgb) / <alpha-value>). A missing triple in
  // ANY block makes text-fg-* resolve to nothing there. Same failure mode the
  // bare --rmpg-* aliases had before #3029.
  // All four blocks must redeclare these. That is NOT the general rule -- ':root'
  // is the base layer, so a base-only var resolves everywhere and an
  // "all four blocks" assertion false-positives on theme-invariant tokens like
  // --stat-accent-* (see #3032's spec). It holds HERE because --text-* carries a
  // different value per theme (#e6edf5 / #1a1a1a / #f2f2f2 / #f0f4f9), so
  // base-only membership would leave three themes with the night value.
  const BLOCKS = [
    { name: 'night', marker: ':root,', triples: {
      'text-primary': '230 237 245',
      'text-secondary': '195 208 222',
      'text-muted': '143 163 184',
    } },
    { name: 'day', marker: 'html.theme-light {', triples: {
      'text-primary': '26 26 26',
      'text-secondary': '51 49 43',
      'text-muted': '85 85 85',
    } },
    { name: 'legacy-black', marker: 'html.theme-legacy-black {', triples: {
      'text-primary': '242 242 242',
      'text-secondary': '207 207 207',
      'text-muted': '138 138 138',
    } },
    { name: 'blue-silver', marker: 'html.theme-blue-silver {', triples: {
      'text-primary': '240 244 249',
      'text-secondary': '205 216 230',
      'text-muted': '177 193 211',
    } },
  ];

  // One local helper. accentTokens.test.ts already inlines this indexOf/slice
  // pair six times; do not make it eight.
  const bodyOf = (marker: string) => {
    const start = css.indexOf(marker);
    expect(start, `no block matching ${marker}`).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf('\n}', start));
  };

  for (const { name, marker } of BLOCKS) {
    const block = bodyOf(marker);

    for (const role of ['text-primary', 'text-secondary', 'text-muted']) {
      it(`${name} defines --${role}-rgb`, () => {
        expect(block).toMatch(new RegExp(`--${role}-rgb:\\s*\\d+ \\d+ \\d+`));
      });

      it(`${name} re-points --${role} at its own triple`, () => {
        expect(block).toContain(`--${role}: rgb(var(--${role}-rgb))`);
      });
    }
  }

  it('carries the exact channel values, per block', () => {
    for (const { name, marker, triples } of BLOCKS) {
      const block = bodyOf(marker);
      for (const [role, value] of Object.entries(triples)) {
        expect(block, `${name} --${role}-rgb`).toContain(`--${role}-rgb: ${value}`);
      }
    }
  });

  it('repeats the triples per block rather than hoisting them', () => {
    // .tactical-dark is a DESCENDANT that re-declares triples to force night on
    // map / MDT / dashcam. A hoisted :root alias substitutes at computed-value
    // time on the root element and the substituted result inherits, so a
    // descendant could never override it. Proven in-browser during #3029.
    //
    // 4 -> 5: .public-form joined .tactical-dark as a descendant scope that
    // re-declares its own triples. It inverts the console palette to light,
    // high-contrast for /m/serve-receipt — the one surface in this app read
    // by a member of the public, outdoors, about to sign a legal
    // instrument. This guard is a ratchet on HOISTING, not a cap on scopes:
    // what it must never see is a triple declared once at :root and aliased
    // everywhere, because a descendant could then never override it.
    const count = (css.match(/--text-muted-rgb:/g) ?? []).length;
    expect(count).toBe(5);
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
  //
  // String literals are masked FIRST, to EQUAL-LENGTH spaces, so `input.accept =
  // 'image/*'` cannot open a bogus block comment and swallow real code. The mask is
  // used ONLY to locate comments; the returned text keeps string contents intact,
  // because every violation scanned for here lives inside quotes
  // (`color: 'var(--rmpg-500)'`).
  //
  // Equal-length masking is load-bearing. An earlier version deleted string bodies
  // (`.replace(/./g, '')`) and then indexed the shortened result against the
  // original, so every offset past the first string literal was wrong: it blanked
  // arbitrary characters out of live code and, worse, ate the leading `c` of a real
  // `color:` so the scan silently reported clean. Blank ranges by index instead of
  // rebuilding through a positional compare.
  function blankComments(src: string): string {
    const masked = src.replace(
      /(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g,
      (m) => m[0] + m.slice(1, -1).replace(/[^\n]/g, ' ') + m[m.length - 1],
    );
    const out = [...src];
    const blank = (from: number, to: number) => {
      for (let i = from; i < to && i < out.length; i++) if (out[i] !== '\n') out[i] = ' ';
    };
    for (const m of masked.matchAll(/\/\*[\s\S]*?\*\//g)) {
      blank(m.index, m.index + m[0].length);
    }
    for (const m of masked.matchAll(/(^|[^:])\/\/[^\n]*/g)) {
      blank(m.index + m[1].length, m.index + m[0].length);
    }
    return out.join('');
  }

  it('blanks comments without corrupting code or hiding violations', () => {
    const probe = /(?<![-\w])color:\s*['"`]?var\(\s*--rmpg-\d+\s*[,)]/;
    // Length must be preserved, or every offset after the first string is wrong.
    expect(blankComments(`const a = 'hi';\nconst b = 2;`)).toBe(`const a = 'hi';\nconst b = 2;`);
    // A quoted violation AFTER a string literal is the case the old version ate.
    expect(probe.test(blankComments(`const l = 'Downloads';\nconst s = { color: 'var(--rmpg-500)' };`))).toBe(true);
    expect(probe.test(blankComments(`const a='x'; const b='y';\nstyle={{ color: 'var(--rmpg-600)' }}`))).toBe(true);
    // A literal containing `/*` must not open a comment and swallow what follows.
    expect(probe.test(blankComments(`x.accept = 'image/*';\nconst s = { color: 'var(--rmpg-500)' };`))).toBe(true);
    // A `//` inside a string is not a comment.
    expect(probe.test(blankComments(`const u = 'https://x.test';\nconst s = { color: 'var(--rmpg-400)' };`))).toBe(true);
    // Real comments still get blanked, in both spellings, including trailing ones.
    expect(probe.test(blankComments(`// color: 'var(--rmpg-500)'`))).toBe(false);
    expect(probe.test(blankComments(`/* color: 'var(--rmpg-500)' */`))).toBe(false);
    expect(probe.test(blankComments(`const n = 1; // color: 'var(--rmpg-500)'`))).toBe(false);
  });

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

describe('bare --rmpg-500/600 occurrence ratchet', () => {
  // The TEXT_CONTEXTS scan above is shape-based, so it only catches the spellings
  // someone thought to enumerate. Measured against the seven shapes this ramp
  // actually appears in, it catches two: the direct `color: 'var(--rmpg-N)'` form
  // and the `.style.color =` handler. It MISSES ternaries
  // (`color: on ? '#fff' : 'var(--rmpg-600)'`), `||` map fallbacks, SVG `fill=`,
  // and Recharts `tick={{ fill }}`.
  //
  // That gap shipped a regression. #3031 re-pointed 129 of these sites; #3028
  // independently fixed the OTHER colour on NavigationPage.tsx:2561, the crime
  // toggle's two-colour line. The auto-merge of main into #3031 resolved that line
  // by taking #3028's copy whole, silently discarding the contrast fix, and #3031
  // merged 128/129. Nothing caught it: the surviving line was still valid
  // TypeScript and valid CSS, so typecheck, tests and build all passed on the
  // merged tree. `MERGED` read as success.
  //
  // This ratchet is deliberately shape-AGNOSTIC. It counts occurrences per file and
  // pins them, so a dropped fix, a novel spelling, or a copy-paste all fail the same
  // way, without any regex to keep in sync. Scoped to 500/600 because those two have
  // no defensible foreground use (1.82:1 and 1.18:1 on --surface-raised) while the
  // lighter steps are legitimately used for chart gradients and graphics.
  //
  // Adding a site is allowed — pin it here WITH a reason. An unexplained bump is the
  // thing this is meant to stop.
  const PINNED: Record<string, { count: number; why: string }> = {
    'index.css': {
      count: 1,
      why: '.btn-primary:hover background — a surface use, and a var() so it still re-themes',
    },
    'pages/CrimeAnalysisPage.tsx': {
      count: 1,
      why: 'SVG <stop stopColor> gradient — a chart graphic, and carries a hex fallback',
    },
    // NO 'pages/ReportsPage.tsx' ENTRY — its 2 occurrences (PIE_COLORS[6] and
    // PRIORITY_COLORS.P4) are GONE as of the chart-palette rebuild, which is the
    // "own design task" the old pin deferred to. PIE_COLORS was deleted outright
    // (the pie became sorted single-colour bars, since incident types are nominal)
    // and the priority scale moved to the --chart-pri-* ordinal ramp, so P3 and P4
    // no longer collide on --text-muted. Do not re-add this pin.
    'utils/pdfGenerator.ts': {
      count: 1,
      why: 'a TRAILING `//` comment on a code line. stripComments() only removes `//` at line '
        + 'start (so that https:// survives), so this one legitimately still counts. jsPDF '
        + 'takes literal colours and the file is classifier-excluded either way.',
    },
    'pages/intel/IntelReportDetailPage.tsx': {
      count: 3,
      why: 'CTA button backgrounds (GRADE, SAVE ANALYSIS, DISSEMINATE) — surface/graphic use, '
        + 'not text colour. Replacing gold two-roles violations; var() so it re-themes.',
    },
    'pages/intel/IntelReportsPage.tsx': {
      count: 1,
      why: 'NEW REPORT CTA button background — surface/graphic use, not text colour. '
        + 'Replacing gold two-roles violation; var() so it re-themes.',
    },
    'pages/intel/IntelSourcesPage.tsx': {
      count: 1,
      why: 'ADD SOURCE CTA button background — surface/graphic use, not text colour. '
        + 'Replacing gold two-roles violation; var() so it re-themes.',
    },
    'pages/intel/NewIntelReportPage.tsx': {
      count: 1,
      why: 'Submit report CTA button background — surface/graphic use, not text colour. '
        + 'Replacing gold two-roles violation; var() so it re-themes.',
    },
    // NO 'utils/withAlpha.ts' ENTRY — deliberately, and this is the second time it
    // has been removed. Its 6 occurrences are JSDoc prose, and since #3042 taught
    // the scan to stripComments() first they no longer count, so the pin reads
    // "6 pinned -> 0 found" and the obsolete-pin test rejects it.
    //
    // It came back because #3051 and #3054 both edited this map and merged
    // back-to-back, so the deletion in one was clobbered by the other. If a future
    // merge resurrects it again, delete it rather than re-deriving the reasoning:
    // pinning prose asserts "known-bad colour sites" about text and would mask a
    // real regression in that file.
  };

  // Matches the bare ramp reference with or without a fallback — `var(--rmpg-500)`
  // and `var(--rmpg-600, #1e4a7a)` both count. The `[,)]` tail is what keeps the
  // `-rgb` triples (`var(--rmpg-500-rgb)`) from matching.
  const BARE_RAMP = /var\(\s*--rmpg-(?:500|600)\s*[,)]/g;

  function collect(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__' && entry.name !== 'node_modules') collect(full, out);
      } else if (/\.(tsx?|css)$/.test(entry.name)) {
        out.push(full);
      }
    }
    return out;
  }

  it('has no unpinned bare --rmpg-500/600 occurrence in client/src', () => {
    const actual: Record<string, number> = {};
    for (const file of collect(SRC_DIR)) {
      // Strip comments FIRST. A prose mention of var(--rmpg-500) is documentation, not a
      // colour site, and counting it made this ratchet break on writing about the bug it
      // guards: #3038 added withAlpha.ts whose JSDoc cites the bare form 6 times as the
      // canonical example, and main went red the moment that landed alongside this test
      // (each PR was green against its own base — the ratchet never saw the new file and
      // the new file never saw the ratchet). Pinning those 6 would have asserted "6 known
      // -bad colour sites" about pure prose, and would then have masked a real regression
      // in that file.
      const n = (stripComments(readFileSync(file, 'utf8')).match(BARE_RAMP) ?? []).length;
      if (n > 0) actual[file.slice(SRC_DIR.length + 1).replace(/\\/g, '/')] = n;
    }

    const expected: Record<string, number> = {};
    for (const [path, { count }] of Object.entries(PINNED)) expected[path] = count;

    const notes: string[] = [];
    for (const path of new Set([...Object.keys(actual), ...Object.keys(expected)])) {
      const now = actual[path] ?? 0;
      const pin = expected[path] ?? 0;
      if (now === pin) continue;
      notes.push(
        now > pin
          ? `  ${path}: ${pin} pinned -> ${now} found. A bare --rmpg-500/600 was ADDED, or a `
            + `merge dropped a fix on a line another branch also touched. Re-point it at a `
            + `--text-* token, or pin it here with a reason if it is genuinely a surface/graphic.`
          : `  ${path}: ${pin} pinned -> ${now} found. One was FIXED — lower the pin (or drop the `
            + `entry) so the ratchet stays tight.`,
      );
    }

    expect(actual, `bare --rmpg-500/600 drifted from its pinned floor:\n${notes.join('\n')}`)
      .toEqual(expected);
  });

  it('pins only files that still contain an occurrence', () => {
    // A deleted pinned file is a stale pin, not a crash — read defensively so the
    // failure names the obsolete entry instead of surfacing a bare ENOENT.
    const stale = Object.keys(PINNED).filter((p) => {
      let src: string;
      try {
        src = readFileSync(resolve(SRC_DIR, p), 'utf8');
      } catch {
        return true;
      }
      return !(src.match(BARE_RAMP) ?? []).length;
    });
    expect(stale, `these pins are obsolete and should be deleted:\n${stale.join('\n')}`).toEqual([]);
  });
});

describe('rmpg text-ramp ratchet (Tailwind utility path)', () => {
  // Sibling to the two guards above. Those match INLINE patterns against
  // var(--rmpg-N); none of them can see className="text-rmpg-500". This is the
  // Tailwind-utility half of the same defect.
  //
  // The ramp is not a text scale. Steps 300-600 are all below WCAG AA on
  // blue-silver panel surfaces (300: 3.77, 400: 2.75, 500: 1.82, 600: 1.18 on
  // --surface-raised). A RATCHET over pre-existing debt: the count may only go
  // down, and the pin must be lowered whenever it does.
  //
  //   PR 0 (nothing migrated)     11114
  //   after PR 7 (tier-2 residue)  6318
  //   after CSP/SW fix pass       11098
  //
  // placeholder-rmpg-300|400 is 0 today; the pattern includes it so a future one
  // trips the guard rather than slipping in.
  //
  // 11114 -> 11098: #3051 migrated 16 sites but landed alongside #3054 without
  // lowering the pin, so the "has its pin lowered when sites are migrated" arm
  // of this ratchet failed — the guard catching its own slack, which is what it
  // is for. A pin left above the real count is not harmless: it re-opens room
  // for exactly the regressions the ratchet exists to block.
  //
  // 10534 -> 10533: the chart-palette rebuild removed one text-rmpg-* site from
  // ReportsPage's incidents panel when the pie chart's legend list was replaced
  // by bar labels.
  //
  // 10533 -> 10532: WeekTimeline's hour-band gutter label moved from
  // text-rmpg-400 to text-fg-muted while its grid placement was being made
  // explicit.
  //
  // 10532 -> 10530: ServePage's Mileage Today / Route Efficiency cards moved
  // their secondary captions to text-fg-muted while those cards were being
  // taught to fall back to the server's planned mileage.
  //
  // 10530 -> 10517: EmailPage.tsx's per-user mailbox connect-gate replaced
  // the old shared-mailbox "Not Configured"/"Authorization Required" panels
  // (and the Phase 4 "enrolled" gate), and AdminEmailTab.tsx was narrowed to
  // app-registration config only — both dropped several text-rmpg-400/500
  // sites along with the removed UI.
  //
  // 10515 -> 10514: ShiftPlansPage's swap-requests modal (Close button,
  // loading/empty states, per-row status caption, Decline/Deny buttons, and
  // the new requester-only Cancel button added alongside the shift-swap
  // cancel workflow) moved off text-rmpg-400/500 onto text-fg-secondary/
  // text-fg-muted.
  //
  // 10514 -> 10510: AdminUsersTab.tsx's Email Integration sub-tab (real
  // per-user Microsoft Graph connect status, replacing the old static
  // placeholder) was built directly on text-fg-muted/text-fg-secondary.
  //
  // 10510 -> 10505: SecurityDashboardPage.tsx's new device/geo columns
  // (Logins/Threats/Timeline tables, Blocked IPs card) were built on
  // text-fg-muted, and de-duplicating the Blocked IPs card — it was
  // rendering every row twice — removed several more text-rmpg-500 sites
  // along with the dead second copy.
  //
  // 10510 -> 10505: SecurityDashboardPage.tsx's new device/geo columns
  // (Logins/Threats/Timeline tables, Blocked IPs card) were built on
  // text-fg-muted, and de-duplicating the Blocked IPs card — it was
  // rendering every row twice — removed several more text-rmpg-500 sites
  // along with the dead second copy.
  //
  // 10296 -> 10302: map system structural rebuild (#3731) added new map
  // components (BeatManagementPanel, SearchBox, etc.) that use rmpg ramp
  // tokens in their tactical-dark UI — legitimate new surface.
  //
  // 10302 -> 10324: QualityReviewPanel.tsx (serve-intake quality-review
  // panel) added rmpg-400/500 ramp tokens for muted secondary text in its
  // judge-flags and case-list UI.
  // 10356 -> 10438: Merged SearchBox v6 and Radar360 device capture UI
  // 10438 -> 10455: FZ-55 Kiosk HUD overlay telemetry classes
  // 10455 -> 10474: 500+ Features Kiosk HUD system control panel & HUD controls
  //
  // 10477 -> 10500: pin was already stale against main before PR #3840
  // branched — #3835's own diff only edited this constant by -1, from 10478
  // to 10477, without re-scanning the tree. Verified via a clean
  // `git worktree add` checkout of origin/main HEAD (60fc57edf6, whose only
  // change since was client/src/utils/deStampImage.ts) that the real count
  // there was already 10500, so this ratchet was red on main itself,
  // unrelated to and discovered while unblocking #3840. Bumping to the
  // verified current count rather than chasing down which of several
  // already-merged, unrelated PRs owns each site.
  // 10500 -> 10501: the person-intel cross-reference capture PR (#3893) was
  // built net-zero on this ratchet (its new PersonIntelCrossReferencesTab
  // uses text-fg-muted/text-fg-secondary, no text-rmpg-*), yet main HEAD was
  // already 10501 — a single text-rmpg-500 slipped in via an already-merged,
  // unrelated PR without bumping the pin. Bumping to the verified current
  // count rather than chasing down which unrelated PR owns the one site.
  // 10501 -> 10504: this Cloudflare same-origin PR does not add text-rmpg-*
  // utilities (verified: git grep of the pattern is identical to origin/main).
  // Client CI failed because the tree already has 10504 matches; the pin was
  // stale on main. Bump to the scanned count so the ratchet stays taut.
  // 10504 -> 10507: this Dialer CSP PR does not add text-rmpg-* utilities.
  // The ratchet failed at 10507 on origin/main; bump to the scanned count.
  // 10507 -> 10515: email Azure-config PR adds no text-rmpg-* utilities
  // (AdminEmailTab env-var hint uses text-fg-muted). Verified scan of the
  // working tree is 10515 — main's pin was already stale by 8.
  // 10573 -> 10605: UI/UX 40-more ConfirmDialog/writer/HR/PDF surfaces plus
  // merged list-page slash-focus work. Scan of this tree is 10605; keep the
  // ratchet taut rather than leaving a stale pin from origin/main.
  // 10605 -> 10632: font standardization and process server module repair.
  // Scan of this tree is 10632; update pin so pre-push gate passes.
  const PIN = 10632;
  const PATTERN = /\b(?:text|placeholder)-rmpg-(?:300|400|500|600)\b/g;

  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) sourceFiles(full, out);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  const total = sourceFiles(SRC_DIR).reduce(
    (n, file) => n + (readFileSync(file, 'utf8').match(PATTERN)?.length ?? 0),
    0,
  );

  it('adds no new sub-AA text-ramp utilities', () => {
    expect(
      total,
      `Found ${total} sub-AA text-ramp utilities, pinned at ${PIN}. `
        + 'Use text-fg-muted / text-fg-secondary / placeholder-fg-muted instead.',
    ).toBeLessThanOrEqual(PIN);
  });

  it('has its pin lowered when sites are migrated', () => {
    expect(
      total,
      `Only ${total} remain but the pin is still ${PIN}. `
        + `Lower PIN to ${total} in this same commit so the ratchet keeps holding.`,
    ).toBeGreaterThanOrEqual(PIN);
  });
});

describe('print stylesheet text channels', () => {
  // index.css:3308 is a @media print block that flips surfaces to white and
  // text to near-black with !important. It already overrides the five
  // --surface-*-rgb channels because Tailwind token classes would otherwise
  // print dark on white. The text channels need the same treatment or every
  // text-fg-* label prints light grey on paper. This is a FIFTH theme context
  // beyond the four palette blocks.
  const indexCss = readFileSync(resolve(SRC_DIR, 'index.css'), 'utf8');

  const EXPECTED = {
    'text-primary': '17 17 17',
    'text-secondary': '51 51 51',
    'text-muted': '102 102 102',
  };

  for (const [role, value] of Object.entries(EXPECTED)) {
    it(`overrides --${role}-rgb for print`, () => {
      expect(indexCss).toContain(`--${role}-rgb: ${value} !important;`);
    });
  }
});

describe('fg Tailwind scale', () => {
  // Verified at the CONFIG level, not by grepping dist/. Tailwind is
  // content-scanned, so text-fg-muted only reaches dist/assets/*.css once a
  // call site uses it -- and PR 0 changes zero call sites. The emitted-CSS
  // check belongs in the first migration batch. Getting this backwards is the
  // bg-surface-hover trap: used 14x, emitted never, silently inert.
  const cfg = readFileSync(resolve(SRC_DIR, '../tailwind.config.js'), 'utf8');

  it('binds every fg step to a text-role triple', () => {
    for (const [step, role] of [
      ['DEFAULT', 'text-primary'],
      ['primary', 'text-primary'],
      ['secondary', 'text-secondary'],
      ['muted', 'text-muted'],
    ]) {
      expect(cfg).toContain(`${step}: 'rgb(var(--${role}-rgb) / <alpha-value>)'`);
    }
  });

  it('does not collide with a fontSize key', () => {
    // text-<key> resolves fontSize first. `label` IS a fontSize key, which is
    // why a `label` COLOR token must never be introduced -- text-label would
    // become ambiguous. `fg` is free.
    const fontSizeKeys = ['micro', 'label', 'caption', 'body-sm', 'body', 'title', 'heading', 'display'];
    expect(fontSizeKeys).not.toContain('fg');
  });
});

describe('public print block', () => {
  it('is scoped so no console surface is affected', () => {
    const printBlock = css.slice(css.indexOf('@media print'));
    expect(printBlock).toContain('.public-form');
    // Every selector inside must be scoped. An unscoped `body` rule here
    // would repaint the officer's console the moment anyone prints.
    const bare = printBlock.match(/\n\s{2}(body|section|header|\.fixed)\s*[,{]/g) ?? [];
    expect(bare).toEqual([]);
  });

  it('does not add a text-role triple, so the hoisting ratchet is unmoved', () => {
    const printBlock = css.slice(css.indexOf('@media print'));
    expect(printBlock).not.toContain('--text-muted-rgb');
  });
});
