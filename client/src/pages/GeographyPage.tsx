// ============================================================
// RMPG Flex — Geography Page (Phase 2 stub)
//
// Minimal stats-only placeholder so the page doesn't crash between
// Phase 2 (API rewrite) and Phase 3 (full Miller-drilldown rewrite).
// The full 4-column layout lands in Phase 3.
// ============================================================

import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';

interface GeographyStats {
  area_count?: number;
  sector_count?: number;
  zone_count?: number;
  beat_count?: number;
  active_beat_count?: number;
  orphan_beat_count?: number;
}

export default function GeographyPage() {
  const [stats, setStats] = useState<GeographyStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<any>('/dispatch/geography/tree')
      .then((tree: any) => {
        const areas = tree?.areas || [];
        const sectors = areas.flatMap((a: any) => a.sectors || []);
        const zones = sectors.flatMap((s: any) => s.zones || []);
        const beats = zones.flatMap((z: any) => z.beats || []);
        setStats({
          area_count: areas.length,
          sector_count: sectors.length,
          zone_count: zones.length,
          beat_count: beats.length,
        });
      })
      .catch((e) => setError(e?.message || 'Failed to load geography'));
  }, []);

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="DISPATCH GEOGRAPHY" icon={MapPin} />
      <div className="panel-raised p-6 text-center">
        <p className="text-[var(--text-muted)] text-sm">
          Geography admin — 4-column Miller layout arriving in next release.
        </p>
        {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
        {stats && (
          <div className="mt-4 grid grid-cols-4 gap-4 text-center max-w-xl mx-auto">
            <div>
              <div className="text-2xl font-bold text-[#d4a017]">{stats.area_count}</div>
              <div className="text-[10px] text-[var(--text-muted)]">AREAS</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-[#d4a017]">{stats.sector_count}</div>
              <div className="text-[10px] text-[var(--text-muted)]">SECTORS</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-[#d4a017]">{stats.zone_count}</div>
              <div className="text-[10px] text-[var(--text-muted)]">ZONES</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-[#d4a017]">{stats.beat_count}</div>
              <div className="text-[10px] text-[var(--text-muted)]">BEATS</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
