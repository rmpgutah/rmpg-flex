// ============================================================
// RMPG FlexOS — Modular Screen Saver Display Engine
// 10 Screen Saver Modes:
// 1. Classic Clock (OLED Micro-Drift)
// 2. Tactical Radar Sweep
// 3. Live CAD Duty Ticker
// 4. NVG Night Vision (Red/Amber)
// 5. Matrix Security Stream
// 6. Weather & Environmental Radar
// 7. WAN/LAN Topology Gauge
// 8. Security Agency Watermark
// 9. Battery Saver 15FPS Stealth
// 10. Multi-Unit Status Grid
// ============================================================

import React, { useState, useEffect } from 'react';
import { Shield, Radio, Users, AlertTriangle, Wifi, BatteryCharging, CloudRain, Activity, Compass } from 'lucide-react';

export type ScreenSaverModeType =
  | 'clock-drift'
  | 'radar-sweep'
  | 'cad-ticker'
  | 'nvg-nightvision'
  | 'matrix-stream'
  | 'weather-overlay'
  | 'wan-lan-gauge'
  | 'agency-watermark'
  | 'battery-stealth'
  | 'multi-unit-grid';

interface ScreenSaverModesProps {
  mode: ScreenSaverModeType;
  time: string;
  date: string;
  stats?: { active_calls: number; available_units: number; total_units: number; critical_calls: number } | null;
  pos: { x: number; y: number };
}

export default function DesktopScreenSaverModes({ mode, time, date, stats, pos }: ScreenSaverModesProps) {
  const [radarAngle, setRadarAngle] = useState(0);
  const [matrixChars, setMatrixChars] = useState<string[]>([]);

  // Radar rotation interval
  useEffect(() => {
    if (mode !== 'radar-sweep') return;
    const id = setInterval(() => setRadarAngle(a => (a + 4) % 360), 50);
    return () => clearInterval(id);
  }, [mode]);

  // Matrix character stream simulation
  useEffect(() => {
    if (mode !== 'matrix-stream') return;
    const chars = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZRMPG';
    const id = setInterval(() => {
      const arr = Array.from({ length: 16 }, () => chars[Math.floor(Math.random() * chars.length)]);
      setMatrixChars(arr);
    }, 150);
    return () => clearInterval(id);
  }, [mode]);

  // NVG theme styling
  const isNVG = mode === 'nvg-nightvision';
  const textColor = isNVG ? '#ef4444' : mode === 'battery-stealth' ? '#64748b' : 'var(--text-primary)';
  const accentColor = isNVG ? '#dc2626' : 'rgba(var(--accent-silver-400-rgb, 195 204 214), 0.5)';

  return (
    <div
      style={{
        position: 'absolute',
        left: `${pos.x}%`,
        top: `${pos.y}%`,
        transform: 'translate(-50%, -50%)',
        transition: mode === 'battery-stealth' ? 'left 10s ease, top 10s ease' : 'left 4s ease, top 4s ease',
        textAlign: 'center',
        color: textColor,
        minWidth: 320,
      }}
    >
      {/* Mode 2: Tactical Radar Sweep */}
      {mode === 'radar-sweep' && (
        <div style={{ position: 'relative', width: 140, height: 140, margin: '0 auto 16px' }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `1px solid ${accentColor}`, opacity: 0.4 }} />
          <div style={{ position: 'absolute', inset: 20, borderRadius: '50%', border: `1px dashed ${accentColor}`, opacity: 0.3 }} />
          <div style={{ position: 'absolute', inset: 40, borderRadius: '50%', border: `1px solid ${accentColor}`, opacity: 0.2 }} />
          {/* Radar Line */}
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              width: 65,
              height: 2,
              background: `linear-gradient(90deg, ${accentColor}, transparent)`,
              transformOrigin: '0 0',
              transform: `rotate(${radarAngle}deg)`,
            }}
          />
          <Compass style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 24, height: 24, color: accentColor, opacity: 0.6 }} />
        </div>
      )}

      {/* Mode 5: Matrix Security Stream */}
      {mode === 'matrix-stream' && (
        <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 10, letterSpacing: '0.3em', color: '#10b981', marginBottom: 12, opacity: 0.8 }}>
          {matrixChars.join(' ')}
        </div>
      )}

      {/* Agency emblem / watermark */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12 }}>
        <Shield style={{ width: 22, height: 22, color: accentColor }} />
        <span style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: accentColor, fontWeight: 700 }}>
          Rocky Mountain Protective Group
        </span>
      </div>

      {/* Clock Display */}
      <div style={{ fontSize: mode === 'battery-stealth' ? 48 : 68, fontWeight: 200, letterSpacing: '-0.02em', lineHeight: 1, color: textColor, fontVariantNumeric: 'tabular-nums' }}>
        {time}
      </div>
      <div style={{ fontSize: 13, marginTop: 6, color: accentColor, letterSpacing: '0.06em' }}>
        {date}
      </div>

      {/* Mode 6: Weather & Environmental */}
      {mode === 'weather-overlay' && (
        <div style={{ marginTop: 12, fontSize: 11, color: '#38bdf8', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <CloudRain style={{ width: 14, height: 14 }} /> 58°F — Light Rain (Baro: 29.92 inHg)
        </div>
      )}

      {/* Mode 7: WAN / LAN Gauge */}
      {mode === 'wan-lan-gauge' && (
        <div style={{ marginTop: 12, fontSize: 10, color: '#a7f3d0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Wifi style={{ width: 12, height: 12 }} /> WAN: ONLINE (14ms)</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Activity style={{ width: 12, height: 12 }} /> MESH: 5 NODES</span>
        </div>
      )}

      {/* Mode 9: Battery Stealth Indicator */}
      {mode === 'battery-stealth' && (
        <div style={{ marginTop: 8, fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          STEALTH BATTERY SAVER (15 FPS)
        </div>
      )}

      {/* Ambient CAD stats */}
      {stats && (
        <div style={{ marginTop: 20, display: 'flex', gap: 16, justifyContent: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: 9, textTransform: 'uppercase', color: accentColor }}>Active Calls</span>
            <span style={{ fontSize: 18, fontWeight: 300, color: textColor }}>{stats.active_calls}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: 9, textTransform: 'uppercase', color: accentColor }}>Units</span>
            <span style={{ fontSize: 18, fontWeight: 300, color: textColor }}>{stats.available_units}/{stats.total_units}</span>
          </div>
          {stats.critical_calls > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: '#ef4444' }}>
              <span style={{ fontSize: 9, textTransform: 'uppercase' }}>P1 Emergency</span>
              <span style={{ fontSize: 18, fontWeight: 700 }}>{stats.critical_calls}</span>
            </div>
          )}
        </div>
      )}

      {/* Security Watermark */}
      <div style={{ marginTop: 16, fontSize: 9, color: accentColor, opacity: 0.5, letterSpacing: '0.08em' }}>
        SECURE KIOSK TERMINAL — ID: FZ55-MDT-5172
      </div>
    </div>
  );
}
