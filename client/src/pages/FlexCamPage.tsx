// client/src/pages/FlexCamPage.tsx
import { useEffect, useState } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';

interface Req {
  id: number;
  title: string | null;
  status: string;
  chunk_count: number;
  chunks_done: number;
  from_ts: number;
  to_ts: number;
  evidence_locked?: number;
  evidence_number?: string | null;
  classification?: string;
}

interface CustodyEntry {
  id: number;
  action: string;
  actor: string;
  note?: string | null;
  ts: number;
}

interface CustodyResult {
  request: Req;
  custody: CustodyEntry[];
  links: unknown[];
}

interface CourtPackageResult {
  manifest: unknown;
  payloadHash: string;
  signature: string;
  signedAt: string;
  algorithm: string;
  keyId: string;
}

export default function FlexCamPage() {
  const [reqs, setReqs] = useState<Req[]>([]);
  const [custodyOpen, setCustodyOpen] = useState<Record<number, CustodyResult | null>>({});
  const [custodyLoading, setCustodyLoading] = useState<Record<number, boolean>>({});
  const [pkgResult, setPkgResult] = useState<Record<number, string>>({});
  const [pkgLoading, setPkgLoading] = useState<Record<number, boolean>>({});

  useEffect(() => {
    apiFetch<{ requests: Req[] }>('/flexcam/footage')
      .then((r) => setReqs(r.requests))
      .catch(console.error);
  }, []);

  function toggleCustody(id: number) {
    if (custodyOpen[id] !== undefined) {
      // already fetched — collapse if expanded, otherwise keep collapsed state
      setCustodyOpen((prev) => {
        const next = { ...prev };
        if (next[id] !== null) {
          delete next[id];
        }
        return next;
      });
      return;
    }
    setCustodyLoading((prev) => ({ ...prev, [id]: true }));
    apiFetch<CustodyResult>(`/flexcam/footage/${id}/custody`)
      .then((res) => {
        setCustodyOpen((prev) => ({ ...prev, [id]: res }));
      })
      .catch((err: Error) => {
        setCustodyOpen((prev) => ({ ...prev, [id]: null }));
        alert(`Custody fetch failed: ${err.message}`);
      })
      .finally(() => {
        setCustodyLoading((prev) => ({ ...prev, [id]: false }));
      });
  }

  function requestCourtPkg(req: Req) {
    if (pkgLoading[req.id]) return;
    setPkgLoading((prev) => ({ ...prev, [req.id]: true }));
    setPkgResult((prev) => ({ ...prev, [req.id]: '' }));

    apiFetch<CourtPackageResult>(`/flexcam/footage/${req.id}/court-package`, {
      method: 'POST',
    })
      .then((res) => {
        // Download as JSON file
        const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `court-package-${req.id}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setPkgResult((prev) => ({
          ...prev,
          [req.id]: `Signed at ${res.signedAt} · Hash: ${res.payloadHash.slice(0, 12)}…`,
        }));
      })
      .catch((err: Error & { status?: number }) => {
        if (err.status === 409) {
          setPkgResult((prev) => ({
            ...prev,
            [req.id]: 'Evidence must be locked before generating a court package.',
          }));
        } else {
          setPkgResult((prev) => ({
            ...prev,
            [req.id]: `Error: ${err.message}`,
          }));
        }
      })
      .finally(() => {
        setPkgLoading((prev) => ({ ...prev, [req.id]: false }));
      });
  }

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="FLEXCAM — TRIP FOOTAGE" />
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-[9px] font-semibold text-left text-[#888]">
            <th>Trip</th>
            <th>Status / Evidence</th>
            <th>Chunks</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {reqs.map((r) => (
            <>
              <tr key={r.id} className="border-b border-[#232323]">
                <td className="py-[2px]">{r.title || `Request ${r.id}`}</td>
                <td>
                  <span>{r.status}</span>
                  {!!r.evidence_locked && (
                    <span className="ml-1">
                      🔒{' '}
                      {r.evidence_number && (
                        <span className="text-[#d4a017]">{r.evidence_number}</span>
                      )}
                    </span>
                  )}
                  {r.classification && (
                    <span className="ml-1 text-[#888]">({r.classification})</span>
                  )}
                </td>
                <td>{r.chunks_done}/{r.chunk_count}</td>
                <td className="space-x-2 whitespace-nowrap">
                  <a className="text-[#d4a017]" href={`/flexcam/${r.id}`}>open</a>
                  <button
                    className="text-[#d4a017] underline disabled:opacity-40"
                    onClick={() => toggleCustody(r.id)}
                    disabled={custodyLoading[r.id]}
                  >
                    {custodyLoading[r.id] ? '…' : custodyOpen[r.id] !== undefined ? 'hide' : 'custody'}
                  </button>
                  <button
                    className="text-[#d4a017] underline disabled:opacity-40"
                    onClick={() => requestCourtPkg(r)}
                    disabled={pkgLoading[r.id]}
                    title={!r.evidence_locked ? 'Lock evidence first' : undefined}
                  >
                    {pkgLoading[r.id] ? '…' : 'court pkg'}
                  </button>
                </td>
              </tr>
              {/* Court package result message */}
              {pkgResult[r.id] && (
                <tr key={`pkg-${r.id}`} className="border-b border-[#232323]">
                  <td colSpan={4} className="py-[2px] text-[#888] text-[10px]">
                    {pkgResult[r.id]}
                  </td>
                </tr>
              )}
              {/* Custody chain */}
              {custodyOpen[r.id] !== undefined && custodyOpen[r.id] !== null && (
                <tr key={`cust-${r.id}`} className="border-b border-[#232323]">
                  <td colSpan={4} className="py-1">
                    <div className="rounded-[2px] border border-[#232323] bg-[#0b0b0b] p-2 text-[10px] text-[#888]">
                      <div className="mb-1 font-semibold text-[9px] text-[#d4a017] uppercase tracking-wide">
                        Chain of Custody
                      </div>
                      {custodyOpen[r.id]!.custody.length === 0 ? (
                        <div>No custody entries.</div>
                      ) : (
                        custodyOpen[r.id]!.custody.map((entry) => (
                          <div key={entry.id} className="py-[1px] border-b border-[#232323] last:border-0">
                            <span className="text-[#d4a017]">{entry.action}</span>
                            {' — '}
                            <span>{entry.actor}</span>
                            {entry.note && <span className="ml-1 text-[#666]">({entry.note})</span>}
                            <span className="ml-2 text-[#555]">
                              {new Date(entry.ts * 1000).toLocaleString()}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </>
          ))}
          {!reqs.length && (
            <tr>
              <td colSpan={4} className="py-2 text-[#888]">No trip footage yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
