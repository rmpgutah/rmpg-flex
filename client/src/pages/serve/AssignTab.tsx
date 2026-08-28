// client/src/pages/serve/AssignTab.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Users, Settings } from 'lucide-react';
import { useServeAssignments, type BoardJob } from '../../hooks/useServeAssignments';
import { toggleSelect, attentionSummary } from './serveAssignHelpers';

export default function AssignTab() {
  const navigate = useNavigate();
  const { board, loading, loadBoard, assign } = useServeAssignments();
  const [sel, setSel] = useState<number | 'unassigned' | null>('unassigned');
  const [picked, setPicked] = useState<number[]>([]);
  const [target, setTarget] = useState<number | ''>('');
  useEffect(() => { loadBoard(); }, [loadBoard]);

  if (loading || !board) return <div className="p-4 text-[11px] text-fg-muted">Loading board…</div>;

  const jobs: BoardJob[] = sel === 'unassigned' ? board.unassigned : (board.byOfficer[String(sel)] ?? []);

  const totals = board.officers.reduce((acc, o) => { for (const k in o.attention) acc[k] = (acc[k] ?? 0) + o.attention[k]; return acc; }, {} as Record<string, number>);
  const unassignedNear = board.unassigned.filter((j) => j.attention.includes('unassigned_near_deadline')).length;
  if (unassignedNear) totals['unassigned_near_deadline'] = (totals['unassigned_near_deadline'] ?? 0) + unassignedNear;
  const overdue = totals['deadline_passed'] ?? 0;

  const doAssign = async () => {
    if (!picked.length || target === '') return;
    await assign(picked, Number(target)); setPicked([]); await loadBoard();
  };
  // Row tint encodes deadline severity, so it must use the severity tokens —
  // not gold. Gold is reserved for field labels and panel headers, and
  // the gold accent is nearly indistinguishable from --sev-warn anyway, so a
  // decorative gold row read as a real 'due soon' warning.
  const color = (j: BoardJob) => j.attention.includes('deadline_passed')
    ? 'var(--sev-critical)'
    : j.attention.includes('deadline_approaching')
      ? 'var(--sev-warn)'
      : 'var(--text-secondary)';

  return (
    // Needs its own scroller — ServePage's tab wrapper is `flex-1
    // overflow-hidden`, so a tab without one is clipped at the pane height with
    // no scrollbar. The unassigned-pool table is the part that grows here.
    <div className="h-full overflow-y-auto p-4 grid grid-cols-[200px_1fr] gap-4 content-start scrollbar-dark">
      <div>
        <button
          type="button"
          onClick={() => navigate('/admin?tab=servemanager')}
          className="mb-2 flex items-center gap-1 text-[10px] text-fg-muted hover:text-fg-secondary"
        >
          <Settings size={11} /> ServeManager setup
        </button>
        <div className="text-[9px] font-semibold text-fg-muted uppercase mb-1">Officers</div>
        {/* These rows carried no font-size class at all, so they inherited the
            page default and rendered at 16.8px against the app's 11px dense
            standard. Worse, `justify-between` with an unconstrained name span
            pushed the count clean out of the 200px column — measured in the
            live browser at x=200/right=209 on a 200px button, i.e. 9px outside
            its own box ("Claude AI Audit User0"). min-w-0 + truncate lets the
            name yield, and flex-shrink-0 pins the count inside. */}
        <button type="button" className={`w-full flex justify-between items-center gap-2 text-[11px] px-2 py-[3px] border-b border-border-subtle ${sel === 'unassigned' ? 'text-accent-silver-300' : 'text-rmpg-300'}`} onClick={() => { setSel('unassigned'); setPicked([]); }}>
          <span className="min-w-0 truncate">Unassigned</span>
          <span className="text-fg-muted flex-shrink-0 tabular-nums">{board.unassigned.length}</span>
        </button>
        {board.officers.map((o) => (
          <button type="button" key={o.id} title={o.name} className={`w-full flex justify-between items-center gap-2 text-[11px] px-2 py-[3px] border-b border-border-subtle ${sel === o.id ? 'text-accent-silver-300' : 'text-rmpg-300'}`} onClick={() => { setSel(o.id); setPicked([]); }}>
            <span className="min-w-0 truncate text-left">{o.name}</span>
            <span className="flex gap-1 items-center flex-shrink-0"><span className="text-fg-muted tabular-nums">{o.count}</span>{attentionSummary(o.attention) && <span className="text-[color:var(--sev-critical)] text-[9px]">⚠</span>}</span>
          </button>
        ))}
      </div>

      <div>
        {(overdue > 0 || (totals['unassigned_near_deadline'] ?? 0) > 0 || (totals['deadline_approaching'] ?? 0) > 0 || (totals['diligence_gap'] ?? 0) > 0) && (
          <div className="mb-2 px-2 py-1 border border-border-subtle text-[10px] text-[color:var(--sev-critical)] bg-[color:rgb(var(--sev-critical-rgb)/0.08)]">
            ⚠ {overdue} overdue · {(totals['unassigned_near_deadline'] ?? 0)} unassigned near deadline · {(totals['deadline_approaching'] ?? 0)} due soon · {(totals['diligence_gap'] ?? 0)} stalled
          </div>
        )}
        <div className="flex items-center justify-between mb-2">
          <div className="text-[9px] font-semibold text-fg-muted uppercase flex items-center gap-1"><Users size={12} /> {sel === 'unassigned' ? 'Unassigned pool' : (board.officers.find((o) => o.id === sel)?.name ?? '') + "'s run"}</div>
          {picked.length > 0 && (
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-fg-muted">{picked.length} selected →</span>
              <select className="bg-surface-sunken border border-border-default px-1" value={target} onChange={(e) => setTarget(e.target.value === '' ? '' : Number(e.target.value))}>
                <option value="">officer…</option>
                {board.officers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <button type="button" className="px-2 py-[2px] bg-accent-silver-500 hover:bg-accent-silver-400 text-surface-base" onClick={doAssign}>Assign</button>
            </div>
          )}
        </div>
        <div className="overflow-x-auto"><table className="w-full text-[11px]">
          <thead><tr className="text-left text-[9px] text-fg-muted border-b border-border-default"><th className="py-[3px]">☐</th><th>Defendant</th><th>Address</th><th>Deadline</th><th>Flags</th></tr></thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} className="border-b border-border-subtle" style={{ color: color(j) }}>
                <td className="py-[2px]"><input type="checkbox" checked={picked.includes(j.id)} onChange={() => setPicked((p) => toggleSelect(p, j.id))} /></td>
                <td>{j.defendant_name ?? j.recipient_name ?? j.id}</td>
                <td className="text-fg-muted">{j.recipient_address ?? '—'}</td>
                <td>{j.deadline ?? '—'}</td>
                <td className="text-[9px] text-fg-muted">{j.attention.join(', ')}</td>
              </tr>
            ))}
            {jobs.length === 0 && <tr><td colSpan={5} className="text-fg-muted py-2">No jobs.</td></tr>}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
