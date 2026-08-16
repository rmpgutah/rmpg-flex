// Subject-facing landing page for the Notice of Attempt QR code.
// Reached at /verify?ref=JOB-122 when the subject scans the QR code
// printed on the notice. Calls the public /api/verify route on mount to
// log the scan and notify the assigned process server.

import { useEffect, useRef, useState } from 'react';
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

// ── Styles (inline — this page is intentionally outside the app shell) ──

const S = {
  page: {
    minHeight: '100dvh',
    background: '#1a3050',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px 16px',
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
  },
  card: {
    background: '#22405f',
    borderRadius: 6,
    padding: '28px 24px 24px',
    maxWidth: 480,
    width: '100%',
    boxShadow: '0 8px 32px rgb(0 0 0 / 0.5)',
    border: '1px solid rgb(255 255 255 / 0.08)',
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.14em',
    color: 'rgb(255 255 255 / 0.55)',
    textTransform: 'uppercase' as const,
    marginBottom: 6,
  },
  agencyName: {
    fontSize: 22,
    fontWeight: 700,
    color: '#d9bd72',
    marginBottom: 20,
    lineHeight: 1.2,
  },
  refBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: 'rgb(0 0 0 / 0.25)',
    border: '1px solid rgb(255 255 255 / 0.15)',
    borderRadius: 4,
    padding: '5px 12px',
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: '0.06em',
    color: 'rgb(255 255 255 / 0.85)',
    marginBottom: 20,
  },
  body: {
    fontSize: 14,
    lineHeight: 1.75,
    color: 'rgb(255 255 255 / 0.75)',
    marginBottom: 22,
  },
  divider: {
    borderTop: '1px solid rgb(255 255 255 / 0.1)',
    margin: '20px 0',
  },
  callBtn: {
    display: 'block',
    textAlign: 'center' as const,
    background: '#2d5a8a',
    color: '#fff',
    borderRadius: 5,
    padding: '14px 20px',
    textDecoration: 'none',
    fontWeight: 700,
    fontSize: 16,
    letterSpacing: '0.01em',
    border: '1px solid rgb(255 255 255 / 0.1)',
    transition: 'background 0.15s',
  },
  locationBtn: {
    display: 'block',
    width: '100%',
    marginTop: 10,
    background: 'rgb(255 255 255 / 0.06)',
    color: 'rgb(255 255 255 / 0.65)',
    border: '1px solid rgb(255 255 255 / 0.12)',
    borderRadius: 5,
    padding: '11px 16px',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    textAlign: 'center' as const,
  },
  locationNote: {
    marginTop: 8,
    fontSize: 11,
    color: 'rgb(255 255 255 / 0.35)',
    textAlign: 'center' as const,
    lineHeight: 1.5,
  },
  footer: {
    marginTop: 22,
    fontSize: 11,
    color: 'rgb(255 255 255 / 0.3)',
    textAlign: 'center' as const,
    lineHeight: 1.6,
  },
  verified: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: 'rgb(34 160 100 / 0.15)',
    border: '1px solid rgb(34 160 100 / 0.35)',
    borderRadius: 4,
    padding: '8px 12px',
    fontSize: 13,
    color: '#5de0a0',
    marginBottom: 18,
  },
  spinner: {
    width: 20,
    height: 20,
    border: '2px solid rgb(255 255 255 / 0.15)',
    borderTopColor: '#d9bd72',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
};

export default function VerifyNoticePage() {
  const [params] = useSearchParams();
  const ref = params.get('ref') ?? '';
  const [data, setData] = useState<VerifyResponse | null>(null);
  const [error, setError] = useState(false);
  const [locationState, setLocationState] = useState<'idle' | 'requesting' | 'sent' | 'denied'>('idle');
  const scanIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!ref) { setError(true); return; }
    fetch(`${API_BASE}/api/verify?ref=${encodeURIComponent(ref)}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((d: VerifyResponse) => {
        setData(d);
        scanIdRef.current = d.scanId ?? null;
      })
      .catch(() => setError(true));
  }, [ref]);

  function requestLocation() {
    if (!navigator.geolocation) { setLocationState('denied'); return; }
    setLocationState('requesting');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lon, accuracy } = pos.coords;
        fetch(`${API_BASE}/api/verify/location`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scanId: scanIdRef.current, lat, lon, accuracy }),
        }).catch(() => {/* best-effort */});
        setLocationState('sent');
      },
      () => setLocationState('denied'),
      { timeout: 10000, maximumAge: 60000 },
    );
  }

  if (error) {
    return (
      <div style={S.page}>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <div style={S.card}>
          <div style={S.eyebrow}>State of Utah · Private Process Server</div>
          <div style={S.agencyName}>Rocky Mountain Protective Group</div>
          <p style={S.body}>
            This QR code could not be verified. Please call{' '}
            <a href="tel:+13853406555" style={{ color: '#d9bd72' }}>(385) 340-6555</a>{' '}
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
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <div style={{ ...S.card, textAlign: 'center', padding: '40px 24px' }}>
          <div style={S.spinner} />
          <div style={{ marginTop: 16, color: 'rgb(255 255 255 / 0.45)', fontSize: 13 }}>
            Verifying notice…
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={S.page}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      <div style={S.card}>
        <div style={S.eyebrow}>State of Utah · Private Process Server</div>
        <div style={S.agencyName}>{data.agency}</div>

        {ref && <div style={S.refBadge}>REF: {ref}</div>}

        <div style={S.verified}>
          <span style={{ fontSize: 16 }}>✓</span>
          Notice verified — this is a genuine legal document.
        </div>

        <p style={S.body}>{data.message}</p>

        <div style={S.divider} />

        <a href={`tel:${data.phone.replace(/\D/g, '')}`} style={S.callBtn}>
          Call {data.phone}
        </a>

        {locationState === 'idle' && scanIdRef.current !== null && (
          <>
            <button style={S.locationBtn} onClick={requestLocation}>
              📍 Share approximate location to help us serve you faster
            </button>
            <div style={S.locationNote}>
              Optional — your browser will ask for permission. Used only to coordinate delivery.
            </div>
          </>
        )}

        {locationState === 'requesting' && (
          <div style={{ ...S.locationNote, marginTop: 14, color: 'rgb(255 255 255 / 0.5)' }}>
            Waiting for location permission…
          </div>
        )}

        {locationState === 'sent' && (
          <div style={{ ...S.locationNote, marginTop: 14, color: '#5de0a0' }}>
            ✓ Location shared — our process server has been notified.
          </div>
        )}

        {locationState === 'denied' && (
          <div style={{ ...S.locationNote, marginTop: 14 }}>
            Location not shared — call the number above to arrange delivery.
          </div>
        )}

        <div style={S.footer}>
          Process service pursuant to Utah R. Civ. P. 4 and Utah Code § 78B-8-302
        </div>
      </div>
    </div>
  );
}
