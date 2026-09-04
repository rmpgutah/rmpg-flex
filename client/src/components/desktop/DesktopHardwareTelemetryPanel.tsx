// ============================================================
// RMPG FlexOS — Hardware Telemetry & Device Inspection Matrix
// Matches Subject File / Device Scan Inspector (media_1787226375320.jpg)
// Displays: IP Address, WebRTC Local IPs, Geo Location, Geo Coords,
// Platform, Viewport, Touch Points, GPU, Canvas Fingerprint, etc.
// ============================================================

import React, { useState, useEffect } from 'react';
import { Cpu, Globe, Shield, Smartphone, HardDrive, Monitor, CheckCircle2, Clock } from 'lucide-react';

export interface HardwareTelemetryData {
  ipAddress: string;
  geoLocation: string;
  geoCoords: string;
  geoSource: string;
  localIpsWebRTC: string[];
  platform: string;
  language: string;
  timezone: string;
  screenSpec: string;
  viewport: string;
  touchPoints: number;
  pointer: string;
  cpuCores: number;
  colorGamut: string;
  darkMode: boolean;
  gpu: string;
  canvasFingerprint: string;
  timeOnPage: number;
  pdfSupport: boolean;
}

export default function DesktopHardwareTelemetryPanel() {
  const [telemetry, setTelemetry] = useState<HardwareTelemetryData>({
    ipAddress: '2.56.189.244',
    geoLocation: 'Dallas, US',
    geoCoords: '32.7831, -96.8067',
    geoSource: 'IP',
    localIpsWebRTC: ['2.56.189.244'],
    platform: 'iPhone / Toughbook FZ-55',
    language: 'en-US',
    timezone: 'America/Denver',
    screenSpec: `${window.screen.width}x${window.screen.height} @${window.devicePixelRatio || 1}x`,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    touchPoints: navigator.maxTouchPoints || 5,
    pointer: matchMedia('(pointer: coarse)').matches ? 'Coarse' : 'Fine',
    cpuCores: navigator.hardwareConcurrency || 8,
    colorGamut: 'P3 / sRGB',
    darkMode: true,
    gpu: 'Intel Iris Xe Graphics / Apple GPU',
    canvasFingerprint: '6650319b83cf7bccb86725d9ae721071a92e81',
    timeOnPage: 303,
    pdfSupport: true,
  });

  const [timeSeconds, setTimeSeconds] = useState(303);

  useEffect(() => {
    const id = setInterval(() => setTimeSeconds(s => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      style={{
        background: '#0b1329',
        border: '1px solid rgba(59, 130, 246, 0.2)',
        color: '#e2e8f0',
        padding: 20,
        fontFamily: 'Arial, sans-serif',
        fontSize: 11,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 10, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Shield style={{ width: 16, height: 16, color: '#38bdf8' }} />
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-primary)', textTransform: 'uppercase' }}>
            SCAN #6 MOBILE — HARDWARE & TELEMETRY MATRIX
          </span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Clock style={{ width: 12, height: 12 }} /> TIME ON PAGE: {timeSeconds}s
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Column 1 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>IP ADDRESS</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#fbbf24', marginTop: 2 }}>{telemetry.ipAddress}</div>
          </div>

          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>GEO COORDS</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{telemetry.geoCoords}</div>
          </div>

          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>LOCAL IPS (WEBRTC)</div>
            <div style={{ fontSize: 11, color: '#38bdf8', fontFamily: 'Arial, sans-serif', marginTop: 2 }}>
              {JSON.stringify(telemetry.localIpsWebRTC)}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>PLATFORM</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{telemetry.platform}</div>
          </div>

          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>TIMEZONE</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{telemetry.timezone}</div>
          </div>

          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>VIEWPORT</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{telemetry.viewport}</div>
          </div>

          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>POINTER</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{telemetry.pointer}</div>
          </div>

          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>COLOR GAMUT</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{telemetry.colorGamut}</div>
          </div>

          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>GPU</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{telemetry.gpu}</div>
          </div>
        </div>

        {/* Column 2 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>GEO LOCATION</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginTop: 2 }}>{telemetry.geoLocation}</div>
          </div>

          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>GEO SOURCE</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{telemetry.geoSource}</div>
          </div>

          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>LANGUAGE</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{telemetry.language}</div>
          </div>

          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>SCREEN SPEC</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{telemetry.screenSpec}</div>
          </div>

          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>TOUCH POINTS</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{telemetry.touchPoints}</div>
          </div>

          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>CPU CORES</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{telemetry.cpuCores} Cores</div>
          </div>

          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>DARK MODE</div>
            <div style={{ fontSize: 12, color: '#10b981', marginTop: 2 }}>{telemetry.darkMode ? 'Yes' : 'No'}</div>
          </div>

          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>PDF SUPPORT</div>
            <div style={{ fontSize: 12, color: '#10b981', marginTop: 2 }}>{telemetry.pdfSupport ? 'Yes' : 'No'}</div>
          </div>

          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>CANVAS FINGERPRINT</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'Arial, sans-serif', wordBreak: 'break-all', marginTop: 2 }}>
              {telemetry.canvasFingerprint}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
