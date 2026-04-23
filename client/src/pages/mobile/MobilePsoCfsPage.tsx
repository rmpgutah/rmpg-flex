import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

type Call = {
  id: number;
  call_number: string;
  incident_type: string;
  location: string;
  pso_service_type: string | null;
  contract_id: string | null;
  status: string;
  priority: string;
  created_at: string;
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
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const callId = useMemo(() => parseInt(String(id || '0'), 10), [id]);
  const qrToken = searchParams.get('t') || '';

  const [stage, setStage] = useState<'loading' | 'challenge' | 'auth' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [call, setCall] = useState<Call | null>(null);
  const [scansRemaining, setScansRemaining] = useState<number | null>(null);
  const [userIdInput, setUserIdInput] = useState<string>('');
  const [auth, setAuth] = useState<MobileAuthState | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [narrative, setNarrative] = useState<string>('');
  const [narrativeSaved, setNarrativeSaved] = useState(false);
  const [psoAttempt, setPsoAttempt] = useState<string>('');
  const [psoResult, setPsoResult] = useState<string>('');
  const [psoServedTo, setPsoServedTo] = useState<string>('');
  const [psoNotes, setPsoNotes] = useState<string>('');
  const [psoSaved, setPsoSaved] = useState(false);

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
      alert(`Status update failed: ${err.message || err}`);
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
      setTimeout(() => setNarrativeSaved(false), 2500);
    } catch (err: any) {
      alert(`Narrative save failed: ${err.message || err}`);
    } finally {
      setBusy(false);
    }
  }

  async function savePsoFields() {
    if (!auth) return;
    setBusy(true);
    try {
      const body: Record<string, any> = {};
      if (psoAttempt) body.pso_attempt_number = parseInt(psoAttempt, 10);
      if (psoResult) body.pso_result = psoResult;
      if (psoServedTo) body.process_served_to = psoServedTo;
      if (psoNotes) body.process_service_notes = psoNotes;
      if (Object.keys(body).length === 0) { setBusy(false); return; }
      const r = await fetch(`/api/mobile/cfs/${auth.call_id}/pso`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
        body: JSON.stringify(body),
      });
      if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error(err.error || 'PSO save failed'); }
      setPsoSaved(true);
      setTimeout(() => setPsoSaved(false), 2500);
    } catch (err: any) {
      alert(`PSO save failed: ${err.message || err}`);
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
    return <Wrapper><div className="text-sm text-gray-400 p-4">Loading dispatch…</div></Wrapper>;
  }

  if (stage === 'error') {
    return (
      <Wrapper>
        <div className="p-4 space-y-2">
          <div className="text-red-400 font-bold">Unable to open this QR link</div>
          <div className="text-sm text-gray-300">{errorMsg}</div>
          <div className="text-xs text-gray-500 mt-3">Call your dispatch supervisor; they can reset the scan count or reissue the QR.</div>
        </div>
      </Wrapper>
    );
  }

  if (stage === 'auth') {
    return (
      <Wrapper>
        <div className="p-4 space-y-4">
          <div>
            <div className="text-[#d4a017] text-xs font-bold tracking-[0.12em] uppercase mb-1">PSO Dispatch</div>
            <div className="text-white text-lg font-mono">{call?.call_number}</div>
            <div className="text-sm text-gray-300 mt-1">{call?.location}</div>
            {call?.pso_service_type && (
              <div className="text-xs text-gray-400 mt-1 uppercase">{call.pso_service_type.replace(/_/g, ' ')}</div>
            )}
          </div>
          <div className="bg-[#141414] border border-[#222] p-3 space-y-3">
            <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wider">Enter Your User ID</label>
            <input
              type="number"
              inputMode="numeric"
              autoFocus
              value={userIdInput}
              onChange={(e) => setUserIdInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitAuth(); }}
              className="w-full bg-[#050505] border border-[#333] text-white font-mono text-lg px-3 py-2 focus:border-[#d4a017] outline-none"
              placeholder="e.g. 1572"
            />
            {errorMsg && <div className="text-red-400 text-xs">{errorMsg}</div>}
            <button
              disabled={busy || !userIdInput.trim()}
              onClick={submitAuth}
              className="w-full bg-[#d4a017] text-black font-bold py-3 uppercase tracking-wider disabled:opacity-50"
            >{busy ? 'Verifying…' : 'Open Dispatch'}</button>
            {scansRemaining != null && (
              <div className="text-[10px] text-gray-500 text-center">{scansRemaining} scan{scansRemaining !== 1 ? 's' : ''} remaining on this QR</div>
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
            <div className="text-[#d4a017] text-xs font-bold tracking-[0.12em] uppercase">PSO Dispatch</div>
            <div className="text-white text-lg font-mono">{call?.call_number}</div>
            <div className="text-xs text-gray-400 mt-0.5">Signed in as <span className="text-gray-200">{auth?.user.full_name} ({auth?.user.id})</span></div>
          </div>
          <button onClick={signOut} className="text-[10px] text-gray-500 hover:text-red-400 uppercase">Sign Out</button>
        </div>

        <div className="bg-[#141414] border border-[#222] p-3">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Location</div>
          <div className="text-sm text-white">{call?.location}</div>
          {call?.pso_service_type && <div className="text-xs text-gray-400 mt-1 uppercase">{call.pso_service_type.replace(/_/g, ' ')}</div>}
          {call?.contract_id && <div className="text-[10px] text-gray-500 mt-0.5">Contract {call.contract_id}</div>}
          <div className="text-[10px] text-gray-500 mt-1 uppercase">Current status: <span className="text-[#d4a017]">{call?.status}</span></div>
        </div>

        <div className="bg-[#141414] border border-[#222] p-3">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Status</div>
          <div className="grid grid-cols-2 gap-2">
            {(['enroute', 'onscene', 'cleared', 'closed'] as const).map((s) => (
              <button
                key={s}
                disabled={statusBusy}
                onClick={() => updateStatus(s)}
                className="py-3 border border-[#333] text-white text-[11px] font-bold uppercase tracking-wider hover:border-[#d4a017] disabled:opacity-50"
              >{statusLabel(s)}</button>
            ))}
          </div>
        </div>

        <div className="bg-[#141414] border border-[#222] p-3">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Add Narrative</div>
          <textarea
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
            rows={4}
            className="w-full bg-[#050505] border border-[#333] text-white text-sm px-3 py-2 focus:border-[#d4a017] outline-none"
            placeholder="Record an observation, attempt outcome, or note…"
          />
          <button
            disabled={busy || !narrative.trim()}
            onClick={saveNarrative}
            className="mt-2 w-full bg-[#d4a017] text-black font-bold py-2 uppercase tracking-wider text-[11px] disabled:opacity-50"
          >{busy ? 'Saving…' : narrativeSaved ? 'Saved ✓' : 'Append Narrative'}</button>
        </div>

        <div className="bg-[#141414] border border-[#222] p-3">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">PSO Service</div>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <LabeledInput label="Attempt #" type="number" value={psoAttempt} onChange={setPsoAttempt} />
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
            <label className="block text-[9px] font-bold text-gray-500 uppercase tracking-wider">Service Notes</label>
            <textarea
              value={psoNotes}
              onChange={(e) => setPsoNotes(e.target.value)}
              rows={3}
              className="w-full bg-[#050505] border border-[#333] text-white text-sm px-3 py-2 focus:border-[#d4a017] outline-none mt-1"
            />
          </div>
          <button
            disabled={busy}
            onClick={savePsoFields}
            className="mt-2 w-full bg-[#d4a017] text-black font-bold py-2 uppercase tracking-wider text-[11px] disabled:opacity-50"
          >{busy ? 'Saving…' : psoSaved ? 'Saved ✓' : 'Update PSO Fields'}</button>
        </div>

        <div className="text-[10px] text-gray-600 text-center pt-2 pb-6">RMPG Flex · PSO Mobile · QR session valid 30 days</div>
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

function LabeledInput({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="block text-[9px] font-bold text-gray-500 uppercase tracking-wider">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="w-full bg-[#050505] border border-[#333] text-white text-sm px-2 py-1.5 focus:border-[#d4a017] outline-none mt-1" />
    </div>
  );
}
function LabeledSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div>
      <label className="block text-[9px] font-bold text-gray-500 uppercase tracking-wider">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full bg-[#050505] border border-[#333] text-white text-sm px-2 py-1.5 focus:border-[#d4a017] outline-none mt-1">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="max-w-md mx-auto">
        <div className="bg-[#050505] border-b border-[#222] px-4 py-3 flex items-center gap-3">
          <img src="/rmpg-logo.png" alt="RMPG" className="w-8 h-8" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          <div>
            <div className="text-[#d4a017] text-xs font-bold tracking-[0.12em] uppercase">RMPG Flex</div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider">Mobile · PSO</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
