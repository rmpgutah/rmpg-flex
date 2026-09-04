// ============================================================
// Admin → Cloudflare platform integration
// ============================================================
// Configure an admin-supplied least-privilege Cloudflare API token and
// view account telemetry (D1 / R2 / KV / Workers) + purge the zone cache.
// The token is NEVER stored client-side or hardcoded — it lives in
// system_config (masked) and is read only by the Worker at call time.
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { Cloud, Database, HardDrive, Box, Cpu, RefreshCw, ShieldCheck, AlertTriangle, Loader2 } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useToast } from '../../components/ToastProvider';
import ConfirmDialog from '../../components/ConfirmDialog';

interface Props {
  LoadingSpinner: React.ComponentType;
  error: string | null;
  setError: (e: string | null) => void;
}

export default function AdminCloudflareTab({ setError }: Props) {
  const { addToast } = useToast();
  const [config, setConfig] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);
  const [resources, setResources] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [purging, setPurging] = useState(false);
  // Zone-purge confirm is gated through ConfirmDialog (was window.confirm,
  // which bypassed keyboard trap + day/night surface + the Esc cascade).
  const [purgeConfirmOpen, setPurgeConfirmOpen] = useState(false);

  // Form (token is write-only; blank keeps current).
  const [token, setToken] = useState('');
  const [accountId, setAccountId] = useState('');
  const [zoneId, setZoneId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cfg = await apiFetch<any>('/cloudflare/config');
      setConfig(cfg);
      setAccountId(cfg?.account_id || '');
      setZoneId(cfg?.zone_id || '');
      if (cfg?.token_set) {
        const [st, res] = await Promise.all([
          apiFetch<any>('/cloudflare/status').catch(() => null),
          apiFetch<any>('/cloudflare/resources').catch(() => null),
        ]);
        setStatus(st); setResources(res);
      } else { setStatus(null); setResources(null); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load Cloudflare config');
    } finally { setLoading(false); }
  }, [setError]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const body: any = { cf_account_id: accountId, cf_zone_id: zoneId };
      if (token) body.cf_api_token = token;   // only send when entered
      await apiFetch('/cloudflare/config', { method: 'PUT', body: JSON.stringify(body) });
      setToken('');
      addToast('Cloudflare config saved', 'success');
      load();
    } catch (e) { addToast(e instanceof Error ? e.message : 'Save failed', 'error'); }
    finally { setSaving(false); }
  };

  // Zone-purge entry point: stage the confirm dialog. The dialog's Confirm
  // button calls `purge()` directly (no second prompt), so this is a single
  // operator decision point gated by the same focus-trap / Esc cascade as
  // every other destructive admin action.
  const stagePurge = () => setPurgeConfirmOpen(true);
  const purge = async () => {
    setPurging(true);
    try {
      await apiFetch('/cloudflare/purge-cache', { method: 'POST', body: JSON.stringify({}) });
      addToast('Cache purged', 'success');
    } catch (e) { addToast(e instanceof Error ? e.message : 'Purge failed', 'error'); }
    finally {
      setPurging(false);
      setPurgeConfirmOpen(false);
    }
  };

  if (loading) return <div className="flex items-center gap-2 text-[11px] text-rmpg-400 p-4"><Loader2 size={14} className="animate-spin" /> Loading…</div>;

  const card = 'border border-border-default rounded-sm bg-surface-sunken';
  const Stat = ({ icon: Icon, label, rows }: { icon: any; label: string; rows: any[] }) => (
    <div className={card}>
      <div className="px-3 py-1.5 border-b border-border-default text-[9px] font-bold text-rmpg-400 uppercase tracking-wider flex items-center gap-1.5">
        <Icon size={11} /> {label} <span className="text-rmpg-100">{rows.length}</span>
      </div>
      <div className="max-h-40 overflow-y-auto">
        {rows.length === 0
          ? <div className="px-3 py-2 text-[10px] text-rmpg-500">none / no read scope</div>
          : rows.map((r, i) => (
            <div key={i} className="px-3 py-1 text-[10px] text-rmpg-300 border-t border-border-subtle flex justify-between gap-2">
              <span className="truncate">{r.name || r.title || r.id}</span>
              {r.size != null && <span className="text-rmpg-500 font-mono flex-shrink-0">{(r.size / 1e6).toFixed(1)} MB</span>}
            </div>
          ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center gap-2">
        <Cloud size={16} className="text-accent-silver-500" />
        <h2 className="text-[13px] font-bold text-rmpg-100 uppercase tracking-wider">Cloudflare Platform</h2>
        {status?.token_valid && <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 bg-green-900/40 text-green-400 border border-green-700/50 flex items-center gap-1"><ShieldCheck size={10} /> Connected</span>}
        {config?.token_set && status && !status.token_valid && <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 bg-red-900/40 text-red-300 border border-red-600/70 flex items-center gap-1"><AlertTriangle size={10} /> Token invalid</span>}
      </div>

      {/* Security notice */}
      <div className="px-3 py-2 bg-surface-sunken border border-border-default text-[9px] text-text-secondary leading-relaxed rounded-sm">
        Paste a <b className="text-rmpg-300">least-privilege, read-only</b> Cloudflare API token (plus Cache Purge if you use it). Recommended scopes: Account Analytics&nbsp;Read, Workers Scripts&nbsp;Read, D1&nbsp;Read, R2&nbsp;Read, KV&nbsp;Read, Zone→Cache&nbsp;Purge. <b className="text-rmpg-300">Do NOT</b> grant account/zone edit or token-management scopes. The token is stored server-side (masked) and never exposed to the browser.
      </div>

      {/* Credentials */}
      <form onSubmit={(e) => e.preventDefault()} autoComplete="off">
      <div className={card}>
        <div className="px-3 py-1.5 border-b border-border-default text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">Credentials</div>
        <div className="p-3 space-y-2">
          <div>
            <label className="text-[8px] text-rmpg-500 uppercase font-mono">API Token {config?.token_set && <span className="text-green-500">· set ({config.token_mask})</span>}</label>
            <input className="input-dark text-[10px] w-full min-h-[32px] mt-0.5" type="password" placeholder={config?.token_set ? 'leave blank to keep current' : 'Cloudflare API token'} value={token} onChange={e => setToken(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[8px] text-rmpg-500 uppercase font-mono">Account ID</label>
              <input className="input-dark text-[10px] w-full min-h-[32px] mt-0.5 font-mono" placeholder="account id" value={accountId} onChange={e => setAccountId(e.target.value)} />
            </div>
            <div>
              <label className="text-[8px] text-rmpg-500 uppercase font-mono">Zone ID (for cache purge)</label>
              <input className="input-dark text-[10px] w-full min-h-[32px] mt-0.5 font-mono" placeholder="zone id (optional)" value={zoneId} onChange={e => setZoneId(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-accent-silver-500 hover:bg-accent-silver-400 disabled:opacity-40 rounded-sm text-[11px] font-bold text-black">
              {saving ? <Loader2 size={13} className="animate-spin" /> : null} Save
            </button>
            <button type="button" onClick={load} className="flex items-center gap-1.5 px-3 py-2 bg-surface-base border border-rmpg-700 rounded-sm text-[10px] font-bold text-rmpg-300 hover:text-rmpg-100">
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
        </div>
      </div>
      </form>

      {/* Status */}
      {status?.configured && (
        <div className={card}>
          <div className="px-3 py-1.5 border-b border-border-default text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">Account</div>
          <div className="p-3 text-[10px] text-rmpg-300 space-y-1">
            <div><span className="text-rmpg-500 uppercase text-[8px]">Account</span> &nbsp;{status.account_name || '—'} <span className="text-rmpg-500 font-mono">{status.account_id}</span></div>
            <div><span className="text-rmpg-500 uppercase text-[8px]">Token</span> &nbsp;{status.token_status}</div>
          </div>
        </div>
      )}

      {/* Resources */}
      {resources?.configured && (
        <div className="grid grid-cols-2 gap-3">
          <Stat icon={Database} label="D1 Databases" rows={resources.d1 || []} />
          <Stat icon={Box} label="R2 Buckets" rows={resources.r2 || []} />
          <Stat icon={HardDrive} label="KV Namespaces" rows={resources.kv || []} />
          <Stat icon={Cpu} label="Workers" rows={resources.workers || []} />
        </div>
      )}

      {/* Cache purge */}
      {config?.token_set && (
        <div className={card}>
          <div className="px-3 py-1.5 border-b border-border-default text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">Cache</div>
          <div className="p-3 flex items-center justify-between gap-3">
            <span className="text-[10px] text-rmpg-400">Purge the entire zone cache (requires Zone ID + Cache Purge scope).</span>
            <button type="button" onClick={stagePurge} disabled={purging || !zoneId} className="flex items-center gap-1.5 px-3 py-2 bg-surface-base border border-amber-700/50 rounded-sm text-[10px] font-bold text-amber-400 hover:text-amber-300 disabled:opacity-40">
              {purging ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Purge Everything
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={purgeConfirmOpen}
        onClose={() => { if (!purging) setPurgeConfirmOpen(false); }}
        onConfirm={purge}
        title="Purge Zone Cache"
        message="Purge the ENTIRE Cloudflare zone cache? Every visitor will re-fetch all assets on their next request, which may briefly increase origin load. This action is audited."
        confirmLabel="Purge Everything"
        confirmVariant="warning"
        isLoading={purging}
      />
    </div>
  );
}
