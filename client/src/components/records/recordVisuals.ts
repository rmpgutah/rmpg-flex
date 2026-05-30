// ============================================================
// RMPG Flex — Records Visual Tokens
// ------------------------------------------------------------
// Single source of truth for the "advanced/dynamic" visual layer
// shared by every record detail panel (persons, vehicles,
// properties, business, evidence). Carries the tactical-CAD glow
// accents the Spillman/Motorola theme can't express through plain
// Tailwind class strings (box-shadow needs a real value).
//
// Two layers:
//   1. BADGE_TONES — hue → {text,bg,border,glow}. Visual only.
//   2. classifyFlag() — record flag → {tone,pulse}. DOMAIN logic.
// ============================================================

import type { CSSProperties } from 'react';

/** Hues available to record badges / section accents. */
export type BadgeTone =
  | 'red'      // critical — armed, violent, active warrant, watchlist
  | 'orange'   // high     — felony, escape risk, supervision
  | 'amber'    // caution  — trespass, BOLO, parking, generic flag
  | 'gold'     // brand    — neutral-but-notable (e.g. alias, veteran-adjacent)
  | 'purple'   // behavioral — mental health / crisis
  | 'pink'     // medical/self-harm
  | 'blue'     // informational (rendered neutral-gray per zero-blue rule)
  | 'teal'     // status-good-but-watch
  | 'green'    // cleared / positive
  | 'gray';    // neutral default

export interface ToneStyle {
  /** Foreground text/icon color. */
  text: string;
  /** Translucent fill. */
  bg: string;
  /** Border color (also the inner ring of the glow). */
  border: string;
  /** Outer glow color — drives the box-shadow halo. */
  glow: string;
}

// Colors chosen to sit on the pure-black (#000) Spillman surface.
// Fills are low-alpha so the black reads through; glows are the same
// hue at higher intensity for the halo. No raw blue — the "blue"
// tone is intentionally neutral gray to honor the zero-blue rule.
export const BADGE_TONES: Record<BadgeTone, ToneStyle> = {
  red:    { text: '#f87171', bg: 'rgba(220,38,38,0.16)',  border: 'rgba(239,68,68,0.55)',  glow: 'rgba(239,68,68,0.45)' },
  orange: { text: '#fb923c', bg: 'rgba(234,88,12,0.15)',  border: 'rgba(251,146,60,0.50)', glow: 'rgba(251,146,60,0.38)' },
  amber:  { text: '#fbbf24', bg: 'rgba(217,119,6,0.15)',  border: 'rgba(245,158,11,0.50)', glow: 'rgba(245,158,11,0.35)' },
  gold:   { text: '#e8b820', bg: 'rgba(212,160,23,0.14)', border: 'rgba(212,160,23,0.50)', glow: 'rgba(212,160,23,0.40)' },
  purple: { text: '#c084fc', bg: 'rgba(124,58,237,0.16)', border: 'rgba(168,85,247,0.50)', glow: 'rgba(168,85,247,0.38)' },
  pink:   { text: '#f472b6', bg: 'rgba(219,39,119,0.16)', border: 'rgba(244,114,182,0.50)',glow: 'rgba(244,114,182,0.38)' },
  blue:   { text: '#cbd5e1', bg: 'rgba(120,120,120,0.14)',border: 'rgba(160,160,160,0.40)',glow: 'rgba(160,160,160,0.30)' },
  teal:   { text: '#5eead4', bg: 'rgba(13,148,136,0.15)', border: 'rgba(45,212,191,0.45)', glow: 'rgba(45,212,191,0.32)' },
  green:  { text: '#4ade80', bg: 'rgba(5,150,105,0.15)',  border: 'rgba(34,197,94,0.45)',  glow: 'rgba(34,197,94,0.34)' },
  gray:   { text: '#b8b8b8', bg: 'rgba(90,90,90,0.18)',   border: 'rgba(120,120,120,0.35)',glow: 'rgba(120,120,120,0.22)' },
};

/**
 * Build the inline style for a toned chip / accent element.
 * `glowing=false` keeps the chip flat (used for low-priority badges so
 * the panel isn't a christmas tree); `glowing=true` adds the halo.
 */
export function toneStyle(tone: BadgeTone, glowing = true): CSSProperties {
  const t = BADGE_TONES[tone] ?? BADGE_TONES.gray;
  return {
    color: t.text,
    background: t.bg,
    border: `1px solid ${t.border}`,
    boxShadow: glowing ? `0 0 0 1px ${t.border}, 0 0 10px ${t.glow}` : undefined,
  };
}

// ── DOMAIN MAPPING ──────────────────────────────────────────
// classifyFlag() decides how loud a record flag should look. This is
// an OPERATIONAL judgment call (what counts as "critical" vs "caution"
// in RMPG's CAD), so it lives in one isolated, well-commented function
// that's easy to tune. The default below is a reasonable starting
// point — Christopher, adjust the buckets to match your dispatch SOP.

export interface FlagVisual {
  tone: BadgeTone;
  /** Pulse (animated) for the highest-priority, must-not-miss flags. */
  pulse: boolean;
}

// Normalized substrings → bucket. Matching is case-insensitive and
// substring-based so "Active Warrant", "WARRANT", "warrant hit" all
// resolve the same.
// Person + vehicle + property/evidence vocabularies share these buckets so
// every record type's flags get consistent severity from one place.
const CRITICAL_TERMS = ['armed', 'weapon', 'violent', 'warrant', 'wanted', 'watchlist', 'ofac', 'escape', 'officer safety', 'caution', 'stolen', 'hazard', 'hazmat'];
const HIGH_TERMS     = ['felony', 'offender', 'sex offender', 'pursuit', 'gang', 'parole', 'probation', 'supervision', 'pre-trial', 'no insurance', 'impound', 'uninsured'];
const BEHAV_TERMS    = ['mental', 'psych', 'crisis', '5150'];
const MEDICAL_TERMS  = ['suicid', 'self-harm', 'medical', 'overdose', 'biohazard'];
const CAUTION_TERMS  = ['trespass', 'bolo', 'parking', 'no contact', 'restrain', 'suspended', 'expired', 'evidence', 'hold'];
const POSITIVE_TERMS = ['cleared', 'verified', 'cooperative', 'released', 'returned'];

/**
 * Map a free-text record flag to its visual treatment.
 *
 * DECISION POINT — tune these buckets to RMPG's operational priorities.
 * Anything unmatched falls through to a neutral amber "generic flag"
 * so no flag is ever rendered weightless (the old FLAG_COLORS map left
 * unknown flags gray/invisible).
 */
export function classifyFlag(rawFlag: string): FlagVisual {
  const f = (rawFlag || '').toLowerCase();
  const has = (terms: string[]) => terms.some((t) => f.includes(t));

  if (has(CRITICAL_TERMS)) return { tone: 'red', pulse: true };
  if (has(MEDICAL_TERMS))  return { tone: 'pink', pulse: false };
  if (has(BEHAV_TERMS))    return { tone: 'purple', pulse: false };
  if (has(HIGH_TERMS))     return { tone: 'orange', pulse: false };
  if (has(POSITIVE_TERMS)) return { tone: 'green', pulse: false };
  if (has(CAUTION_TERMS))  return { tone: 'amber', pulse: false };
  return { tone: 'amber', pulse: false }; // generic flag — visible, not loud
}
