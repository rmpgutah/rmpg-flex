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
}

export default function FlexCamPage() {
  const [reqs, setReqs] = useState<Req[]>([]);
  useEffect(() => {
    apiFetch<{ requests: Req[] }>('/flexcam/footage')
      .then((r) => setReqs(r.requests))
      .catch(console.error);
  }, []);
  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="FLEXCAM — TRIP FOOTAGE" />
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-[9px] font-semibold text-left text-[#888]">
            <th>Trip</th>
            <th>Status</th>
            <th>Chunks</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {reqs.map((r) => (
            <tr key={r.id} className="border-b border-[#232323]">
              <td className="py-[2px]">{r.title || `Request ${r.id}`}</td>
              <td>{r.status}</td>
              <td>{r.chunks_done}/{r.chunk_count}</td>
              <td>
                <a className="text-[#d4a017]" href={`/flexcam/${r.id}`}>open</a>
              </td>
            </tr>
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
