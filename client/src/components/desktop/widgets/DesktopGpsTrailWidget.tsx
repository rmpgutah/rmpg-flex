import React, { useState, useEffect } from 'react';
import { MapPin } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { useAuth } from '../../../context/AuthContext';

// Server uses `lng` (Google Maps convention), not `lon`.
interface GpsPoint { lat: number; lng: number; speed?: number | null; }

export default function DesktopGpsTrailWidget() {
  const { user } = useAuth();
  const [trail, setTrail] = useState<GpsPoint[]>([]);

  useEffect(() => {
    if (!user?.id) return;
    async function load() {
      try {
        // Step 1: resolve the officer's unit id (officer_id ≠ unit_id).
        const unitRow = await apiFetch<{ id: number } | null>('/dispatch/gps/my-unit');
        if (!unitRow?.id) return;
        // Step 2: fetch the trail for that unit. /trails returns a bare
        // array of trail objects; each has a `points` array with lat/lng.
        const trails = await apiFetch<Array<{ points: GpsPoint[] }>>(`/dispatch/gps/trails?unit_id=${unitRow.id}&hours=1`);
        if (Array.isArray(trails) && trails[0]?.points) {
          setTrail(trails[0].points.slice(-8));
        }
      } catch { /* offline */ }
    }
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, [user?.id]);

  const latest = trail[0];

  return (
    <div style={{ padding: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <MapPin className="w-3 h-3" style={{ color: 'var(--brand-400)' }} />
        <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.08em' }}>GPS TRAIL</span>
      </div>
      {latest ? (
        <>
          <div style={{ fontSize: 10, color: 'var(--text-primary)' }}>
            {typeof latest.lat === 'number' ? latest.lat.toFixed(5) : '—'},{' '}
            {typeof latest.lng === 'number' ? latest.lng.toFixed(5) : '—'}
          </div>
          {latest.speed != null && (
            <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginTop: 2 }}>{Math.round(latest.speed * 2.23694)} mph</div>
          )}
          <div style={{ display: 'flex', gap: 3, marginTop: 6 }}>
            {trail.map((_, i) => (
              <span
                key={i}
                style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-400)', opacity: 1 - i * 0.12, display: 'inline-block' }}
              />
            ))}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>No trail data</div>
      )}
    </div>
  );
}
