// Subject-facing landing page for the Notice of Attempt QR code.
// Reached at /verify?ref=JOB-122 when the subject scans the QR code
// printed on the notice. Calls the public /api/verify route on mount,
// then fires a telemetry POST with passive browser environment data.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:8787' : '';

interface VerifyResponse {
  ok: boolean;
  ref: string;
  scanId: number | null;
  agency: string;
  phone: string;
  website: string;
  message: string;
}

// ── Design tokens — matches the Acknowledgement wizard dark palette ──
// Page: #141414 (same as bg-white override)  |  Card: raised dark surface
const C = {
  pageBg:      '#141414',
  cardBg:      '#1c1c1c',
  cardBorder:  'rgba(255,255,255,0.07)',
  eyebrow:     'rgba(156,163,175,0.65)',
  agencyName:  '#f0f4f9',
  refBadgeBg:  'rgba(255,255,255,0.05)',
  refBadgeBdr: 'rgba(255,255,255,0.12)',
  refBadgeTxt: 'rgba(209,213,219,0.75)',
  verifiedBg:  'rgba(34,197,94,0.1)',
  verifiedBdr: 'rgba(34,197,94,0.25)',
  verifiedTxt: '#4ade80',
  bodyTxt:     'rgba(209,213,219,0.8)',
  divider:     'rgba(255,255,255,0.07)',
  callBtnBg:   '#2563eb',
  callBtnTxt:  '#ffffff',
  callBtnBdr:  'rgba(37,99,235,0.4)',
  locBtnBg:    'rgba(255,255,255,0.04)',
  locBtnTxt:   'rgba(156,163,175,0.7)',
  locBtnBdr:   'rgba(255,255,255,0.1)',
  noteTxt:     'rgba(156,163,175,0.65)',
  footerTxt:   'rgba(156,163,175,0.4)',
  successTxt:  '#4ade80',
  spinnerBdr:  'rgba(255,255,255,0.1)',
  spinnerAcct: 'rgba(255,255,255,0.55)',
};

const S: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100dvh',
    background: C.pageBg,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-start',
    padding: '24px 16px 40px',
    fontFamily: 'Arial, sans-serif',
  },
  card: {
    background: C.cardBg,
    borderRadius: 2,
    padding: '28px 24px 24px',
    maxWidth: 480,
    width: '100%',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    border: `1px solid ${C.cardBorder}`,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.14em',
    color: C.eyebrow,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  agencyName: {
    fontSize: 22,
    fontWeight: 700,
    color: C.agencyName,
    marginBottom: 20,
    lineHeight: 1.2,
  },
  refBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: C.refBadgeBg,
    border: `1px solid ${C.refBadgeBdr}`,
    borderRadius: 4,
    padding: '5px 12px',
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: '0.06em',
    color: C.refBadgeTxt,
    marginBottom: 20,
  },
  verified: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: C.verifiedBg,
    border: `1px solid ${C.verifiedBdr}`,
    borderRadius: 4,
    padding: '8px 12px',
    fontSize: 13,
    color: C.verifiedTxt,
    marginBottom: 18,
  },
  body: {
    fontSize: 14,
    lineHeight: 1.75,
    color: C.bodyTxt,
    marginBottom: 22,
  },
  divider: {
    borderTop: `1px solid ${C.divider}`,
    margin: '20px 0',
  },
  callBtn: {
    display: 'block',
    textAlign: 'center',
    background: C.callBtnBg,
    color: C.callBtnTxt,
    borderRadius: 2,
    padding: '14px 20px',
    textDecoration: 'none',
    fontWeight: 700,
    fontSize: 15,
    letterSpacing: '0.01em',
    border: `1px solid ${C.callBtnBdr}`,
  },
  locBtn: {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    marginTop: 10,
    background: C.locBtnBg,
    color: C.locBtnTxt,
    border: `1px solid ${C.locBtnBdr}`,
    borderRadius: 2,
    padding: '11px 16px',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    textAlign: 'center',
  },
  note: {
    marginTop: 8,
    fontSize: 11,
    color: C.noteTxt,
    textAlign: 'center',
    lineHeight: 1.5,
  },
  footer: {
    marginTop: 22,
    fontSize: 11,
    color: C.footerTxt,
    textAlign: 'center',
    lineHeight: 1.6,
  },
  spinner: {
    width: 20,
    height: 20,
    border: `2px solid ${C.spinnerBdr}`,
    borderTopColor: C.spinnerAcct,
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
    margin: '0 auto',
  },
};

// ── Canvas fingerprint (SHA-256 of drawn pixel data) ─────────
async function canvasFingerprint(): Promise<string | null> {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.textBaseline = 'top';
    ctx.font = "14px 'Arial'";
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('RMPG-QR-7Cwpx!', 2, 15);
    ctx.fillStyle = 'rgba(102,204,0,0.7)';
    ctx.fillText('RMPG-QR-7Cwpx!', 4, 17);
    const buf = new TextEncoder().encode(canvas.toDataURL());
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
}

function webglInfo(): { vendor: string | null; renderer: string | null } {
  try {
    const gl = document
      .createElement('canvas')
      .getContext('webgl') as WebGLRenderingContext | null;
    if (!gl) return { vendor: null, renderer: null };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext
      ? {
          vendor: gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) as string,
          renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string,
        }
      : {
          vendor: gl.getParameter(gl.VENDOR) as string,
          renderer: gl.getParameter(gl.RENDERER) as string,
        };
  } catch {
    return { vendor: null, renderer: null };
  }
}

function collectLocalIps(): Promise<string[]> {
  return new Promise((resolve) => {
    try {
      const ips = new Set<string>();
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      pc.createDataChannel('');
      pc.onicecandidate = (e) => {
        if (!e.candidate) {
          pc.close();
          resolve(Array.from(ips));
          return;
        }
        const m = /(?:^|[^:])(\b\d{1,3}(?:\.\d{1,3}){3}\b)/.exec(
          e.candidate.candidate,
        );
        if (m && !m[1].startsWith('0.')) ips.add(m[1]);
      };
      pc.createOffer().then((o) => pc.setLocalDescription(o));
      setTimeout(() => {
        try {
          pc.close();
        } catch {
          /* noop */
        }
        resolve(Array.from(ips));
      }, 3000);
    } catch {
      resolve([]);
    }
  });
}

async function batteryInfo(): Promise<{
  level: number | null;
  charging: boolean | null;
}> {
  try {
    type Batt = { level: number; charging: boolean };
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<Batt>;
    };
    if (!nav.getBattery) return { level: null, charging: null };
    const b = await nav.getBattery();
    return { level: b.level, charging: b.charging };
  } catch {
    return { level: null, charging: null };
  }
}

async function collectRichDetails() {
  const [fp, batt, localIps] = await Promise.all([
    canvasFingerprint(),
    batteryInfo(),
    collectLocalIps(),
  ]);
  const gpu = webglInfo();
  const conn = (
    navigator as Navigator & {
      connection?: { downlink?: number; rtt?: number; saveData?: boolean };
    }
  ).connection;
  const screenOrientation = (() => {
    try {
      return screen.orientation?.type ?? null;
    } catch {
      return null;
    }
  })();
  return {
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    deviceMemory:
      (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
    batteryLevel: batt.level,
    batteryCharging: batt.charging,
    connectionDownlink: conn?.downlink ?? null,
    connectionRtt: conn?.rtt ?? null,
    connectionSaveData: conn?.saveData ?? null,
    screenAvailW: screen.availWidth,
    screenAvailH: screen.availHeight,
    screenOrientation,
    colorGamut: window.matchMedia('(color-gamut: rec2020)').matches
      ? 'rec2020'
      : window.matchMedia('(color-gamut: p3)').matches
        ? 'p3'
        : 'srgb',
    hdrSupport: window.matchMedia('(dynamic-range: high)').matches,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    pointerType: window.matchMedia('(pointer: coarse)').matches
      ? 'coarse'
      : window.matchMedia('(pointer: fine)').matches
        ? 'fine'
        : 'none',
    cookieEnabled: navigator.cookieEnabled,
    doNotTrack: navigator.doNotTrack,
    canvasFingerprint: fp,
    webglVendor: gpu.vendor,
    webglRenderer: gpu.renderer,
    localIps,
    historyLength: window.history.length,
    referrer: document.referrer || null,
    pdfSupport: Array.from(navigator.mimeTypes ?? []).some(
      (m: MimeType) => m.type === 'application/pdf',
    ),
  };
}

// ── Collect passive browser environment data — no permission required.
function collectTelemetry() {
  const nav = navigator as Navigator & {
    connection?: { effectiveType?: string };
    userAgentData?: { platform?: string };
  };
  return {
    screenW:       window.screen.width,
    screenH:       window.screen.height,
    viewportW:     window.innerWidth,
    viewportH:     window.innerHeight,
    pixelRatio:    window.devicePixelRatio,
    colorDepth:    window.screen.colorDepth,
    timezoneIana:  Intl.DateTimeFormat().resolvedOptions().timeZone,
    lang:          navigator.language,
    touchPoints:   navigator.maxTouchPoints,
    connectionType: nav.connection?.effectiveType ?? null,
    darkMode:      window.matchMedia('(prefers-color-scheme: dark)').matches,
    platform:      nav.userAgentData?.platform ?? navigator.platform ?? null,
  };
}

export default function VerifyNoticePage() {
  const [params] = useSearchParams();
  const ref = params.get('ref') ?? '';
  const [data, setData] = useState<VerifyResponse | null>(null);
  const [error, setError] = useState(false);
  const [locState, setLocState] = useState<'idle' | 'requesting' | 'sent' | 'denied'>('idle');
  const scanIdRef = useRef<number | null>(null);
  const pageStartRef = useRef<number>(performance.now());

  const sendTimeOnPage = useCallback(() => {
    const id = scanIdRef.current;
    if (!id) return;
    const ms = Math.round(performance.now() - pageStartRef.current);
    navigator.sendBeacon(
      `${API_BASE}/api/verify/details/timeonpage`,
      JSON.stringify({ scanId: id, ms }),
    );
  }, []);

  // Report time-on-page on hide/unload
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') sendTimeOnPage(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', sendTimeOnPage);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', sendTimeOnPage);
    };
  }, [sendTimeOnPage]);

  useEffect(() => {
    if (!ref) { setError(true); return; }
    fetch(`${API_BASE}/api/verify?ref=${encodeURIComponent(ref)}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((d: VerifyResponse) => {
        setData(d);
        scanIdRef.current = d.scanId ?? null;
        if (!d.scanId) return;
        // 1. Passive telemetry — synchronous, no prompts
        fetch(`${API_BASE}/api/verify/telemetry`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scanId: d.scanId, ...collectTelemetry() }),
        }).catch(() => {/* best-effort */});
        // 2. Rich async details — fire after Battery/WebRTC/Canvas resolve
        collectRichDetails().then(details => {
          fetch(`${API_BASE}/api/verify/details`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scanId: d.scanId, ...details }),
          }).catch(() => {/* best-effort */});
        });
      })
      .catch(() => setError(true));
  }, [ref]);

  function requestLocation() {
    if (!navigator.geolocation) { setLocState('denied'); return; }
    setLocState('requesting');
    navigator.geolocation.getCurrentPosition(
      ({ coords: { latitude: lat, longitude: lon, accuracy } }) => {
        fetch(`${API_BASE}/api/verify/location`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scanId: scanIdRef.current, lat, lon, accuracy }),
        }).catch(() => {/* best-effort */});
        setLocState('sent');
      },
      () => setLocState('denied'),
      { timeout: 10000, maximumAge: 60000 },
    );
  }

  const keyframes = `@keyframes spin { to { transform: rotate(360deg) } }`;

  const pageHeader = (
    <div style={{
      width: '100%',
      maxWidth: 480,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 4px',
      marginBottom: 8,
      borderBottom: `1px solid ${C.divider}`,
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.eyebrow }}>RMPG</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: C.bodyTxt }}>Notice of Attempt</span>
      <span style={{ width: 36 }} />
    </div>
  );

  if (error) {
    return (
      <div style={S.page}>
        <style>{keyframes}</style>
        {pageHeader}
        <div style={S.card}>
          <div style={S.eyebrow}>State of Utah · Private Process Server</div>
          <div style={S.agencyName}>Rocky Mountain Protective Group</div>
          <p style={S.body}>
            This QR code could not be verified. Please call{' '}
            <a href="tel:+13853406555" style={{ color: C.agencyName }}>(385) 340-6555</a>{' '}
            to confirm the notice is genuine.
          </p>
          <div style={S.footer}>
            Process service pursuant to Utah R. Civ. P. 4 and Utah Code § 78B-8-302
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={S.page}>
        <style>{keyframes}</style>
        {pageHeader}
        <div style={{ ...S.card, textAlign: 'center', padding: '40px 24px' }}>
          <div style={S.spinner} />
          <div style={{ marginTop: 16, color: C.noteTxt, fontSize: 13 }}>
            Verifying notice…
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={S.page}>
      <style>{keyframes}</style>
      {pageHeader}
      <div style={S.card}>
        <div style={S.eyebrow}>State of Utah · Private Process Server</div>
        <div style={S.agencyName}>{data.agency}</div>

        {ref && <div style={S.refBadge}>REF: {ref}</div>}

        <div style={S.verified}>
          <span style={{ fontSize: 15 }}>✓</span>
          Notice verified — this is a genuine legal document.
        </div>

        <p style={S.body}>{data.message}</p>

        <div style={S.divider} />

        <a href={`tel:${data.phone.replace(/\D/g, '')}`} style={S.callBtn}>
          Call {data.phone}
        </a>

        {locState === 'idle' && scanIdRef.current !== null && (
          <>
            <button style={S.locBtn} onClick={requestLocation}>
              📍 Share location to help coordinate delivery
            </button>
            <div style={S.note}>
              Optional · your browser will ask for permission
            </div>
          </>
        )}
        {locState === 'requesting' && (
          <div style={{ ...S.note, marginTop: 14 }}>Waiting for permission…</div>
        )}
        {locState === 'sent' && (
          <div style={{ ...S.note, marginTop: 14, color: C.successTxt }}>
            ✓ Location shared.
          </div>
        )}
        {locState === 'denied' && (
          <div style={{ ...S.note, marginTop: 14 }}>
            Location not shared — call us to arrange delivery.
          </div>
        )}

        <div style={{
          marginTop: 18,
          padding: '12px 14px',
          background: 'rgba(0,0,0,0.18)',
          border: `1px solid ${C.divider}`,
          borderRadius: 4,
          fontSize: 11,
          color: C.footerTxt,
          lineHeight: 1.65,
        }}>
          <strong style={{ color: C.noteTxt, display: 'block', marginBottom: 3 }}>
            Data Collection Notice
          </strong>
          Accessing this verification page constitutes acknowledgment that Rocky Mountain
          Protective Group may collect your device&rsquo;s IP address, approximate location,
          browser and device information, and time of access in connection with this active
          process service matter pursuant to Utah Code § 78B-8-302. This information is
          used solely for service-of-process record-keeping and officer safety purposes.
        </div>

        <div style={S.footer}>
          Process service pursuant to Utah R. Civ. P. 4 and Utah Code § 78B-8-302
        </div>
      </div>
    </div>
  );
}
