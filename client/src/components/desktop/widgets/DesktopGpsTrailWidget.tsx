import React, { useState, useEffect } from 'react';
import { MapPin } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { useAuth } from '../../../context/AuthContext';

interface GpsPoint { lat: number; lon: number; speed?: number; timestamp: string; }

export default function DesktopGpsTrailWidget() {
  const { user } = useAuth();
  const [trail, setTrail] = useState<GpsPoint[]>([]);

  useEffect(() => {
    if (!user?.id) return;
    async function load() {
      try {
        const r = await apiFetch<{ trail: GpsPoint[] }>(`/dispatch/gps/trail?officer_id=${user!.id}&limit=8`);
        if (r?.trail) setTrail(r.trail);
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
            {typeof latest.lon === 'number' ? latest.lon.toFixed(5) : '—'}
          </div>
          {latest.speed !== undefined && (
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
