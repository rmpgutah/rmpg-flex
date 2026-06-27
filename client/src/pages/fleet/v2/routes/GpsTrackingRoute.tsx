import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetchV2 } from '../hooks/apiFetchV2';
import { FleetListShell } from '../shell/FleetListShell';
import { useFleetV2View } from '../hooks/useFleetV2Audit';
import { safeDateTimeStr } from '../../../../utils/dateUtils';

interface GpsVehicle {
  id?: number | string | null;
  device_id?: string | null;
  vehicle_id?: number | null;
  rmpg_vehicle_id?: number | null;
  vehicle_name?: string | null;
  name?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  speed_mph?: number | null;
  speed?: number | null;
  heading?: number | null;
  last_seen?: string | null;
  last_update?: string | null;
}

export function GpsTrackingRoute() {
  useFleetV2View('/fleet/v2/gps');
  const [rows, setRows] = useState<GpsVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    apiFetchV2<GpsVehicle[] | { vehicles: GpsVehicle[] }>('/clearpathgps/vehicles')
      .then((r) => {
        if (cancelled) return;
        const arr = Array.isArray(r) ? r : (r && 'vehicles' in r && Array.isArray((r as { vehicles: GpsVehicle[] }).vehicles)) ? (r as { vehicles: GpsVehicle[] }).vehicles : [];
        setRows(arr);
      })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.vehicle_name, r.name, r.device_id].filter(Boolean).join(' ').toLowerCase().includes(q)
    );
  }, [rows, search]);

  return (
    <FleetListShell
      title="GPS Tracking"
      searchPlaceholder="Search by vehicle or device id…"
      onSearchChange={setSearch}
    >
      <div className="px-4 py-2 border-b border-rmpg-700 bg-surface-raised text-[10px] text-rmpg-400">
        Live positions from ClearPathGPS. Full map view: <Link to="/map" className="text-brand-400 hover:underline">Map page</Link>.
      </div>
      {loading ? (
        <div className="p-4 text-sm text-rmpg-400">Loading vehicle positions…</div>
      ) : filtered.length === 0 ? (
        <div className="p-4 text-sm text-rmpg-400">
          {rows.length === 0 ? 'No GPS-tracked vehicles available.' : 'No vehicles match the search.'}
        </div>
      ) : (
        <table className="w-full text-[11px]">
          <thead className="bg-surface-base sticky top-0">
            <tr>
              <th className="text-left px-3 py-1.5 font-semibold">Vehicle</th>
              <th className="text-left px-3 py-1.5 font-semibold">Device</th>
              <th className="text-right px-3 py-1.5 font-semibold">Lat</th>
              <th className="text-right px-3 py-1.5 font-semibold">Lng</th>
              <th className="text-right px-3 py-1.5 font-semibold">Speed</th>
              <th className="text-left px-3 py-1.5 font-semibold">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => {
              const label = r.vehicle_name ?? r.name ?? r.device_id ?? `Vehicle ${i + 1}`;
              const rmpgId = r.rmpg_vehicle_id ?? r.vehicle_id;
              const speed = r.speed_mph ?? r.speed;
              const lastSeen = r.last_seen ?? r.last_update;
              return (
                <tr key={String(r.id ?? r.device_id ?? i)} className="border-b border-rmpg-700 hover:bg-rmpg-800">
                  <td className="px-3 py-0.5">
                    {rmpgId != null ? (
                      <Link to={`/fleet/v2/vehicles/${rmpgId}`} className="text-rmpg-100 hover:text-brand-400">
                        {label}
                      </Link>
                    ) : <span className="text-rmpg-100">{label}</span>}
                  </td>
                  <td className="px-3 py-0.5 text-rmpg-400 font-mono">{r.device_id ?? '—'}</td>
                  <td className="px-3 py-0.5 text-right text-rmpg-300">{r.latitude != null ? r.latitude.toFixed(5) : '—'}</td>
                  <td className="px-3 py-0.5 text-right text-rmpg-300">{r.longitude != null ? r.longitude.toFixed(5) : '—'}</td>
                  <td className="px-3 py-0.5 text-right text-rmpg-300">{speed != null ? `${Number(speed).toFixed(0)} mph` : '—'}</td>
                  <td className="px-3 py-0.5 text-rmpg-300">{safeDateTimeStr(lastSeen)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </FleetListShell>
  );
}
