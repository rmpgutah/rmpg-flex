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
  const KNOWN_DEAD = new Set([
    // "rt-" radio-theme tokens: 142 occurrences, defined in no stylesheet.
    '--rt-accent', '--rt-bg', '--rt-border', '--rt-muted', '--rt-panel',
    '--rt-text', '--rt-tx',
    // Raw Tailwind-ish color names that were never palette tokens. The correct
    // tokens are --sev-ok / --sev-warn / --sev-critical / --brand-*.
    '--amber-400', '--amber-500', '--amber-500-rgb', '--green-400', '--green-500',
    '--green-500-rgb', '--orange-400', '--orange-500-rgb', '--purple-400',
    '--purple-500-rgb', '--red-400', '--red-500-rgb',
    // Grid tokens referenced by a table skin that never shipped its palette.
    '--grid-header-text', '--grid-row-even', '--grid-row-selected',
    '--grid-row-selected-border',
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
    'pages/ReportsPage.tsx': {
      count: 2,
      why: 'PIE_COLORS[6] + PRIORITY_COLORS.P4 — categorical palette. PRIORITY_COLORS.P3 is '
        + 'already --text-muted, so matching it would render two CAD priority levels '
        + 'identically. Tracked as its own design task.',
    },
    'styles/theme-palettes.css': {
      count: 1,
      why: 'the alias comment quotes the bare form as documentation',
    },
    'utils/pdfGenerator.ts': {
      count: 1,
      why: 'inside a comment; jsPDF takes literal colours and the file is classifier-excluded',
    },
    'utils/withAlpha.ts': {
      count: 6,
      why: 'all inside the JSDoc documenting the exact bare-ramp bug this helper fixes '
        + '(the two shipped var(--rmpg-500) call sites it references, plus @example lines)',
    },
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
      const n = (readFileSync(file, 'utf8').match(BARE_RAMP) ?? []).length;
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
