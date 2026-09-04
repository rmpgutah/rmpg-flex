// ============================================================
// Admin → Post-Quantum Cryptography
// ============================================================
// Provisions + manages the org and per-officer post-quantum crypto
// identities (hybrid X25519+ML-KEM-768 encryption, Ed25519+ML-DSA-65
// signing), runs master-key rotation, and shows subsystem health.
//
// Backed by /api/crypto (src/routes/crypto.ts). All mutation endpoints
// are admin-gated; the master KEK (RMPG_PQ_MASTER_KEY) never leaves
// the Worker secret store — this UI only triggers operations that
// run server-side.
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, KeyRound, RefreshCw, Loader2, Plus, Trash2, UserCircle2, AlertTriangle, Key } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useToast } from '../../components/ToastProvider';
import ConfirmDialog from '../../components/ConfirmDialog';

interface Props {
  LoadingSpinner: React.ComponentType;
  error: string | null;
  setError: (e: string | null) => void;
}

interface IdentityRow {
  id: string;
  kind: string;
  created_at: number;
}

interface CryptoHealth {
  status: string;
  masterKeySet: boolean;
  identities: { encryption: boolean; signing: boolean };
}

export default function AdminCryptoTab({ setError }: Props) {
  const { addToast } = useToast();
  const [health, setHealth] = useState<CryptoHealth | null>(null);
  const [identities, setIdentities] = useState<IdentityRow[]>([]);
  const [officers, setOfficers] = useState<IdentityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Rotation dialog state
  const [rotateOpen, setRotateOpen] = useState(false);
  const [oldKey, setOldKey] = useState('');
  const [rotating, setRotating] = useState(false);

  // New-officer provisioning
  const [officerUserId, setOfficerUserId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [h, ids, officers] = await Promise.all([
        apiFetch<CryptoHealth>('/crypto/health').catch(() => null),
        apiFetch<{ identities: IdentityRow[] }>('/crypto/identities').catch(() => ({ identities: [] })),
        apiFetch<{ officers: IdentityRow[] }>('/crypto/officer').catch(() => ({ officers: [] })),
      ]);
      setHealth(h);
      setIdentities(ids.identities);
      setOfficers(officers.officers);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load crypto status');
    } finally {
      setLoading(false);
    }
  }, [setError]);

  useEffect(() => { load(); }, [load]);

  const provisionOrg = async (kind: 'encryption' | 'signing') => {
    setBusy(true);
    try {
      const endpoint = kind === 'encryption' ? '/crypto/identities/encryption' : '/crypto/identities/signing';
      await apiFetch(endpoint, { method: 'POST', body: JSON.stringify({}) });
      addToast(`Org ${kind} identity provisioned`, 'success');
      load();
    } catch (e) {
      addToast(e instanceof Error ? e.message : `Failed to provision ${kind} identity`, 'error');
    } finally { setBusy(false); }
  };

  const provisionOfficer = async (kind: 'encryption' | 'signing') => {
    const uid = Number(officerUserId);
    if (!Number.isFinite(uid) || uid <= 0) {
      addToast('Enter a valid numeric user id', 'error');
      return;
    }
    setBusy(true);
    try {
      const endpoint = `/crypto/officer/${uid}/${kind}`;
      await apiFetch(endpoint, { method: 'POST', body: JSON.stringify({}) });
      addToast(`Officer ${kind} identity provisioned for user ${uid}`, 'success');
      setOfficerUserId('');
      load();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to provision officer identity', 'error');
    } finally { setBusy(false); }
  };

  const revokeOfficer = async (userId: number) => {
    setBusy(true);
    try {
      await apiFetch(`/crypto/officer/${userId}`, { method: 'DELETE' });
      addToast(`Officer ${userId} identity revoked (crypto-shredded)`, 'success');
      load();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Revoke failed', 'error');
    } finally { setBusy(false); }
  };

  const rotate = async () => {
    if (!oldKey) { addToast('Enter the previous RMPG_PQ_MASTER_KEY (base64)', 'error'); return; }
    setRotating(true);
    try {
      const res = await apiFetch<{ ok: boolean; rowsRewrapped: number }>('/crypto/rotate-master-key', {
        method: 'POST', body: JSON.stringify({ oldKey }),
      });
      addToast(`Master key rotated — ${res.rowsRewrapped} identities re-wrapped`, 'success');
      setRotateOpen(false);
      setOldKey('');
      load();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Rotation failed (wrong old key, or server error)', 'error');
    } finally { setRotating(false); }
  };

  if (loading) return <div className="flex items-center gap-2 text-[11px] text-fg-secondary p-4"><Loader2 size={14} className="animate-spin" /> Loading…</div>;

  const card = 'border border-border-default rounded-sm bg-surface-sunken';
  const masterKeyOk = !!health?.masterKeySet;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center gap-2">
        <ShieldCheck size={16} className="text-brand-400" />
        <h2 className="text-[13px] font-bold text-rmpg-100 uppercase tracking-wider">Post-Quantum Cryptography</h2>
        {masterKeyOk
          ? <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 bg-green-900/40 text-green-400 border border-green-700/50 flex items-center gap-1"><Key size={10} /> Master key set</span>
          : <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 bg-red-900/40 text-red-300 border border-red-600/70 flex items-center gap-1"><AlertTriangle size={10} /> Master key unset</span>}
      </div>

      {/* Security notice */}
      <div className="px-3 py-2 bg-surface-base border border-border-default text-[9px] text-fg-secondary leading-relaxed rounded-sm">
        This subsystem uses <b className="text-rmpg-100">NIST-standardized post-quantum primitives</b> (X25519 + ML-KEM-768 hybrid KEM;
        Ed25519 + ML-DSA-65 hybrid signatures; AES-256-GCM; HKDF-SHA-256). <b className="text-rmpg-100">No novel cryptography.</b>
        The master KEK (<span className="font-mono">RMPG_PQ_MASTER_KEY</span>) lives only in the Worker secret store.
        Wire format: <span className="font-mono text-[8px]">docs/superpowers/specs/2026-07-24-pq-crypto-wire-format.md</span>.
      </div>

      {!masterKeyOk && (
        <div className="px-3 py-2 bg-red-900/30 border border-red-700/50 text-red-400 text-[10px] rounded-sm flex items-center gap-2">
          <AlertTriangle size={12} />
          <span><b>RMPG_PQ_MASTER_KEY is not set.</b> Run <span className="font-mono">wrangler secret put RMPG_PQ_MASTER_KEY</span> (base64, 32 bytes) and redeploy before provisioning identities.</span>
        </div>
      )}

      {/* Org identities */}
      <div className={card}>
        <div className="px-3 py-1.5 border-b border-border-default text-[10px] font-bold text-rmpg-100 uppercase tracking-wider flex items-center gap-1.5">
          <KeyRound size={11} /> Org Identities
        </div>
        <div className="p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => provisionOrg('encryption')} disabled={busy || !masterKeyOk} className="flex items-center gap-1.5 px-3 py-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 rounded-sm text-[10px] font-bold text-white">
              <Plus size={12} /> Provision Encryption
            </button>
            <button type="button" onClick={() => provisionOrg('signing')} disabled={busy || !masterKeyOk} className="flex items-center gap-1.5 px-3 py-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 rounded-sm text-[10px] font-bold text-white">
              <Plus size={12} /> Provision Signing
            </button>
          </div>
          <div className="text-[9px] text-fg-muted uppercase font-mono pt-1">Provisioned identities</div>
          <div className="text-[10px] text-rmpg-100 space-y-0.5">
            {identities.length === 0
              ? <div className="text-[10px] text-fg-muted">none yet</div>
              : identities.map((i) => (
                <div key={i.id} className="flex justify-between border-t border-border-subtle py-0.5">
                  <span className="font-mono">{i.id}</span>
                  <span className="text-fg-muted">{i.kind}</span>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Master-key rotation */}
      <div className={card}>
        <div className="px-3 py-1.5 border-b border-border-default text-[10px] font-bold text-rmpg-100 uppercase tracking-wider flex items-center gap-1.5">
          <RefreshCw size={11} /> Master-Key Rotation
        </div>
        <div className="p-3 text-[10px] text-fg-secondary space-y-2">
          <p>Re-wraps every identity secret under a <b className="text-rmpg-100">new</b> <span className="font-mono">RMPG_PQ_MASTER_KEY</span>. Set the new key in the Worker secret store FIRST (<span className="font-mono">wrangler secret put RMPG_PQ_MASTER_KEY</span>), then run rotation with the OLD key here. After success, destroy the old key.</p>
          <button type="button" onClick={() => setRotateOpen(true)} disabled={!masterKeyOk} className="flex items-center gap-1.5 px-3 py-2 bg-amber-700/70 hover:bg-amber-600 disabled:opacity-40 rounded-sm text-[10px] font-bold text-white">
            <RefreshCw size={12} /> Rotate Master Key
          </button>
        </div>
      </div>

      {/* Per-officer identities */}
      <div className={card}>
        <div className="px-3 py-1.5 border-b border-border-default text-[10px] font-bold text-rmpg-100 uppercase tracking-wider flex items-center gap-1.5">
          <UserCircle2 size={11} /> Per-Officer Identities
        </div>
        <div className="p-3 space-y-2">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-[8px] text-fg-muted uppercase font-mono">User ID</label>
              <input className="input-dark text-[10px] w-full min-h-[32px] mt-0.5 font-mono" placeholder="e.g. 12" value={officerUserId} onChange={(e) => setOfficerUserId(e.target.value)} />
            </div>
            <button type="button" onClick={() => provisionOfficer('encryption')} disabled={busy || !masterKeyOk} className="flex items-center gap-1.5 px-3 py-2 bg-surface-base border border-rmpg-700 rounded-sm text-[10px] font-bold text-rmpg-100 hover:text-rmpg-100 disabled:opacity-40">
              <Plus size={12} /> Encryption
            </button>
            <button type="button" onClick={() => provisionOfficer('signing')} disabled={busy || !masterKeyOk} className="flex items-center gap-1.5 px-3 py-2 bg-surface-base border border-rmpg-700 rounded-sm text-[10px] font-bold text-rmpg-100 hover:text-rmpg-100 disabled:opacity-40">
              <Plus size={12} /> Signing
            </button>
          </div>
          <div className="text-[9px] text-fg-muted uppercase font-mono pt-1">Provisioned officers</div>
          <div className="text-[10px] text-rmpg-100 space-y-0.5">
            {officers.length === 0
              ? <div className="text-[10px] text-fg-muted">none yet</div>
              : officers.map((o) => {
                const uid = Number(o.id.replace('officer-', ''));
                return (
                  <div key={o.id} className="flex justify-between items-center border-t border-border-subtle py-0.5">
                    <span className="font-mono">{o.id} <span className="text-fg-muted">({o.kind})</span></span>
                    <button type="button" onClick={() => revokeOfficer(uid)} disabled={busy} className="text-red-400 hover:text-red-300 disabled:opacity-40" aria-label={`Revoke ${o.id}`} title="Crypto-shred this officer's identity">
                      <Trash2 size={12} />
                    </button>
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button type="button" onClick={load} className="flex items-center gap-1.5 px-3 py-2 bg-surface-base border border-rmpg-700 rounded-sm text-[10px] font-bold text-rmpg-100 hover:text-rmpg-100">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      <ConfirmDialog
        isOpen={rotateOpen}
        onClose={() => { if (!rotating) { setRotateOpen(false); setOldKey(''); } }}
        onConfirm={rotate}
        title="Rotate Master Key"
        message="Re-wrap every crypto identity under the NEW RMPG_PQ_MASTER_KEY. Make sure the new key is already set in the Worker secret store. You must supply the OLD key here so the Worker can unwrap one last time."
        details={
          <input
            className="input-dark text-[10px] w-full min-h-[32px] mt-2 font-mono"
            type="password"
            placeholder="previous RMPG_PQ_MASTER_KEY (base64)"
            value={oldKey}
            onChange={(e) => setOldKey(e.target.value)}
            onClick={(e) => e.stopPropagation()}
          />
        }
        confirmLabel="Rotate Now"
        confirmVariant="warning"
        isLoading={rotating}
      />
    </div>
  );
}