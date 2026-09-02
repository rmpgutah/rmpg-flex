// ============================================================
// RMPG Flex — NSOPW Nationwide SOR Cross-Reference page.
// ------------------------------------------------------------
// The canonical Sex Offender Registry surface. Replaces the legacy
// Utah-only `/sex-offender-registry` and RMPG-internal
// `/offender-registry` pages (both now redirect here — see
// /App.tsx). Deep-link contract:
//   /nsopw?offender_id=<row>   — pre-load a specific offender card
//                                  (also accepted on /offender-registry
//                                  and /sex-offender-registry).
//   /nsopw?surname=&forename=&dob=  — pre-fill + auto-fire the search.
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Shield, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import NsopwSearchPanel from '../components/NsopwSearchPanel';
import PanelTitleBar from '../components/PanelTitleBar';
import { safeDateTimeStr } from '../utils/dateUtils';

interface NsopwStatus {
  configured: boolean;
  offenderCount: number;
  lastRun: Record<string, unknown> | null;
  coverage: { available: boolean; severity: 'ok' | 'warning'; message?: string };
}

export default function NsopwLookupPage() {
  const [status, setStatus] = useState<NsopwStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  // ── URL deep-link inputs ──
  // The page accepts three forms (sorted by precedence below):
  //   offender_id  → loads the offender record straight from the worker
  //                   (NsopwSearchPanel handles the fetch + card render).
  //   surname/forename/(dob)  → pre-fills the form + auto-runs the search.
  // We only read the params once on mount; the panel strips them after
  // applying so refresh doesn't re-fire.
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLink = useMemo(() => ({
    offenderId: searchParams.get('offender_id') ?? '',
    surname: searchParams.get('surname') ?? searchParams.get('name') ?? '',
    forename: searchParams.get('forename') ?? '',
    dob: searchParams.get('dob') ?? '',
  // The hash is the source of truth on mount; subsequent param changes
  // don't re-arm the deep-link (intentional — operator can replay via URL
  // bar refresh if they want to).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // Strip deep-link params after reading them on mount so refresh doesn't re-fire.
  useEffect(() => {
    const hasParams = searchParams.has('surname') || searchParams.has('forename') ||
      searchParams.has('dob') || searchParams.has('offender_id');
    if (hasParams) {
      setSearchParams((p) => {
        p.delete('surname'); p.delete('forename'); p.delete('dob'); p.delete('offender_id');
        return p;
      }, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadStatus = () => {
    setStatusError(false);
    apiFetch<NsopwStatus>('/nsopw/status')
      .then(setStatus)
      .catch(() => setStatusError(true));
  };
  useEffect(() => { loadStatus(); }, []);

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

      {statusError && (
        <div className="text-[11px] text-red-400 flex items-center justify-between">
          <span>Could not load NSOPW status.</span>
          <button type="button" className="px-2 py-[1px] border border-border-default" onClick={loadStatus}>Retry</button>
        </div>
      )}
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

      <NsopwSearchPanel
        initialOffenderId={deepLink.offenderId || undefined}
        initialSurname={deepLink.surname}
        initialForename={deepLink.forename}
        initialDob={deepLink.dob}
        autoSearch={Boolean(deepLink.surname && deepLink.forename)}
        onClearOffenderId={() =>
          setSearchParams((p) => { p.delete('offender_id'); return p; }, { replace: true })
        }
      />

      {status && (
        <div className="text-[10px] text-rmpg-400 border-t border-border-subtle pt-2">
          {status.offenderCount.toLocaleString()} offender record(s) cached locally.
          {status.lastRun &&
            ` Last run: ${safeDateTimeStr(status.lastRun.ran_at as string)} (${String(status.lastRun.kind)}).`}
        </div>
      )}
    </div>
  );
}
