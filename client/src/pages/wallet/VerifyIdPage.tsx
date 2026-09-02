import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { decodeQrFrame } from '../../utils/pdf417Decoder';
import { verifyResultDisplay, type VerifyResult } from './verifyDisplay';

// VerifyIdPage — an authenticated RMPG user scans an officer's badge QR (camera,
// with a manual-paste fallback) and gets the verified identity + a clear
// VALID / REVOKED / INACTIVE / RESCAN verdict. Verification is online: the
// server validates the token signature + expiry, then checks live D1 status.

interface OfficerBadge {
  full_name: string;
  badge_number: string | null;
  rank: string | null;
  department: string | null;
  photo: string | null;
  officer_status: string;
}

const SCAN_INTERVAL_MS = 400;

export default function VerifyIdPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [scanning, setScanning] = useState(false);
  const [camError, setCamError] = useState('');
  const [manualToken, setManualToken] = useState('');
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [officer, setOfficer] = useState<OfficerBadge | null>(null);
  const [busy, setBusy] = useState(false);

  function stopCamera() {
    if (scanTimer.current) { clearInterval(scanTimer.current); scanTimer.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    setScanning(false);
  }

  useEffect(() => stopCamera, []); // cleanup on unmount

  async function verifyToken(token: string) {
    if (!token || busy) return;
    setBusy(true);
    try {
      const res = await apiFetch<VerifyResult & { officer?: OfficerBadge }>('/wallet/verify', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      setResult({ valid: res.valid, reason: res.reason });
      setOfficer(res.officer ?? null);
      stopCamera();
    } catch {
      setResult({ valid: false, reason: 'not_found' });
      setOfficer(null);
    } finally {
      setBusy(false);
    }
  }

  async function startCamera() {
    setResult(null);
    setOfficer(null);
    setCamError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);
      const canvas = document.createElement('canvas');
      scanTimer.current = setInterval(async () => {
        const v = videoRef.current;
        if (!v || v.videoWidth === 0) return;
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const text = await decodeQrFrame(imageData);
        if (text) verifyToken(text);
      }, SCAN_INTERVAL_MS);
    } catch {
      setCamError('Camera unavailable. Paste the token below instead.');
    }
  }

  const display = result ? verifyResultDisplay(result) : null;
  const toneBg = display?.tone === 'valid' ? 'bg-[rgb(var(--sev-ok-rgb)/0.12)] text-[color:var(--sev-ok)] border-[color:var(--sev-ok)]'
    : display?.tone === 'expired' ? 'bg-[rgb(var(--sev-warn-rgb)/0.12)] text-[color:var(--field-label-color)] border-[color:var(--sev-warn)]'
    : 'bg-[rgb(var(--sev-critical-rgb)/0.12)] text-[color:var(--sev-critical)] border-[color:var(--sev-critical)]';

  return (
    <div className="p-4 max-w-sm mx-auto space-y-4">
      <div className="text-[color:var(--panel-header-color)] font-semibold tracking-wide text-sm">VERIFY OFFICER ID</div>

      {/* Result */}
      {display && (
        <div className={`rounded-[2px] border px-4 py-3 ${toneBg}`}>
          <div className="font-semibold text-sm">{display.banner}</div>
          <div className="text-[11px] opacity-90 mt-1">{display.detail}</div>
          {officer && (
            <div className="mt-3 flex gap-3 items-center">
              <div className="w-14 h-16 rounded-[2px] border border-border-default bg-surface-overlay overflow-hidden flex-shrink-0 flex items-center justify-center">
                {officer.photo ? <img src={officer.photo} alt={officer.full_name} className="w-full h-full object-cover" />
                  : <span className="text-rmpg-700 text-[9px]">NO PHOTO</span>}
              </div>
              <div className="text-[11px] text-rmpg-200 space-y-[2px]">
                <div className="text-rmpg-100 font-semibold">{officer.full_name}</div>
                <div>Badge {officer.badge_number || '—'} · {officer.rank || '—'}</div>
                <div className="text-rmpg-400">{officer.department || '—'}</div>
              </div>
            </div>
          )}
          <button type="button"
            onClick={() => { setResult(null); setOfficer(null); }}
            className="mt-3 text-[11px] underline opacity-80"
          >
            Scan another
          </button>
        </div>
      )}

      {/* Camera */}
      {!display && (
        <div className="space-y-3">
          <div className="rounded-[2px] border border-border-default bg-black overflow-hidden aspect-square flex items-center justify-center">
            <video ref={videoRef} playsInline muted className={scanning ? 'w-full h-full object-cover' : 'hidden'} />
            {!scanning && <span className="text-rmpg-500 text-xs">Camera off</span>}
          </div>
          {camError && <div className="text-[11px] text-[color:var(--sev-critical)]">{camError}</div>}
          {!scanning ? (
            <button type="button"
              onClick={startCamera}
              className="w-full rounded-[2px] bg-brand-600 text-rmpg-100 font-semibold text-sm py-2"
            >
              Start camera scan
            </button>
          ) : (
            <button type="button"
              onClick={stopCamera}
              className="w-full rounded-[2px] border border-border-default text-rmpg-300 text-sm py-2"
            >
              Stop
            </button>
          )}

          {/* Manual fallback */}
          <div className="pt-2 border-t border-border-default space-y-2">
            <div className="text-[10px] text-rmpg-500">Or paste a scanned token</div>
            <textarea
              value={manualToken}
              onChange={(e) => setManualToken(e.target.value)}
              rows={2}
              className="w-full rounded-[2px] bg-surface-overlay border border-border-default text-rmpg-300 text-[11px] p-2"
              placeholder="walletId.exp.sig"
            />
            <button type="button"
              onClick={() => verifyToken(manualToken.trim())}
              disabled={busy || !manualToken.trim()}
              className="w-full rounded-[2px] border border-border-default text-rmpg-300 text-sm py-2 disabled:opacity-40"
            >
              Verify token
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
