// ============================================================
// RMPG Flex — Video HUD Overlay (Live CSS Preview)
// ============================================================
// Renders a police-style data overlay on top of the <video>
// element using CSS positioning. Mirrors the FFmpeg burned
// overlay layout so users see a real-time preview before
// server-side processing completes.
//
// All sizes and positions scale proportionally with the
// container width (baseline: 900px = scale 1.0).
// ============================================================

import React, { useEffect, useRef, useState, useCallback } from 'react';

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

// ── Scaling ─────────────────────────────────────────────────

const BASE_WIDTH = 900; // Reference container width for scale 1.0

/** Hook to observe container width and compute scale factor */
function useContainerScale(containerRef: React.RefObject<HTMLDivElement | null>): number {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) setScale(Math.max(0.5, w / BASE_WIDTH));
      }
    });

    observer.observe(el);
    // Initial measurement
    setScale(Math.max(0.5, el.clientWidth / BASE_WIDTH));
    return () => observer.disconnect();
  }, [containerRef]);

  return scale;
}

/** Scale a pixel value */
function sp(base: number, scale: number): number {
  return Math.round(base * scale * 10) / 10;
}

// ── Shared Styles ───────────────────────────────────────────

function lineBase(scale: number): React.CSSProperties {
  return {
    fontFamily: 'Consolas, "Courier New", monospace',
    background: 'rgba(0,0,0,0.65)',
    padding: `${sp(3, scale)}px ${sp(8, scale)}px`,
    whiteSpace: 'nowrap',
    lineHeight: 1.4,
  };
}

// ── Component ───────────────────────────────────────────────

export default function VideoHudOverlay(props: VideoHudOverlayProps) {
  const { type, visible, videoRef, recordedAt } = props;
  const timestampRef = useRef<HTMLSpanElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const scale = useContainerScale(overlayRef);

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
    return <BodyCamHud {...props} agency={agency} timestampRef={timestampRef} overlayRef={overlayRef} scale={scale} />;
  }
  return <DashCamHud {...props} agency={agency} timestampRef={timestampRef} overlayRef={overlayRef} scale={scale} />;
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
  overlayRef,
  scale,
}: VideoHudOverlayProps & {
  agency: string;
  timestampRef: React.RefObject<HTMLSpanElement | null>;
  overlayRef: React.RefObject<HTMLDivElement | null>;
  scale: number;
}) {
  const cls = (classification || 'routine').toUpperCase();
  const classColor = { EVIDENCE: '#ffff00', FLAGGED: '#ffa500', RESTRICTED: '#ff4444', ROUTINE: '#ffffff' }[cls] || '#ffffff';
  const event = (eventType || 'MANUAL').toUpperCase();
  const bat = batteryPercent ?? 100;
  const stor = storageGb ?? 32.0;
  const badge = badgeNumber ? ` #${badgeNumber}` : '';
  const cam = cameraSerial ? `: ${cameraSerial}` : '';
  const caseStr = caseNumber ? ` | CASE: ${caseNumber}` : '';
  const lb = lineBase(scale);

  return (
    <div ref={overlayRef as React.LegacyRef<HTMLDivElement>} style={{
      position: 'absolute', inset: 0, pointerEvents: 'none',
      border: '1px solid rgba(255,165,0,0.4)',
      margin: 2, overflow: 'hidden',
    }}>
      {/* Top-left block */}
      <div style={{ position: 'absolute', top: `${sp(8, scale)}px`, left: `${sp(10, scale)}px`, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ ...lb, fontSize: sp(16, scale), color: '#fff', background: 'rgba(0,0,0,0.70)', padding: `${sp(4, scale)}px ${sp(10, scale)}px` }}>
          {agency}
        </span>
        <span style={{ ...lb, fontSize: sp(11, scale), color: '#fff' }}>
          BWC | OFC. {(officerName || 'UNKNOWN').toUpperCase()}{badge} | CAM{cam}
        </span>
        <span ref={timestampRef as React.LegacyRef<HTMLSpanElement>} style={{ ...lb, fontSize: sp(16, scale), color: '#fff', background: 'rgba(0,0,0,0.70)', padding: `${sp(4, scale)}px ${sp(10, scale)}px` }}>
          --/--/---- --:--:--H
        </span>
        <span style={{ ...lb, fontSize: sp(10.5, scale), color: '#00ff00' }}>
          * {event}{caseStr}
        </span>
        <span style={{ ...lb, fontSize: sp(11, scale), color: classColor }}>
          CLASSIFICATION: {cls}
        </span>
      </div>

      {/* Top-right: REC indicator */}
      <RecIndicator scale={scale} />

      {/* Bottom-right: Battery / Storage */}
      <div style={{ position: 'absolute', bottom: `${sp(8, scale)}px`, right: `${sp(10, scale)}px` }}>
        <span style={{ ...lb, fontSize: sp(9, scale), color: '#00ff00', background: 'rgba(0,0,0,0.55)' }}>
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
  overlayRef,
  scale,
}: VideoHudOverlayProps & {
  agency: string;
  timestampRef: React.RefObject<HTMLSpanElement | null>;
  overlayRef: React.RefObject<HTMLDivElement | null>;
  scale: number;
}) {
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
  const lb = lineBase(scale);

  return (
    <div ref={overlayRef as React.LegacyRef<HTMLDivElement>} style={{
      position: 'absolute', inset: 0, pointerEvents: 'none',
      border: '1px solid rgba(255,165,0,0.4)',
      margin: 2, overflow: 'hidden',
    }}>
      {/* Top-left block */}
      <div style={{ position: 'absolute', top: `${sp(8, scale)}px`, left: `${sp(10, scale)}px`, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ ...lb, fontSize: sp(16, scale), color: '#fff', background: 'rgba(0,0,0,0.70)', padding: `${sp(4, scale)}px ${sp(10, scale)}px` }}>
          {agency}
        </span>
        <span style={{ ...lb, fontSize: sp(11, scale), color: '#fff' }}>
          {camId} | UNIT{unit} | VEH{veh}
        </span>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 0 }}>
          <span ref={timestampRef as React.LegacyRef<HTMLSpanElement>} style={{ ...lb, fontSize: sp(17, scale), color: '#fff', background: 'rgba(0,0,0,0.70)', padding: `${sp(4, scale)}px ${sp(10, scale)}px` }}>
            --/--/---- --:--:--H
          </span>
          {speed && (
            <span style={{ ...lb, fontSize: sp(13, scale), color: '#00ff00', background: 'rgba(0,0,0,0.70)', padding: `${sp(4, scale)}px ${sp(8, scale)}px` }}>
              {speed.replace(' | ', '')}
            </span>
          )}
        </span>
        <span style={{ ...lb, fontSize: sp(9, scale), color: '#00ff00' }}>
          REC * | MIC: {mic} | GPS: {gps} | CAM: {cam}
        </span>
      </div>

      {/* Top-right: REC indicator */}
      <RecIndicator scale={scale} />

      {/* Bottom-left block */}
      <div style={{ position: 'absolute', bottom: `${sp(8, scale)}px`, left: `${sp(10, scale)}px`, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ ...lb, fontSize: sp(10.5, scale), color: '#00ffff' }}>
          {coordStr}
        </span>
        <span style={{ ...lb, fontSize: sp(10.5, scale), color: '#fff' }}>
          {addr}
        </span>
      </div>
    </div>
  );
}

// ── Blinking REC Indicator ──────────────────────────────────

function RecIndicator({ scale }: { scale: number }) {
  const lb = lineBase(scale);
  return (
    <div style={{ position: 'absolute', top: `${sp(8, scale)}px`, right: `${sp(10, scale)}px` }}>
      <span style={{
        ...lb,
        fontSize: sp(11, scale),
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
