import WidgetFrame from './WidgetFrame';
import type { IntelOverview } from '../useIntelOverview';

type Row = IntelOverview['plate_sightings'][number];

export default function PlateSightingsWidget({ rows }: { rows: Row[] }) {
  return (
    <WidgetFrame title="🚗 Plate Sightings" note="ticker">
      {rows.length === 0 && <div className="text-[10px] text-[#555]">No recent sightings.</div>}
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2 py-[5px] border-b border-[#131313] last:border-b-0">
          <div className="flex-1">
            <div className="font-mono text-[11px] text-[#e8e8e8]">{r.state ? `${r.state} · ` : ''}{r.plate}</div>
            <div className="text-[10px] text-[#666]">{r.flag ? `${r.flag} · ` : ''}{r.location_text || '—'}</div>
          </div>
        </div>
      ))}
    </WidgetFrame>
  );
}
