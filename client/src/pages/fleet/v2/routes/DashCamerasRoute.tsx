import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../../../hooks/useApi';
import { FleetListShell } from '../shell/FleetListShell';
import { useFleetV2View } from '../hooks/useFleetV2Audit';
import { safeDateStr, safeDateTimeStr } from '../../../../utils/dateUtils';

interface CameraRow {
  id: number;
  vehicle_id?: number | null;
  serial_number?: string | null;
  model?: string | null;
  status?: string | null;
  installed_date?: string | null;
  last_seen?: string | null;
}
interface VideoRow {
  id: number;
  vehicle_id?: number | null;
  recorded_at?: string | null;
  duration_seconds?: number | null;
  trigger?: string | null;
  filename?: string | null;
}

export function DashCamerasRoute() {
  useFleetV2View('/fleet/v2/dash-cameras');
  const [cameras, setCameras] = useState<CameraRow[]>([]);
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      apiFetch<CameraRow[]>('/fleet/dash-cameras'),
      apiFetch<VideoRow[]>('/fleet/dashcam-videos'),
    ]).then(([c, v]) => {
      if (cancelled) return;
      if (c.status === 'fulfilled' && Array.isArray(c.value)) setCameras(c.value);
      if (v.status === 'fulfilled' && Array.isArray(v.value)) setVideos(v.value);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const filteredVideos = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...videos].sort((a, b) =>
      (b.recorded_at ?? '').localeCompare(a.recorded_at ?? '')
    );
    if (!q) return sorted.slice(0, 100);
    return sorted.filter((v) =>
      [v.trigger, v.filename].filter(Boolean).join(' ').toLowerCase().includes(q)
    ).slice(0, 100);
  }, [videos, search]);

  if (loading) return (
    <FleetListShell title="Dash Cameras" searchPlaceholder="Search videos…" onSearchChange={setSearch}>
      <div className="p-4 text-sm text-rmpg-400">Loading dash cameras…</div>
    </FleetListShell>
  );

  return (
    <FleetListShell
      title="Dash Cameras"
      searchPlaceholder="Search videos by trigger or filename…"
      onSearchChange={setSearch}
    >
      <div className="p-4 space-y-4">
        <section>
          <h3 className="text-[10px] uppercase tracking-wide text-rmpg-400 font-semibold mb-1">
            Cameras · {cameras.length}
          </h3>
          {cameras.length === 0 ? (
            <div className="text-[11px] text-rmpg-400">No dash cameras on file.</div>
          ) : (
            <table className="w-full text-[11px]">
              <thead className="bg-surface-base">
                <tr>
                  <th className="text-left px-2 py-1 font-semibold">Serial</th>
                  <th className="text-left px-2 py-1 font-semibold">Model</th>
                  <th className="text-left px-2 py-1 font-semibold">Status</th>
                  <th className="text-left px-2 py-1 font-semibold">Installed</th>
                  <th className="text-left px-2 py-1 font-semibold">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {cameras.map((c) => (
                  <tr key={c.id} className="border-b border-rmpg-700">
                    <td className="px-2 py-0.5 text-rmpg-100 font-mono">{c.serial_number ?? '—'}</td>
                    <td className="px-2 py-0.5 text-rmpg-300">{c.model ?? '—'}</td>
                    <td className="px-2 py-0.5 text-rmpg-300">{c.status ?? '—'}</td>
                    <td className="px-2 py-0.5 text-rmpg-300">{safeDateStr(c.installed_date)}</td>
                    <td className="px-2 py-0.5 text-rmpg-300">{safeDateTimeStr(c.last_seen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <h3 className="text-[10px] uppercase tracking-wide text-rmpg-400 font-semibold mb-1">
            Recent videos · {filteredVideos.length} of {videos.length}
          </h3>
          {filteredVideos.length === 0 ? (
            <div className="text-[11px] text-rmpg-400">
              {videos.length === 0 ? 'No dashcam videos on file.' : 'No videos match the search.'}
            </div>
          ) : (
            <table className="w-full text-[11px]">
              <thead className="bg-surface-base">
                <tr>
                  <th className="text-left px-2 py-1 font-semibold">Recorded</th>
                  <th className="text-left px-2 py-1 font-semibold">Trigger</th>
                  <th className="text-right px-2 py-1 font-semibold">Duration</th>
                  <th className="text-left px-2 py-1 font-semibold">File</th>
                </tr>
              </thead>
              <tbody>
                {filteredVideos.map((v) => (
                  <tr key={v.id} className="border-b border-rmpg-700">
                    <td className="px-2 py-0.5 text-rmpg-300">{safeDateTimeStr(v.recorded_at)}</td>
                    <td className="px-2 py-0.5 text-rmpg-100">{v.trigger ?? '—'}</td>
                    <td className="px-2 py-0.5 text-right text-rmpg-300">{v.duration_seconds != null ? `${v.duration_seconds}s` : '—'}</td>
                    <td className="px-2 py-0.5 text-rmpg-400 font-mono truncate max-w-xs">{v.filename ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </FleetListShell>
  );
}
