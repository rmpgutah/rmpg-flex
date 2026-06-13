// client/src/pages/serve/AssignTab.tsx
import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { useServeAssignments, type BoardJob } from '../../hooks/useServeAssignments';
import { toggleSelect, attentionSummary } from './serveAssignHelpers';

export default function AssignTab() {
  const { board, loading, loadBoard, assign } = useServeAssignments();
  const [sel, setSel] = useState<number | 'unassigned' | null>('unassigned');
  const [picked, setPicked] = useState<number[]>([]);
  const [target, setTarget] = useState<number | ''>('');
  useEffect(() => { loadBoard(); }, [loadBoard]);

  if (loading || !board) return <div className="p-4 text-[11px] text-[#888]">Loading board…</div>;

  const jobs: BoardJob[] = sel === 'unassigned' ? board.unassigned : (board.byOfficer[String(sel)] ?? []);

  const totals = board.officers.reduce((acc, o) => { for (const k in o.attention) acc[k] = (acc[k] ?? 0) + o.attention[k]; return acc; }, {} as Record<string, number>);
  const unassignedNear = board.unassigned.filter((j) => j.attention.includes('unassigned_near_deadline')).length;
  if (unassignedNear) totals['unassigned_near_deadline'] = (totals['unassigned_near_deadline'] ?? 0) + unassignedNear;
  const overdue = totals['deadline_passed'] ?? 0;

  const doAssign = async () => {
    if (!picked.length || target === '') return;
    await assign(picked, Number(target)); setPicked([]); await loadBoard();
  };
  const color = (j: BoardJob) => j.attention.includes('deadline_passed') ? '#e0533d' : j.attention.includes('deadline_approaching') ? '#d4a017' : '#ccc';

  return (
    <div className="p-4 grid grid-cols-[200px_1fr] gap-4">
      <div>
        <div className="text-[9px] font-semibold text-[#888] uppercase mb-1">Officers</div>
        <button className={`w-full flex justify-between px-2 py-[3px] border-b border-[#141414] ${sel === 'unassigned' ? 'text-[#d4a017]' : 'text-[#ccc]'}`} onClick={() => { setSel('unassigned'); setPicked([]); }}>
          <span>Unassigned</span><span className="text-[#888]">{board.unassigned.length}</span>
        </button>
        {board.officers.map((o) => (
          <button key={o.id} className={`w-full flex justify-between px-2 py-[3px] border-b border-[#141414] ${sel === o.id ? 'text-[#d4a017]' : 'text-[#ccc]'}`} onClick={() => { setSel(o.id); setPicked([]); }}>
            <span>{o.name}</span>
            <span className="flex gap-1 items-center"><span className="text-[#888]">{o.count}</span>{attentionSummary(o.attention) && <span className="text-[#e0533d] text-[9px]">⚠</span>}</span>
          </button>
        ))}
      </div>

      <div>
        {(overdue > 0 || (totals['unassigned_near_deadline'] ?? 0) > 0 || (totals['deadline_approaching'] ?? 0) > 0 || (totals['diligence_gap'] ?? 0) > 0) && (
          <div className="mb-2 px-2 py-1 border border-[#3a3a3a] text-[10px] text-[#e0533d] bg-[#1a0f0d]">
            ⚠ {overdue} overdue · {(totals['unassigned_near_deadline'] ?? 0)} unassigned near deadline · {(totals['deadline_approaching'] ?? 0)} due soon · {(totals['diligence_gap'] ?? 0)} stalled
          </div>
        )}
        <div className="flex items-center justify-between mb-2">
          <div className="text-[9px] font-semibold text-[#888] uppercase flex items-center gap-1"><Users size={12} /> {sel === 'unassigned' ? 'Unassigned pool' : (board.officers.find((o) => o.id === sel)?.name ?? '') + "'s run"}</div>
          {picked.length > 0 && (
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-[#888]">{picked.length} selected →</span>
              <select className="bg-[#0b0b0b] border border-[#232323] px-1" value={target} onChange={(e) => setTarget(e.target.value === '' ? '' : Number(e.target.value))}>
                <option value="">officer…</option>
                {board.officers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <button className="px-2 py-[2px] bg-[#d4a017] text-black" onClick={doAssign}>Assign</button>
            </div>
          )}
        </div>
        <table className="w-full text-[11px]">
          <thead><tr className="text-left text-[9px] text-[#888] border-b border-[#232323]"><th className="py-[3px]">☐</th><th>Defendant</th><th>Address</th><th>Deadline</th><th>Flags</th></tr></thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} className="border-b border-[#121212]" style={{ color: color(j) }}>
                <td className="py-[2px]"><input type="checkbox" checked={picked.includes(j.id)} onChange={() => setPicked((p) => toggleSelect(p, j.id))} /></td>
                <td>{j.defendant_name ?? j.recipient_name ?? j.id}</td>
                <td className="text-[#888]">{j.recipient_address ?? '—'}</td>
                <td>{j.deadline ?? '—'}</td>
                <td className="text-[9px] text-[#888]">{j.attention.join(', ')}</td>
              </tr>
            ))}
            {jobs.length === 0 && <tr><td colSpan={5} className="text-[#888] py-2">No jobs.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
