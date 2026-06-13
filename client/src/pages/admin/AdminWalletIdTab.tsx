import React, { useState, useEffect, useCallback } from 'react';
import { CreditCard, Search, Ban, RotateCcw, Loader2 } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { asArray } from '../../utils/asArray';
import ConfirmDialog from '../../components/ConfirmDialog';
import {
  filterCredentials,
  credentialRowStatus,
  type CredentialRow,
  type RowTone,
} from './walletRoster';

// ============================================================
// Officer IDs — admin/manager management of the wallet-ID roster.
// Read-only API surface already enforces admin/manager:
//   GET  /api/wallet/admin/list
//   POST /api/wallet/:walletId/revoke | reinstate
// Pure filter + status logic lives in ./walletRoster (unit-tested).
// ============================================================

interface Props {
  LoadingSpinner: React.FC;
}

const TONE_PILL: Record<RowTone, string> = {
  active: 'bg-[#16351a] text-[#5bd17a]',
  revoked: 'bg-[#3a1414] text-[#e06464]',
  inactive: 'bg-[#3a2e14] text-[#d4a017]',
};

type PendingAction = { row: CredentialRow; action: 'revoke' | 'reinstate' } | null;

export default function AdminWalletIdTab({ LoadingSpinner }: Props) {
  const [rows, setRows] = useState<CredentialRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [queryText, setQueryText] = useState('');
  const [pending, setPending] = useState<PendingAction>(null);
  const [working, setWorking] = useState(false);

  const fetchRoster = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const data = await apiFetch<{ credentials: CredentialRow[] }>('/wallet/admin/list');
      setRows(asArray<CredentialRow>(data.credentials));
      setError(null);
    } catch {
      setError('Could not load the officer-ID roster.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRoster(); }, [fetchRoster]);

  async function runAction() {
    if (!pending) return;
    setWorking(true);
    try {
      await apiFetch(`/wallet/${pending.row.wallet_id}/${pending.action}`, { method: 'POST' });
      setPending(null);
      await fetchRoster({ silent: true });
    } catch {
      setError(`Could not ${pending.action} that credential.`);
    } finally {
      setWorking(false);
    }
  }

  const visible = filterCredentials(rows, queryText);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <CreditCard className="w-4 h-4 text-[#d4a017]" />
        <h2 className="text-sm font-semibold text-[#d4a017] tracking-wide">OFFICER IDS</h2>
        <span className="text-[11px] text-[#666]">{rows.length} issued</span>
      </div>

      <div className="relative max-w-xs">
        <Search className="w-3.5 h-3.5 text-[#666] absolute left-2 top-1/2 -translate-y-1/2" />
        <input
          value={queryText}
          onChange={(e) => setQueryText(e.target.value)}
          placeholder="Filter by name, badge, dept"
          className="w-full pl-7 pr-2 py-1 rounded-[2px] bg-[#050505] border border-[#222] text-[11px] text-[#ccc]"
        />
      </div>

      {error && <div className="text-[11px] text-[#e06464]">{error}</div>}

      {loading ? (
        <LoadingSpinner />
      ) : visible.length === 0 ? (
        <div className="text-[11px] text-[#666]">No officer IDs match.</div>
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr className="text-[9px] font-semibold text-[#888] uppercase border-b border-[#222]">
              <th className="py-[3px] pr-2">Officer</th>
              <th className="py-[3px] pr-2">Rank / Dept</th>
              <th className="py-[3px] pr-2">Status</th>
              <th className="py-[3px] pr-2">Issued</th>
              <th className="py-[3px] pr-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const st = credentialRowStatus(r);
              const revoked = r.status !== 'active';
              return (
                <tr key={r.wallet_id} className="text-[11px] border-b border-[#141414]">
                  <td className="py-[3px] pr-2">
                    <span className="text-white">{r.full_name}</span>
                    <span className="text-[#666]"> · {r.badge_number || '—'}</span>
                  </td>
                  <td className="py-[3px] pr-2 text-[#999]">{[r.rank, r.department].filter(Boolean).join(' / ') || '—'}</td>
                  <td className="py-[3px] pr-2">
                    <span className={`text-[9px] font-semibold px-1.5 py-[1px] rounded-[2px] ${TONE_PILL[st.tone]}`}>
                      {st.label}
                    </span>
                  </td>
                  <td className="py-[3px] pr-2 text-[#666]">{(r.issued_at || '').slice(0, 10) || '—'}</td>
                  <td className="py-[3px] pr-2 text-right">
                    {revoked ? (
                      <button
                        onClick={() => setPending({ row: r, action: 'reinstate' })}
                        className="inline-flex items-center gap-1 text-[10px] text-[#5bd17a] hover:underline"
                      >
                        <RotateCcw className="w-3 h-3" /> Reinstate
                      </button>
                    ) : (
                      <button
                        onClick={() => setPending({ row: r, action: 'revoke' })}
                        className="inline-flex items-center gap-1 text-[10px] text-[#e06464] hover:underline"
                      >
                        <Ban className="w-3 h-3" /> Revoke
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <ConfirmDialog
        isOpen={!!pending}
        onClose={() => !working && setPending(null)}
        onConfirm={runAction}
        isLoading={working}
        confirmVariant={pending?.action === 'revoke' ? 'danger' : 'default'}
        confirmLabel={pending?.action === 'revoke' ? 'Revoke ID' : 'Reinstate ID'}
        title={pending?.action === 'revoke' ? 'Revoke officer ID?' : 'Reinstate officer ID?'}
        message={
          pending
            ? `${pending.action === 'revoke' ? 'Revoke' : 'Reinstate'} the digital ID for ${pending.row.full_name} (badge ${pending.row.badge_number || '—'}). ${
                pending.action === 'revoke'
                  ? 'Their badge will immediately fail verification.'
                  : 'Their badge will verify again (if they are an active officer).'
              }`
            : ''
        }
      />
      {working && (
        <div className="flex items-center gap-2 text-[11px] text-[#888]">
          <Loader2 className="w-3 h-3 animate-spin" /> Working…
        </div>
      )}
    </div>
  );
}
