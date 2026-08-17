import React, { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../../../hooks/useApi';

interface IncidentCall {
  id: number;
  latitude?: number | string | null;
  longitude?: number | string | null;
  lat?: number | string | null;
  lng?: number | string | null;
}

const CANVAS_W = 180;
const CANVAS_H = 140;

function drawHeatmap(canvas: HTMLCanvasElement, calls: IncidentCall[]) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = 'var(--surface-base, #22405f)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const points: { lat: number; lng: number }[] = [];
  for (const c of calls) {
    const lat = parseFloat(String(c.latitude ?? c.lat ?? ''));
    const lng = parseFloat(String(c.longitude ?? c.lng ?? ''));
    if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
      points.push({ lat, lng });
    }
  }

  if (points.length === 0) return;

  const minLat = Math.min(...points.map(p => p.lat));
  const maxLat = Math.max(...points.map(p => p.lat));
  const minLng = Math.min(...points.map(p => p.lng));
  const maxLng = Math.max(...points.map(p => p.lng));

  const GRID = 0.01;
  const density = new Map<string, number>();
  for (const p of points) {
    const key = `${Math.floor(p.lat / GRID)},${Math.floor(p.lng / GRID)}`;
    density.set(key, (density.get(key) ?? 0) + 1);
  }

  const maxDensity = Math.max(...Array.from(density.values()), 1);
  const latRange = maxLat - minLat || 0.1;
  const lngRange = maxLng - minLng || 0.1;

  for (const [key, count] of density.entries()) {
    const [gridLat, gridLng] = key.split(',').map(Number);
    const cellLat = gridLat * GRID + GRID / 2;
    const cellLng = gridLng * GRID + GRID / 2;
    const px = ((cellLng - minLng) / lngRange) * (CANVAS_W - 10) + 5;
    const py = ((maxLat - cellLat) / latRange) * (CANVAS_H - 10) + 5;
    const alpha = (count / maxDensity) * 0.85 + 0.15;
    ctx.fillStyle = `rgba(239, 68, 68, ${alpha})`;
    const size = Math.max(4, Math.min(16, 4 + (count / maxDensity) * 12));
    ctx.fillRect(px - size / 2, py - size / 2, size, size);
  }
}

export default function DesktopHotZonesWidget() {
  const [calls, setCalls] = useState<IncidentCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  async function load() {
    try {
      const data = await apiFetch<IncidentCall[]>('/dispatch/calls?status=closed&limit=200');
      setCalls(Array.isArray(data) ? data : []);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const iv = setInterval(load, 5 * 60_000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (canvasRef.current && !loading) {
      drawHeatmap(canvasRef.current, calls);
    }
  }, [calls, loading]);

  return (
    <div style={{ padding: '6px 8px', background: 'var(--surface-raised)', border: '1px solid var(--border-default)', borderRadius: 2 }}>
      <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
        HOT ZONES
      </div>
      {loading ? (
        <div style={{ width: CANVAS_W, height: CANVAS_H, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>Loading…</span>
        </div>
      ) : error ? (
        <div style={{ width: CANVAS_W, height: CANVAS_H, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>Unable to load</span>
        </div>
      ) : (
        <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} style={{ borderRadius: 2, display: 'block' }} />
      )}
      <div style={{ fontSize: 8, color: 'var(--text-secondary)', marginTop: 2 }}>
        {calls.length} recent incidents
      </div>
    </div>
  );
}
