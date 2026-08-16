// Subject-facing landing page for the Notice of Attempt QR code.
// Reached at /verify?ref=JOB-122 when the subject scans the QR code
// printed on the notice. Calls the public /api/verify route on mount to
// log the scan and notify the assigned process server.

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

// Use same-origin relative path in production so the request routes through
// the Pages _redirects proxy (/api/* → api.rmpgutah.us) and bypasses the WAF
// managed challenge (fetch() cannot solve a JS challenge).
const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:8787' : '';

interface VerifyResponse {
  ok: boolean;
  ref: string;
  agency: string;
  phone: string;
  website: string;
  message: string;
}

export default function VerifyNoticePage() {
  const [params] = useSearchParams();
  const ref = params.get('ref') ?? '';
  const [data, setData] = useState<VerifyResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!ref) { setError(true); return; }
    fetch(`${API_BASE}/api/verify?ref=${encodeURIComponent(ref)}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(setData)
      .catch(() => setError(true));
  }, [ref]);

  const containerStyle: React.CSSProperties = {
    minHeight: '100dvh',
    background: '#1a2940',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px 16px',
    fontFamily: 'system-ui, sans-serif',
    color: '#f0f4f9',
  };

  const cardStyle: React.CSSProperties = {
    background: '#22405f',
    borderRadius: 4,
    padding: '28px 24px',
    maxWidth: 480,
    width: '100%',
    boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
    border: '1px solid #2e5278',
  };

  const logoBarStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.12em',
    color: '#c3ccd6',
    marginBottom: 4,
    textTransform: 'uppercase',
  };

  const agencyStyle: React.CSSProperties = {
    fontSize: 17,
    fontWeight: 700,
    color: '#d9bd72',
    marginBottom: 20,
    lineHeight: 1.25,
  };

  const refBadgeStyle: React.CSSProperties = {
    display: 'inline-block',
    background: '#1a2940',
    border: '1px solid #3a6491',
    borderRadius: 3,
    padding: '3px 10px',
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: '0.08em',
    color: '#c3ccd6',
    marginBottom: 18,
  };

  const bodyStyle: React.CSSProperties = {
    fontSize: 14,
    lineHeight: 1.7,
    color: '#d0d8e4',
    marginBottom: 24,
  };

  const dividerStyle: React.CSSProperties = {
    borderTop: '1px solid #2e5278',
    margin: '20px 0',
  };

  const ctaStyle: React.CSSProperties = {
    display: 'block',
    textAlign: 'center',
    background: '#2e5278',
    color: '#f0f4f9',
    borderRadius: 3,
    padding: '13px 20px',
    textDecoration: 'none',
    fontWeight: 600,
    fontSize: 15,
    letterSpacing: '0.02em',
  };

  const footerStyle: React.CSSProperties = {
    marginTop: 20,
    fontSize: 11,
    color: '#7a8fa6',
    textAlign: 'center',
  };

  if (error) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={logoBarStyle}>State of Utah · Private Process Server</div>
          <div style={agencyStyle}>Rocky Mountain Protective Group</div>
          <p style={bodyStyle}>
            This QR code could not be verified. Please call{' '}
            <a href="tel:+13853406555" style={{ color: '#d9bd72' }}>(385) 340-6555</a>{' '}
            to confirm the notice is genuine.
          </p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={containerStyle}>
        <div style={{ color: '#7a8fa6', fontSize: 14 }}>Verifying notice…</div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={logoBarStyle}>State of Utah · Private Process Server</div>
        <div style={agencyStyle}>{data.agency}</div>

        {ref && <span style={refBadgeStyle}>REF: {ref}</span>}

        <p style={bodyStyle}>{data.message}</p>

        <div style={dividerStyle} />

        <a href={`tel:${data.phone.replace(/\D/g, '')}`} style={ctaStyle}>
          Call {data.phone}
        </a>

        <div style={footerStyle}>
          Process service pursuant to Utah R. Civ. P. 4 and Utah Code § 78B-8-302
        </div>
      </div>
    </div>
  );
}
