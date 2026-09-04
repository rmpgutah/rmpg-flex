import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useToast } from '../../components/ToastProvider';

import RichTextArea from '../../components/RichTextArea';
import OfficerPicker, { type OfficerSummary } from '../../components/OfficerPicker';
import { toDisplayLabel } from '../../utils/formatters';
type Call = {
  id: number;
  call_number: string;
  incident_type: string;
  location: string;
  status: string;
  priority: string;
  created_at: string;
  // PSO Client Request fields
  pso_service_type: string | null;
  pso_requestor_name: string | null;
  pso_requestor_phone: string | null;
  pso_requestor_email: string | null;
  pso_billing_code: string | null;
  pso_authorization: string | null;
  pso_attempt_number: number | null;
  contract_id: string | null;
  // Process Service fields
  process_service_type: string | null;
  process_served_to: string | null;
  process_served_address: string | null;
  process_attempts: number | null;
  process_served_at: string | null;
  process_service_result: string | null;
};

type MobileAuthState = {
  token: string;
  user: { id: number; username: string; full_name: string; role: string };
  call_id: number;
  scans_remaining: number | null;
};

const STORAGE_KEY = 'rmpg-mobile-pso-auth';

function loadPersistedAuth(callId: number): MobileAuthState | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}:${callId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MobileAuthState;
    if (!parsed?.token || parsed.call_id !== callId) return null;
    return parsed;
  } catch { return null; }
}

function persistAuth(auth: MobileAuthState): void {
  try { localStorage.setItem(`${STORAGE_KEY}:${auth.call_id}`, JSON.stringify(auth)); } catch { /* ignore */ }
}

function clearAuth(callId: number): void {
  try { localStorage.removeItem(`${STORAGE_KEY}:${callId}`); } catch { /* ignore */ }
}

export default function MobilePsoCfsPage() {
  const { addToast } = useToast();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const callId = useMemo(() => parseInt(String(id || '0'), 10), [id]);
  const qrToken = searchParams.get('t') || '';

  const [stage, setStage] = useState<'loading' | 'challenge' | 'auth' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [call, setCall] = useState<Call | null>(null);
  const [scansRemaining, setScansRemaining] = useState<number | null>(null);
  const [userIdInput, setUserIdInput] = useState<string>('');
  // Selected-officer object so we can render the chosen name back to the
  // operator BEFORE they tap "Open Dispatch" — defends against typo-style
  // wrong-officer auth that the old free-form number input made trivial.
  const [selectedOfficer, setSelectedOfficer] = useState<OfficerSummary | null>(null);
  const [auth, setAuth] = useState<MobileAuthState | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [narrative, setNarrative] = useState<string>('');
  const [narrativeSaved, setNarrativeSaved] = useState(false);
  const narrativeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const psoTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => { clearTimeout(narrativeTimerRef.current); clearTimeout(psoTimerRef.current); }, []);
  const [psoAttempt, setPsoAttempt] = useState<string>('');
  const [psoResult, setPsoResult] = useState<string>('');
  const [psoServedTo, setPsoServedTo] = useState<string>('');
  const [psoNotes, setPsoNotes] = useState<string>('');
  const [psoSaved, setPsoSaved] = useState(false);
  const [psoFieldsSeeded, setPsoFieldsSeeded] = useState(false);

  // Seed the PSO form from the loaded call exactly once, so a re-opened
  // page (or a status update elsewhere resetting `call`) shows the
  // attempt #/result/served-to that were already saved server-side,
  // instead of always starting blank. Guarded to run once so it doesn't
  // clobber the officer's in-progress edits on a later refresh.
  useEffect(() => {
    if (!call || psoFieldsSeeded) return;
    if (call.pso_attempt_number != null) setPsoAttempt(String(call.pso_attempt_number));
    if (call.process_service_result) setPsoResult(call.process_service_result);
    if (call.process_served_to) setPsoServedTo(call.process_served_to);
    setPsoFieldsSeeded(true);
  }, [call, psoFieldsSeeded]);

  // Step 1: challenge the QR token
  useEffect(() => {
    if (!callId || !qrToken) { setStage('error'); setErrorMsg('Missing call ID or QR token in URL'); return; }
    const persisted = loadPersistedAuth(callId);
    if (persisted) {
      setAuth(persisted);
      setStage('ready');
      void hydrateCall(persisted);
      return;
    }
    fetch(`/api/mobile/cfs/${callId}/challenge?t=${encodeURIComponent(qrToken)}`)
      .then(async (r) => {
        if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error(err.error || 'Challenge failed'); }
        return r.json();
      })
      .then((data) => {
        setCall(data.call);
        setScansRemaining(data.scans_remaining);
        setStage('auth');
      })
      .catch((err) => {
        setStage('error');
        setErrorMsg(err.message || String(err));
      });
  }, [callId, qrToken]);

  async function hydrateCall(a: MobileAuthState) {
    try {
      const r = await fetch(`/api/mobile/cfs/${a.call_id}/challenge?t=${encodeURIComponent(qrToken)}`);
      if (r.ok) {
        const data = await r.json();
        setCall(data.call);
        setScansRemaining(data.scans_remaining);
      }
    } catch { /* keep cached */ }
  }

  async function submitAuth() {
    if (!userIdInput.trim()) { setErrorMsg('Enter your User ID'); return; }
    setBusy(true); setErrorMsg('');
    try {
      const r = await fetch(`/api/mobile/cfs/${callId}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: qrToken, user_id: parseInt(userIdInput, 10) }),
      });
      if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error(err.error || 'Auth failed'); }
      const data = await r.json() as MobileAuthState;
      setAuth(data);
      persistAuth(data);
      setScansRemaining(data.scans_remaining);
      setStage('ready');
    } catch (err: any) {
      setErrorMsg(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(next: string) {
    if (!auth) return;
    setStatusBusy(true);
    try {
      const r = await fetch(`/api/mobile/cfs/${auth.call_id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
        body: JSON.stringify({ status: next }),
      });
      if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error(err.error || 'Status failed'); }
      const data = await r.json();
      setCall(data.call);
    } catch (err: any) {
      addToast(`Status update failed: ${err.message || err}`, 'error');
    } finally {
      setStatusBusy(false);
    }
  }

  async function saveNarrative() {
    if (!auth || !narrative.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/mobile/cfs/${auth.call_id}/narrative`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
        body: JSON.stringify({ content: narrative }),
      });
      if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error(err.error || 'Save failed'); }
      setNarrative('');
      setNarrativeSaved(true);
      clearTimeout(narrativeTimerRef.current);
      narrativeTimerRef.current = setTimeout(() => setNarrativeSaved(false), 2500);
    } catch (err: any) {
      addToast(`Narrative save failed: ${err.message || err}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function savePsoFields() {
    if (!auth) return;
    setBusy(true);
    try {
      const body: Record<string, any> = {};
      const attemptNum = parseInt(psoAttempt, 10);
      if (psoAttempt && !isNaN(attemptNum) && attemptNum >= 1) body.pso_attempt_number = attemptNum;
      if (psoResult) body.pso_result = psoResult;
      if (psoServedTo) body.process_served_to = psoServedTo;
      if (Object.keys(body).length > 0) {
        const r = await fetch(`/api/mobile/cfs/${auth.call_id}/pso`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
          body: JSON.stringify(body),
        });
        if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error(err.error || 'PSO save failed'); }
        const data = await r.json();
        setCall(data.call);
      }
      // PSO service notes go through the narrative-append endpoint so we don't
      // clobber the shared `notes` column. Prefix with a tag so it's clear in
      // the log that this was a service-specific note.
      if (psoNotes.trim()) {
        const r = await fetch(`/api/mobile/cfs/${auth.call_id}/narrative`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
          body: JSON.stringify({ content: `SERVICE NOTE: ${psoNotes.trim()}` }),
        });
        if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error(err.error || 'PSO notes save failed'); }
      }
      setPsoNotes('');
      setPsoSaved(true);
      clearTimeout(psoTimerRef.current);
      psoTimerRef.current = setTimeout(() => setPsoSaved(false), 2500);
    } catch (err: any) {
      addToast(`PSO save failed: ${err.message || err}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  function signOut() {
    clearAuth(callId);
    setAuth(null);
    setUserIdInput('');
    setStage('auth');
  }

  if (stage === 'loading') {
    return <Wrapper><div className="text-sm text-rmpg-400 p-4">Loading dispatch…</div></Wrapper>;
  }

  if (stage === 'error') {
    return (
      <Wrapper>
        <div className="p-4 space-y-2">
          <div className="text-red-400 font-bold">Unable to open this QR link</div>
          <div className="text-sm text-rmpg-300">{errorMsg}</div>
          <div className="text-xs text-rmpg-500 mt-3">Call your dispatch supervisor; they can reset the scan count or reissue the QR.</div>
        </div>
      </Wrapper>
    );
  }

  if (stage === 'auth') {
    return (
      <Wrapper>
        <div className="p-4 space-y-4">
          <div>
            <div className="text-[color:var(--panel-header-color)] text-xs font-bold tracking-[0.12em] uppercase mb-1">PSO Dispatch</div>
            <div className="text-rmpg-100 text-lg font-mono">{call?.call_number}</div>
            <div className="text-sm text-rmpg-300 mt-1">{call?.location}</div>
            {call?.pso_service_type && (
              <div className="text-xs text-rmpg-400 mt-1 uppercase">{toDisplayLabel(call.pso_service_type)}</div>
            )}
          </div>
          <div className="bg-surface-base border border-border-default p-3 space-y-3">
            <label className="block text-[11px] font-bold text-rmpg-400 uppercase tracking-wider">Who Are You?</label>
            <OfficerPicker
              id="ff-mobilepsocfspage-0"
              value={userIdInput ? Number(userIdInput) : null}
              onChange={(id, officer) => {
                setUserIdInput(id ? String(id) : '');
                setSelectedOfficer(officer ?? null);
                if (id && errorMsg) setErrorMsg('');
              }}
              placeholder="Search by your name, badge, unit…"
            />
            {/* Confirmation strip — surfaces the picked officer's name + badge
                so the guard can verify identity BEFORE the auth round-trip.
                Without this, a wrong pick would silently authenticate them
                as the wrong officer (the old typed-id failure mode).*/}
            {selectedOfficer && (
              <div className="bg-surface-overlay border border-accent-silver-400/40 px-3 py-2 text-xs">
                <span className="text-rmpg-400">Sign in as </span>
                <span className="text-[color:var(--field-label-color)] font-bold">{selectedOfficer.full_name}</span>
                {selectedOfficer.badge_number && <span className="text-rmpg-500 ml-1.5">#{selectedOfficer.badge_number}</span>}
                {selectedOfficer.unit_call_sign && <span className="text-rmpg-500 ml-1.5">· {selectedOfficer.unit_call_sign}</span>}
              </div>
            )}
            {errorMsg && <div className="text-red-400 text-xs">{errorMsg}</div>}
            <button
              disabled={busy || !userIdInput.trim()}
              onClick={submitAuth}
              className="w-full bg-rmpg-600 hover:bg-rmpg-500 text-rmpg-50 font-bold py-3 uppercase tracking-wider disabled:opacity-50"
            >{busy ? 'Verifying…' : 'Open Dispatch'}</button>
            {scansRemaining != null && (
              <div className="text-[10px] text-rmpg-500 text-center">{scansRemaining} scan{scansRemaining !== 1 ? 's' : ''} remaining on this QR</div>
            )}
          </div>
        </div>
      </Wrapper>
    );
  }

  // stage === 'ready'
  return (
    <Wrapper>
      <div className="p-3 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[color:var(--panel-header-color)] text-xs font-bold tracking-[0.12em] uppercase">PSO Dispatch</div>
            <div className="text-rmpg-100 text-lg font-mono">{call?.call_number}</div>
            <div className="text-xs text-rmpg-400 mt-0.5">Signed in as <span className="text-rmpg-200">{auth?.user.full_name} ({auth?.user.id})</span></div>
          </div>
          <button onClick={signOut} className="text-[10px] text-rmpg-500 hover:text-red-400 uppercase">Sign Out</button>
        </div>

        <div className="bg-surface-base border border-border-default p-3">
          <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Location</div>
          <div className="text-sm text-rmpg-100">{call?.location}</div>
          {call?.pso_service_type && <div className="text-xs text-rmpg-400 mt-1 uppercase">{toDisplayLabel(call.pso_service_type)}</div>}
          {call?.contract_id && <div className="text-[10px] text-rmpg-500 mt-0.5">Contract {call.contract_id}</div>}
          <div className="text-[10px] text-rmpg-500 mt-1 uppercase">Current status: <span className="text-[color:var(--field-label-color)]">{toDisplayLabel(call?.status)}</span></div>
        </div>

        <div className="bg-surface-base border border-border-default p-3">
          <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-2">Status</div>
          <div className="grid grid-cols-2 gap-2">
            {(['enroute', 'onscene', 'cleared', 'closed'] as const).map((s) => (
              <button
                key={s}
                disabled={statusBusy}
                onClick={() => updateStatus(s)}
                className="py-3 border border-border-subtle text-rmpg-100 text-[11px] font-bold uppercase tracking-wider hover:border-accent-silver-400 disabled:opacity-50"
              >{statusLabel(s)}</button>
            ))}
          </div>
        </div>

        <div className="bg-surface-base border border-border-default p-3">
          <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-2">Add Narrative</div>
          <RichTextArea
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
            rows={4}
            className="w-full bg-surface-overlay border border-border-subtle text-rmpg-100 text-sm px-3 py-2 focus:border-accent-silver-400 outline-none"
            placeholder="Record an observation, attempt outcome, or note…"
          />
          <button
            disabled={busy || !narrative.trim()}
            onClick={saveNarrative}
            className="mt-2 w-full bg-rmpg-600 hover:bg-rmpg-500 text-rmpg-50 font-bold py-2 uppercase tracking-wider text-[11px] disabled:opacity-50"
          >{busy ? 'Saving…' : narrativeSaved ? 'Saved ✓' : 'Append Narrative'}</button>
        </div>

        <div className="bg-surface-base border border-border-default p-3">
          <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-2">PSO Service</div>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <LabeledInput label="Attempt #" type="number" value={psoAttempt} onChange={setPsoAttempt} min={1} max={99} />
            <LabeledSelect label="Result" value={psoResult} onChange={setPsoResult} options={[
              { value: '', label: '—' },
              { value: 'served', label: 'Served' },
              { value: 'sub_served', label: 'Sub-served' },
              { value: 'not_home', label: 'Not Home' },
              { value: 'refused', label: 'Refused' },
              { value: 'bad_address', label: 'Bad Address' },
            ]} />
          </div>
          <LabeledInput label="Served To" value={psoServedTo} onChange={setPsoServedTo} />
          <div className="mt-2">
            <label className="block text-[9px] font-bold text-rmpg-500 uppercase tracking-wider">Service Notes</label>
            <RichTextArea
              value={psoNotes}
              onChange={(e) => setPsoNotes(e.target.value)}
              rows={3}
              className="w-full bg-surface-overlay border border-border-subtle text-rmpg-100 text-sm px-3 py-2 focus:border-accent-silver-400 outline-none mt-1"
            />
          </div>
          <button
            disabled={busy}
            onClick={savePsoFields}
            className="mt-2 w-full bg-rmpg-600 hover:bg-rmpg-500 text-rmpg-50 font-bold py-2 uppercase tracking-wider text-[11px] disabled:opacity-50"
          >{busy ? 'Saving…' : psoSaved ? 'Saved ✓' : 'Update PSO Fields'}</button>
        </div>

        <div className="text-[10px] text-rmpg-500 text-center pt-2 pb-6">RMPG Flex · PSO Mobile · QR session valid 30 days</div>
      </div>
    </Wrapper>
  );
}

function statusLabel(s: string): string {
  switch (s) {
    case 'enroute': return 'En Route (10-76)';
    case 'onscene': return 'On Scene (10-23)';
    case 'cleared': return 'Cleared (10-8)';
    case 'closed': return 'Closed (10-7)';
    default: return s;
  }
}

function LabeledInput({ label, value, onChange, type = 'text', min, max }: { label: string; value: string; onChange: (v: string) => void; type?: string; min?: number; max?: number }) {
  return (
    <div>
      <label htmlFor="ff-mobilepsocfspage-1" className="block text-[9px] font-bold text-rmpg-500 uppercase tracking-wider">{label}</label>
      <input id="ff-mobilepsocfspage-1" type={type} value={value} onChange={(e) => onChange(e.target.value)} min={min} max={max} className="w-full bg-surface-overlay border border-border-subtle text-rmpg-100 text-sm px-2 py-1.5 focus:border-accent-silver-400 outline-none mt-1" />
    </div>
  );
}
function LabeledSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div>
      <label htmlFor="ff-mobilepsocfspage-2" className="block text-[9px] font-bold text-rmpg-500 uppercase tracking-wider">{label}</label>
      <select id="ff-mobilepsocfspage-2" value={value} onChange={(e) => onChange(e.target.value)} className="w-full bg-surface-overlay border border-border-subtle text-rmpg-100 text-sm px-2 py-1.5 focus:border-accent-silver-400 outline-none mt-1">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface-sunken text-rmpg-100">
      <div className="max-w-md mx-auto">
        <div className="bg-surface-overlay border-b border-border-default px-4 py-3 flex items-center gap-3">
          <img src="/rmpg-logo.png" alt="RMPG" className="w-8 h-8" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          <div>
            <div className="text-[color:var(--panel-header-color)] text-xs font-bold tracking-[0.12em] uppercase">RMPG Flex</div>
            <div className="text-[9px] text-rmpg-500 uppercase tracking-wider">Mobile · PSO</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
