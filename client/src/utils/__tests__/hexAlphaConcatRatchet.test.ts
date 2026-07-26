import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Ratchet: `client/src` must contain zero hex-alpha concatenations.
 *
 * The bug class: synthesizing a translucent color by welding a 2-digit hex
 * alpha onto a color string — `${color}22` or `color + '20'` — only produces
 * valid CSS when `color` is a raw 6-digit hex. With a CSS variable it yields
 * `var(--text-muted)22`, which the browser drops silently, so the tint, glow, or
 * ring simply does not render. Nothing throws and nothing logs.
 *
 * That is what makes this worth a ratchet rather than a code-review habit. The
 * two spellings are individually harmless-looking, the failure is invisible in
 * the DOM, and the trigger is remote: someone tokenizing a value in a palette
 * map three files away breaks a marker halo on the dispatch map. Exactly that
 * happened in 37a603e1fc.
 *
 * Use `withAlpha(color, '22')` from utils/withAlpha.ts instead — it emits plain
 * hex concatenation for raw hex (byte-identical to the old idiom) and
 * `color-mix()` for everything else.
 */

/**
 * Vitest reports `import.meta.url` relative to the project root, so deriving
 * this path from it resolves to a bogus '/src'. The runner's cwd is `client/`,
 * which is stable for both `npx vitest run` and the CI job. The
 * "finds source files" test below fails loudly if this ever stops resolving.
 */
const SRC = join(process.cwd(), 'src');

/** `${expr}22` — the template-literal spelling. */
const TEMPLATE_CONCAT = /\$\{[^{}]*\}[0-9a-fA-F]{2}\b/g;

/** `expr + '22'` — the string-concat spelling. */
const STRING_CONCAT = /\+\s*'[0-9a-fA-F]{2}'/g;

/**
 * `${x}12px` / `${y}0deg` and friends are lengths, not colors. A CSS unit
 * immediately after the interpolation means the two hex-looking characters are
 * the head of a unit token, not an alpha pair.
 */
const CSS_UNIT_TAIL = /\$\{[^{}]*\}(px|em|ch|vh|vw|fr|pt|deg|ms|s|%)\b/;

/**
 * Paths exempt from the ratchet.
 *
 * `withAlpha.ts` documents the very idiom it replaces, so its doc comment and
 * tests necessarily contain literal examples. Test files assert on the outputs.
 */
const EXEMPT = [/utils\/withAlpha\.ts$/, /__tests__/, /\.test\.tsx?$/, /\.spec\.tsx?$/];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Strip line and block comments so prose about the idiom isn't flagged. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('hex-alpha concatenation ratchet', () => {
  const files = walk(SRC).filter((f) => !EXEMPT.some((re) => re.test(f)));

  it('finds source files to scan (guards against a broken walk)', () => {
    // Without this, a bad path would make the ratchet vacuously pass forever.
    expect(files.length).toBeGreaterThan(500);
  });

  it('has no hex-alpha concatenation anywhere in client/src', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'));
      const rel = relative(SRC, file);

      for (const match of code.matchAll(TEMPLATE_CONCAT)) {
        if (CSS_UNIT_TAIL.test(match[0])) continue;
        offenders.push(`${rel}: ${match[0]}`);
      }
      for (const match of code.matchAll(STRING_CONCAT)) {
        offenders.push(`${rel}: ${match[0]}`);
      }
    }

    expect(
      offenders,
      `Hex-alpha concatenation renders nothing when the color is a CSS variable.\n` +
        `Replace with withAlpha(color, '<pair>') from utils/withAlpha.ts:\n\n` +
        offenders.join('\n'),
    ).toEqual([]);
  });
});
