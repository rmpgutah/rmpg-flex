import { Car } from 'lucide-react';
import WidgetFrame from './WidgetFrame';
import type { IntelOverview } from '../useIntelOverview';

type Row = IntelOverview['plate_sightings'][number];

// v1047 — replaced 🚗 emoji with Lucide Car icon. The emoji rendered as a
// colorful sticker on the dark theme, breaking the monochrome chrome.
export default function PlateSightingsWidget({ rows }: { rows: Row[] }) {
  return (
    <WidgetFrame title={<span className="inline-flex items-center gap-1"><Car size={11} />Plate Sightings</span>} note="ticker">
      {rows.length === 0 && <div className="text-[10px] text-rmpg-500">No recent sightings.</div>}
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2 py-[5px] border-b border-border-subtle last:border-b-0">
          <div className="flex-1">
            <div className="font-mono text-[11px] text-rmpg-200">{r.state ? `${r.state} · ` : ''}{r.plate}</div>
            <div className="text-[10px] text-rmpg-500">{r.flag ? `${r.flag} · ` : ''}{r.location_text || '—'}</div>
          </div>
        </div>
      ))}
    </WidgetFrame>
  );
}
