// ============================================================
// RMPG Flex — Video HUD Overlay (Live CSS Preview)
// ============================================================
// Renders a police-style data overlay on top of the <video>
// element using CSS positioning. Mirrors the FFmpeg burned
// overlay layout so users see a real-time preview before
// server-side processing completes.
// ============================================================

import React, { useEffect, useRef, useCallback } from 'react';

// ── Props ───────────────────────────────────────────────────

export interface VideoHudOverlayProps {
  type: 'bodycam' | 'dashcam';
  visible: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  recordedAt?: string;
  agencyName?: string;
  // Body cam fields
  officerName?: string;
  badgeNumber?: string;
  cameraSerial?: string;
  caseNumber?: string;
  classification?: string;
  eventType?: string;
  batteryPercent?: number;
  storageGb?: number;
  // Dash cam fields
  cameraId?: string;
  unitCallSign?: string;
  vehicleDescription?: string;
  speedMph?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  address?: string;
  micStatus?: string;
  gpsLockStatus?: string;
  cameraPosition?: string;
}

// ── Helpers ─────────────────────────────────────────────────

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatOverlayTimestamp(date: Date): string {
  return `${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}/${date.getFullYear()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}H`;
}

function formatCoord(value: number, posDir: string, negDir: string): string {
  const dir = value >= 0 ? posDir : negDir;
  return `${Math.abs(value).toFixed(4)} ${dir}`;
}

// ── Shared Styles ───────────────────────────────────────────

const LINE_BASE: React.CSSProperties = {
  fontFamily: 'Consolas, "Courier New", monospace',
  background: 'rgba(0,0,0,0.65)',
  padding: '3px 8px',
  whiteSpace: 'nowrap',
  lineHeight: 1.4,
};

// ── Component ───────────────────────────────────────────────

export default function VideoHudOverlay(props: VideoHudOverlayProps) {
  const { type, visible, videoRef, recordedAt } = props;
  const timestampRef = useRef<HTMLSpanElement>(null);
  const animRef = useRef<number>(0);

  // Advancing timestamp synced to video playback
  const updateTimestamp = useCallback(() => {
    const video = videoRef.current;
    if (video && timestampRef.current && recordedAt) {
      const baseTime = new Date(recordedAt).getTime();
      const elapsed = video.currentTime * 1000;
      const now = new Date(baseTime + elapsed);
      timestampRef.current.textContent = formatOverlayTimestamp(now);
    }
    animRef.current = requestAnimationFrame(updateTimestamp);
  }, [videoRef, recordedAt]);

  useEffect(() => {
    if (!visible) return;
    animRef.current = requestAnimationFrame(updateTimestamp);
    return () => cancelAnimationFrame(animRef.current);
  }, [visible, updateTimestamp]);

  if (!visible) return null;

  const agency = (props.agencyName || 'ROCKY MOUNTAIN PROTECTIVE GROUP').toUpperCase();

  if (type === 'bodycam') {
    return <BodyCamHud {...props} agency={agency} timestampRef={timestampRef} />;
  }
  return <DashCamHud {...props} agency={agency} timestampRef={timestampRef} />;
}

// ── Body Camera HUD Layout ─────────────────────────────────

function BodyCamHud({
  agency,
  timestampRef,
  officerName,
  badgeNumber,
  cameraSerial,
  caseNumber,
  classification,
  eventType,
  batteryPercent,
  storageGb,
}: VideoHudOverlayProps & { agency: string; timestampRef: React.RefObject<HTMLSpanElement | null> }) {
  const cls = (classification || 'routine').toUpperCase();
  const classColor = { EVIDENCE: '#ffff00', FLAGGED: '#ffa500', RESTRICTED: '#ff4444', ROUTINE: '#ffffff' }[cls] || '#ffffff';
  const event = (eventType || 'MANUAL').toUpperCase();
  const bat = batteryPercent ?? 100;
  const stor = storageGb ?? 32.0;
  const badge = badgeNumber ? ` #${badgeNumber}` : '';
  const cam = cameraSerial ? `: ${cameraSerial}` : '';
  const caseStr = caseNumber ? ` | CASE: ${caseNumber}` : '';

  return (
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'none',
      border: '1px solid rgba(255,165,0,0.4)',
      margin: 2, overflow: 'hidden',
    }}>
      {/* Top-left block */}
      <div style={{ position: 'absolute', top: 8, left: 10, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ ...LINE_BASE, fontSize: 16, color: '#fff', background: 'rgba(0,0,0,0.70)', padding: '4px 10px' }}>
          {agency}
        </span>
        <span style={{ ...LINE_BASE, fontSize: 11, color: '#fff' }}>
          BWC | OFC. {(officerName || 'UNKNOWN').toUpperCase()}{badge} | CAM{cam}
        </span>
        <span ref={timestampRef as React.LegacyRef<HTMLSpanElement>} style={{ ...LINE_BASE, fontSize: 16, color: '#fff', background: 'rgba(0,0,0,0.70)', padding: '4px 10px' }}>
          --/--/---- --:--:--H
        </span>
        <span style={{ ...LINE_BASE, fontSize: 10.5, color: '#00ff00' }}>
          * {event}{caseStr}
        </span>
        <span style={{ ...LINE_BASE, fontSize: 11, color: classColor }}>
          CLASSIFICATION: {cls}
        </span>
      </div>

      {/* Top-right: REC indicator */}
      <RecIndicator />

      {/* Bottom-right: Battery / Storage */}
      <div style={{ position: 'absolute', bottom: 8, right: 10 }}>
        <span style={{ ...LINE_BASE, fontSize: 9, color: '#00ff00', background: 'rgba(0,0,0,0.55)' }}>
          BAT: {bat}% | STR: {stor.toFixed(1)} GB
        </span>
      </div>
    </div>
  );
}

// ── Dash Camera HUD Layout ──────────────────────────────────

function DashCamHud({
  agency,
  timestampRef,
  cameraId,
  unitCallSign,
  vehicleDescription,
  speedMph,
  latitude,
  longitude,
  address,
  micStatus,
  gpsLockStatus,
  cameraPosition,
}: VideoHudOverlayProps & { agency: string; timestampRef: React.RefObject<HTMLSpanElement | null> }) {
  const camId = cameraId || 'MVR';
  const unit = unitCallSign ? `: ${unitCallSign}` : '';
  const veh = vehicleDescription ? `: ${vehicleDescription.toUpperCase()}` : '';
  const speed = speedMph != null ? ` | SPD: ${speedMph} MPH` : '';
  const mic = (micStatus || 'ON').toUpperCase();
  const gps = (gpsLockStatus || (latitude != null ? 'LOCK' : 'NO FIX')).toUpperCase();
  const cam = (cameraPosition || 'FRONT').toUpperCase();

  const coordStr = latitude != null && longitude != null
    ? `LAT: ${formatCoord(latitude, 'N', 'S')}  LON: ${formatCoord(longitude, 'E', 'W')}`
    : 'NO GPS DATA';

  const addr = address ? address.toUpperCase() : 'NO ADDRESS DATA';

  return (
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'none',
      border: '1px solid rgba(255,165,0,0.4)',
      margin: 2, overflow: 'hidden',
    }}>
      {/* Top-left block */}
      <div style={{ position: 'absolute', top: 8, left: 10, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ ...LINE_BASE, fontSize: 16, color: '#fff', background: 'rgba(0,0,0,0.70)', padding: '4px 10px' }}>
          {agency}
        </span>
        <span style={{ ...LINE_BASE, fontSize: 11, color: '#fff' }}>
          {camId} | UNIT{unit} | VEH{veh}
        </span>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 0 }}>
          <span ref={timestampRef as React.LegacyRef<HTMLSpanElement>} style={{ ...LINE_BASE, fontSize: 17, color: '#fff', background: 'rgba(0,0,0,0.70)', padding: '4px 10px' }}>
            --/--/---- --:--:--H
          </span>
          {speed && (
            <span style={{ ...LINE_BASE, fontSize: 13, color: '#00ff00', background: 'rgba(0,0,0,0.70)', padding: '4px 8px' }}>
              {speed.replace(' | ', '')}
            </span>
          )}
        </span>
        <span style={{ ...LINE_BASE, fontSize: 9, color: '#00ff00' }}>
          REC * | MIC: {mic} | GPS: {gps} | CAM: {cam}
        </span>
      </div>

      {/* Top-right: REC indicator */}
      <RecIndicator />

      {/* Bottom-left block */}
      <div style={{ position: 'absolute', bottom: 8, left: 10, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ ...LINE_BASE, fontSize: 10.5, color: '#00ffff' }}>
          {coordStr}
        </span>
        <span style={{ ...LINE_BASE, fontSize: 10.5, color: '#fff' }}>
          {addr}
        </span>
      </div>
    </div>
  );
}

// ── Blinking REC Indicator ──────────────────────────────────

function RecIndicator() {
  return (
    <div style={{ position: 'absolute', top: 8, right: 10 }}>
      <span style={{
        ...LINE_BASE,
        fontSize: 11,
        color: '#ff0000',
        background: 'rgba(0,0,0,0.50)',
        animation: 'hud-rec-blink 1s step-end infinite',
      }}>
        * REC
      </span>
      <style>{`
        @keyframes hud-rec-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
