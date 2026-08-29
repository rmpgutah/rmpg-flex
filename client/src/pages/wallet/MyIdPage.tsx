import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { importWithRetry } from '../../utils/importWithRetry';

// MyIdPage — the officer's own digital ID badge with a live, rotating QR.
// GET /api/wallet/me lazily issues the credential and returns the badge + a
// fresh QR token; the QR is re-minted every 30s from /api/wallet/qr-token so a
// shared screenshot stops verifying quickly. Pure-black Spillman theme.

interface Badge {
  user_id: number;
  full_name: string;
  badge_number: string | null;
  rank: string | null;
  department: string | null;
  employee_id: string | null;
  hire_date: string | null;
  photo: string | null; // base64 data URL or http(s) url
  officer_status: string;
}

interface MeResponse {
  wallet_id: string;
  credential_status: string;
  qr_token: string;
  badge: Badge;
}

const QR_REFRESH_MS = 30_000;

export default function MyIdPage() {
  const [badge, setBadge] = useState<Badge | null>(null);
  const [credentialStatus, setCredentialStatus] = useState<string>('active');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [qrFailed, setQrFailed] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const tokenTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function renderQr(token: string) {
    try {
      const QRCode = (await importWithRetry(() => import('qrcode'))).default;
      const url = await QRCode.toDataURL(token, { margin: 1, width: 260, errorCorrectionLevel: 'M' });
      setQrDataUrl(url);
      setQrFailed(false);
    } catch {
      setQrFailed(true);
    }
  }

  // Initial load: badge + first token.
  useEffect(() => {
    let alive = true;
    setError('');
    apiFetch<MeResponse>('/wallet/me')
      .then((data) => {
        if (!alive) return;
        setBadge(data.badge);
        setCredentialStatus(data.credential_status);
        renderQr(data.qr_token);
      })
      .catch(() => alive && setError('Could not load your ID. Try again.'));
    return () => { alive = false; };
  }, [reloadTick]);

  // Rotate the QR every 30s.
  useEffect(() => {
    if (!badge) return;
    tokenTimer.current = setInterval(() => {
      apiFetch<{ qr_token: string }>('/wallet/qr-token')
        .then((d) => renderQr(d.qr_token))
        .catch(() => { /* keep the last QR; next tick retries */ });
    }, QR_REFRESH_MS);
    return () => { if (tokenTimer.current) clearInterval(tokenTimer.current); };
  }, [badge]);

  if (error) {
    return (
      <div className="p-4 text-sm text-fg-muted space-y-2" role="alert">
        <p>{error}</p>
        <button type="button" className="toolbar-btn" onClick={() => setReloadTick((n) => n + 1)}>Retry</button>
      </div>
    );
  }
  if (!badge) {
    return <div className="p-4 text-sm text-fg-muted" role="status">Loading your ID…</div>;
  }

  const isActive = credentialStatus === 'active' && badge.officer_status === 'active';

  return (
    <div className="p-4 flex justify-center">
      <div className="w-full max-w-sm rounded-[2px] border border-border-default bg-surface-sunken overflow-hidden">
        {/* Header band */}
        <div className="bg-surface-base border-b border-border-default px-4 py-3 flex items-center justify-between">
          <div className="text-[color:var(--panel-header-color)] font-semibold tracking-wide text-sm">RMPG OFFICER ID</div>
          <span
            className={`text-[10px] font-semibold px-2 py-[2px] rounded-[2px] ${
              isActive ? 'bg-[rgb(var(--sev-ok-rgb)/0.12)] text-[color:var(--sev-ok)]' : 'bg-[rgb(var(--sev-critical-rgb)/0.12)] text-[color:var(--sev-critical)]'
            }`}
          >
            {isActive ? 'ACTIVE' : 'INACTIVE'}
          </span>
        </div>

        {/* Identity */}
        <div className="px-4 py-4 flex gap-4">
          <div className="w-24 h-28 flex-shrink-0 rounded-[2px] border border-border-default bg-surface-overlay overflow-hidden flex items-center justify-center">
            {badge.photo ? (
              <img src={badge.photo} alt={badge.full_name} className="w-full h-full object-cover" />
            ) : (
              <span className="text-rmpg-700 text-xs">NO PHOTO</span>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="text-rmpg-100 font-semibold text-base leading-tight">{badge.full_name}</div>
            <Field label="Badge" value={badge.badge_number} />
            <Field label="Rank" value={badge.rank} />
            <Field label="Dept" value={badge.department} />
            {badge.employee_id && <Field label="Emp ID" value={badge.employee_id} />}
          </div>
        </div>

        {/* Live QR */}
        <div className="px-4 pb-4">
          <div className="rounded-[2px] border border-border-default bg-white p-3 flex items-center justify-center">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="Verification QR" width={260} height={260} />
            ) : (
              <div className="w-[260px] h-[260px] flex items-center justify-center text-fg-muted text-xs">
                {qrFailed ? 'Could not draw QR. It will retry on the next refresh.' : 'Generating QR…'}
              </div>
            )}
          </div>
          <div className="text-[10px] text-rmpg-500 text-center mt-2">
            Refreshes automatically · present to an RMPG verifier
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex gap-2 text-[11px]">
      <span className="text-rmpg-500 w-12 flex-shrink-0">{label}</span>
      <span className="text-rmpg-300 truncate">{value || '—'}</span>
    </div>
  );
}
