/**
 * Alpha compositing for theme-aware color strings.
 *
 * Replaces the `${color}22` / `color + '20'` idiom, which only produces valid
 * CSS when `color` is a raw 6-digit hex. When the value is a CSS variable the
 * concatenation yields `var(--text-muted)22` — invalid CSS — so the tint, glow,
 * or ring silently does not render. Nothing throws; the element just loses its
 * background.
 *
 * This was a LIVE failure, not a latent contract. Two values in shipped palette
 * maps became `var()` in 37a603e1fc (2026-06-16):
 *
 *   - `statusColors.ts` UNIT_STATUS_HEX.off_duty      → 'var(--text-muted)'
 *   - `hrConstants.ts`  LEAVE_STATUS_COLORS.cancelled → 'var(--text-muted)'
 *
 * so off-duty unit markers rendered with no accuracy ring and no glow, and
 * cancelled-leave badges with no background tint or border.
 *
 * Both entries pointed at a `--rmpg-*` ramp step until #3031 re-pointed them by
 * role. The specific token is irrelevant to the bug — ANY `var()` breaks the
 * concat. It is very relevant to the fix, though: `--text-muted` has no `-rgb`
 * companion triple, so the `rgb(var(--x-rgb) / a)` approach could not have
 * repaired these two sites at all without first adding triples to all four
 * theme blocks. `color-mix` needs nothing.
 *
 * Strategy — two paths, chosen by the shape of `color`:
 *
 *   raw 6-digit hex → `color + hexPair`. Byte-identical to the old idiom, which
 *     is what makes the ~70 already-working call sites provably unchanged and
 *     concentrates this refactor's risk on the ~11 that were already broken.
 *
 *   anything else   → `color-mix(in srgb, <color> <pct>%, transparent)`.
 *     Covers `var()`, `hsl()` (see colorLookup.ts hashToHsl), `rgb()`, and
 *     named colors.
 *
 * `color-mix(in srgb, C P%, transparent)` is EXACTLY C at alpha P/100, not a
 * visual approximation: `transparent` is `rgba(0,0,0,0)` and srgb mixing
 * premultiplies alpha, so the transparent side contributes zero weight to the
 * color channels and only pulls the result's alpha down to P.
 *
 * `color-mix` is also already the house pattern here (~40+ uses, including
 * dynamic interpolation in StatsCard.tsx and PriorityHeatmap.tsx), and
 * theme-palettes.css states the preference directly: use the `-rgb` triples
 * "when you literally need rgba()-style alpha — prefer the color-mix pattern".
 * That is why this helper needs no new `-rgb` triples, and why the two `var()`
 * palette entries above can STAY `var()` rather than being reverted to
 * literals.
 *
 * SAFETY NOTE — Mapbox GL paint properties cannot parse `color-mix()`, but no
 * paint property flows through this helper. The map modules that look like they
 * might (mapMarkers.ts, MapboxMiniMap.tsx, DispatchMiniMap.tsx,
 * ServeIntakeMap.tsx) build native `mapboxgl.Marker` DOM elements and set
 * `style.cssText` / inline `style=` — ordinary CSS. Verified: none of them call
 * `setPaintProperty`, `addLayer`, or pass a `paint:` object. Do not route a
 * genuine GL paint value through here.
 */

/** Raw 6-digit hex — the only shape the legacy concat idiom handled correctly. */
const SIX_DIGIT_HEX = /^#[0-9a-fA-F]{6}$/;

/** Hex that already carries an alpha pair, e.g. `#22c55e80`. */
const EIGHT_DIGIT_HEX = /^#[0-9a-fA-F]{8}$/;

/** A 2-digit hex alpha suffix as written at the legacy call sites, e.g. '22'. */
const TWO_DIGIT_HEX = /^[0-9a-fA-F]{2}$/;

/**
 * Compose `color` at `alpha`, emitting valid CSS whatever shape `color` is.
 *
 * @param color Any CSS color string: raw hex (`#22c55e`), a theme variable
 *   (`var(--text-muted)`), `hsl(...)`, `rgb(...)`, or a named color.
 * @param alpha Either a 2-digit hex string matching the legacy suffix (`'22'`)
 *   — preferred when migrating an existing call site, since it is concatenated
 *   verbatim onto raw hex and is therefore byte-identical to the old output —
 *   or a 0–1 number (`0.13`) for new code.
 *
 * @example
 *   withAlpha('#22c55e', '80')          // '#22c55e80'
 *   withAlpha('var(--text-muted)', '22') // 'color-mix(in srgb, var(--text-muted) 13.33%, transparent)'
 *   withAlpha('var(--sev-ok)', 0.5)     // 'color-mix(in srgb, var(--sev-ok) 50%, transparent)'
 */
export function withAlpha(color: string, alpha: number | string): string {
  // A missing or non-string color must never reach the paths below, where it
  // would yield 'undefined22' or 'color-mix(in srgb, undefined …)'. Failing to
  // `transparent` fails INVISIBLE — on a dispatch map an absent marker halo is
  // safer than a misleading one, and the alternative (returning the input so it
  // shows up loudly in devtools) can paint a wrong-colored element on a live
  // tactical surface.
  if (typeof color !== 'string' || color.trim() === '') return 'transparent';

  // A pre-alpha'd hex has its alpha REPLACED rather than compounded — call
  // sites pass the alpha they want the RESULT to carry, not a further
  // reduction of whatever the value already had. 8-digit literals already
  // exist in this tree, so such a value can genuinely arrive here. Recursion
  // is one level deep: `slice(0, 7)` is always a 6-digit hex.
  if (EIGHT_DIGIT_HEX.test(color)) return withAlpha(color.slice(0, 7), alpha);

  // Exact path: a hex-pair alpha onto raw hex is concatenated verbatim, so the
  // output is byte-identical to the legacy `${color}22` expression. Deliberately
  // not routed through the float normalization below — byte-identity here is a
  // construction guarantee, not a consequence of rounding.
  if (typeof alpha === 'string' && TWO_DIGIT_HEX.test(alpha) && SIX_DIGIT_HEX.test(color)) {
    return color + alpha;
  }

  const a = normalizeAlpha(alpha);

  // Numeric alpha onto raw hex still yields hex, so hex-only consumers keep
  // getting hex regardless of which alpha spelling the call site uses.
  if (SIX_DIGIT_HEX.test(color)) {
    return color + toHexPair(a);
  }

  return `color-mix(in srgb, ${color} ${formatPercent(a)}%, transparent)`;
}

/**
 * Coerce either alpha spelling to a 0–1 fraction.
 *
 * Malformed input resolves to fully opaque rather than propagating. A bad
 * numeric alpha would otherwise emit `NaN%`, and a bad hex pair `parseInt('zz',
 * 16)` → `NaN` — both of which the browser drops silently, reproducing the very
 * class of invisible failure this module exists to eliminate. Opaque is wrong
 * but *visible*, so it surfaces in review instead of vanishing.
 */
function normalizeAlpha(alpha: number | string): number {
  if (typeof alpha === 'number') {
    if (!Number.isFinite(alpha)) return 1;
    return Math.min(1, Math.max(0, alpha));
  }
  if (!TWO_DIGIT_HEX.test(alpha)) return 1;
  return parseInt(alpha, 16) / 255;
}

/** 0–1 fraction → the 2-digit lowercase hex pair CSS expects on 8-digit hex. */
function toHexPair(a: number): string {
  return Math.round(a * 255)
    .toString(16)
    .padStart(2, '0');
}

/**
 * 0–1 fraction → a percentage for color-mix, trimmed to 2 decimals so the
 * emitted CSS stays readable in devtools ('13.33%', not '13.333333333333334%').
 */
function formatPercent(a: number): string {
  return String(Math.round(a * 10000) / 100);
}
