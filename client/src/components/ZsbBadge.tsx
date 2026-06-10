// ============================================================
// RMPG Flex — Z/S/B chart-code badge (gold)
//
// Single source of truth for presenting a call/incident's
// Sector/Zone/Beat as the printout-form composite, e.g.
//
//   SL1/SSL/A1
//
// in the gold mono badge used on the dispatch detail panel.
// The composite is derived structurally from the geography
// fields (zone codes embed their sector: "SL1-SSL"; beat codes
// embed both: "SL1-SSL/A1"), so no district lookup/fetch is
// needed — safe to render in long card lists. Falls back to the
// stored dispatch_code when geography fields are absent.
// ============================================================
import { sectionPrefix, zoneLeaf, beatLeaf } from '../utils/dispatchCodeParts';

/**
 * Derive the printout composite "SEC/ZONE/BEAT" (e.g. "SL1/SSL/A1") for a
 * record. Codes usually embed their parents (zone "SL1-SSL", beat
 * "SL1-SSL/A1"), but some rows carry leaf-only values ("A1") — so the parts
 * are recovered from whichever field has them and re-joined, instead of
 * trusting any single field's embedded form.
 */
export function zsbComposite(opts: {
  zoneId?: string | null;
  beatId?: string | null;
  dispatchCode?: string | null;
  /** Resolved Spillman sector code (e.g. from getSectionCode) when the caller has one. */
  sectionCode?: string | null;
}): string {
  // beat "SL1-SSL/A1" → zone part "SL1-SSL"; lets a full beat code stand in
  // for a missing zone_id (and vice versa: zone_id covers a leaf-only beat).
  const beatZonePart = (opts.beatId || '').includes('/') ? (opts.beatId || '').split('/')[0] : '';
  const zoneCode = opts.zoneId || beatZonePart;
  const sec = opts.sectionCode || sectionPrefix(zoneCode);
  const zn = zoneLeaf(zoneCode);
  const bt = beatLeaf(opts.beatId || '');
  const composite = [sec, zn, bt].filter(Boolean).join('/');
  return composite || opts.dispatchCode || '';
}

export default function ZsbBadge({
  zoneId, beatId, dispatchCode, sectionCode, copyable = true, className = '',
}: {
  zoneId?: string | null;
  beatId?: string | null;
  dispatchCode?: string | null;
  sectionCode?: string | null;
  copyable?: boolean;
  className?: string;
}) {
  const code = zsbComposite({ zoneId, beatId, dispatchCode, sectionCode });
  if (!code) return null;
  const copy = () => { try { navigator.clipboard?.writeText(code); } catch { /* clipboard unavailable */ } };
  return (
    <span
      role={copyable ? 'button' : undefined}
      tabIndex={copyable ? 0 : undefined}
      title={copyable ? 'Sector/Zone/Beat chart code — click to copy' : 'Sector/Zone/Beat chart code'}
      onClick={copyable ? copy : undefined}
      onKeyDown={copyable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copy(); } } : undefined}
      className={`${copyable ? 'cursor-pointer hover:brightness-110 ' : ''}text-[10px] font-bold font-mono text-amber-300 bg-amber-900/30 border border-amber-700/40 px-2 py-0.5 rounded-sm tracking-wider tabular-nums ${className}`}
      style={{ textShadow: '0 0 6px rgba(251,191,36,0.15)' }}
    >
      {code}
    </span>
  );
}
