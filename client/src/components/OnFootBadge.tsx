// ON FOOT badge — shown on the dispatch board / unit surfaces while a
// unit's officer is detected out of the vehicle (units.on_foot = 1).
// Brand-gold, 9px mono, no pill (Spillman tokens). Click opens the
// unit's on-foot activity history when an onClick is provided.
import { parseTimestamp } from '../utils/dateUtils';

export default function OnFootBadge({ since, onClick }: { since?: string | null; onClick?: () => void }) {
  let elapsed = '';
  if (since) {
    const mins = Math.max(0, Math.floor((Date.now() - parseTimestamp(since).getTime()) / 60_000));
    elapsed = ` ${mins}m`;
  }
  return (
    <span
      className="inline-flex items-center gap-0.5 px-1 py-0 text-[9px] font-black font-mono uppercase tracking-wider cursor-pointer"
      style={{ color: '#d4a017', border: '1px solid #d4a01740', background: '#d4a01712' }}
      title={`Officer detected on foot${since ? ` since ${since}` : ''} — click for history`}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
    >
      ON FOOT{elapsed && <span className="tabular-nums">{elapsed}</span>}
    </span>
  );
}
