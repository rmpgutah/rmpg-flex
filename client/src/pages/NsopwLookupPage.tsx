// ============================================================
// RMPG Flex — NSOPW Nationwide SOR Cross-Reference page.
// ------------------------------------------------------------
// Standalone page hosting the NsopwSearchPanel + a coverage banner.
// Linked from SexOffenderRegistryPage as the "Nationwide" tab.
// ============================================================

import { useEffect, useState } from 'react';
import { Shield, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import NsopwSearchPanel from '../components/NsopwSearchPanel';
import PanelTitleBar from '../components/PanelTitleBar';

interface NsopwStatus {
  configured: boolean;
  offenderCount: number;
  lastRun: Record<string, unknown> | null;
  coverage: { available: boolean; severity: 'ok' | 'warning'; message?: string };
}

export default function NsopwLookupPage() {
  const [status, setStatus] = useState<NsopwStatus | null>(null);

  useEffect(() => {
    apiFetch<NsopwStatus>('/nsopw/status')
      .then(setStatus)
      .catch((err) => console.warn('nsopw status failed:', err));
  }, []);

  return (
    <div className="p-3 space-y-3 max-w-6xl mx-auto">
      <PanelTitleBar title="NSOPW — NATIONWIDE SEX OFFENDER REGISTRY" icon={Shield} />

      <div className="bg-surface-raised border border-border-subtle p-2 text-[11px] text-rmpg-200">
        Federated cross-reference across all 50 states + U.S. territories + tribal
        jurisdictions in a single query. Operated by the U.S. Department of
        Justice. <strong>Cross-reference by name + DOB.</strong> Without DOB,
        common names return dozens of false candidates — DOB is strongly
        recommended on every search.
      </div>

      {status && !status.configured && (
        <div className="bg-amber-950/40 border border-amber-700/50 text-amber-300 px-2 py-2 text-[11px]">
          <div className="font-bold flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> NSOPW is not yet configured.
          </div>
          <div className="mt-1">
            {status.coverage.message ??
              'The DOJ NSOPW Web Service requires a Memorandum of Understanding. ' +
              'Once issued, set NSOPW_API_KEY on the Worker via wrangler.'}
          </div>
        </div>
      )}

      <NsopwSearchPanel />

      {status && (
        <div className="text-[10px] text-rmpg-400 border-t border-border-subtle pt-2">
          {status.offenderCount.toLocaleString()} offender record(s) cached locally.
          {status.lastRun &&
            ` Last run: ${String(status.lastRun.ran_at)} (${String(status.lastRun.kind)}).`}
        </div>
      )}
    </div>
  );
}
