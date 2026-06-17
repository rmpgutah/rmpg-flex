// Intel command-center BOLO board. Priority-grouped cards over the existing
// /comms/bolos API. Surfaces ACTIVE BOLOs; create + resolve/cancel. (Full
// lifecycle/history is the Communications BOLO view's job.)
import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useBolos } from './useBolos';
import BoloCard from './bolo/BoloCard';
import BoloCreateModal from './bolo/BoloCreateModal';

const PRIORITIES = ['P1', 'P2', 'P3'] as const;
const ADMIN_ROLES = new Set(['admin', 'manager']);

export default function BoloBoard() {
  const { bolos, loading, error, create, resolve, remove } = useBolos();
  const { user } = useAuth();
  const canDelete = ADMIN_ROLES.has(String((user as any)?.role || '').toLowerCase());
  const [creating, setCreating] = useState(false);

  // Server returns active by default; defensive filter in case a non-active row slips through.
  const visible = useMemo(() => bolos.filter((b) => b.status === 'active'), [bolos]);
  const groups = useMemo(() => {
    const g: Record<string, typeof bolos> = { P1: [], P2: [], P3: [] };
    const other: typeof bolos = [];
    for (const b of visible) (g[b.priority] ? g[b.priority] : other).push(b);
    return { g, other };
  }, [visible]);

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-3">
        <div className="font-mono text-[10px] tracking-widest text-[#888] uppercase flex-1">Active BOLOs ({visible.length})</div>
        <button onClick={() => setCreating(true)}
          className="flex items-center gap-1 font-mono text-[9px] tracking-wide text-black bg-[#d4a017] rounded-[2px] px-2 py-[4px] uppercase">
          <Plus size={11} /> New BOLO
        </button>
      </div>

      {error && <div className="text-[10px] text-[#ff6b5e]">{error}</div>}
      {loading && <div className="text-[11px] text-[#888]">Loading BOLOs…</div>}
      {!loading && visible.length === 0 && <div className="text-[11px] text-rmpg-500">No active BOLOs.</div>}

      {PRIORITIES.map((p) => groups.g[p].length > 0 && (
        <div key={p}>
          <div className="font-mono text-[8px] tracking-widest text-rmpg-500 uppercase mb-1">Priority {p}</div>
          <div className="grid grid-cols-2 gap-2">
            {groups.g[p].map((b) => <BoloCard key={b.id} bolo={b} canDelete={canDelete} onResolve={resolve} onDelete={remove} />)}
          </div>
        </div>
      ))}
      {groups.other.length > 0 && (
        <div>
          <div className="font-mono text-[8px] tracking-widest text-rmpg-500 uppercase mb-1">Other</div>
          <div className="grid grid-cols-2 gap-2">
            {groups.other.map((b) => <BoloCard key={b.id} bolo={b} canDelete={canDelete} onResolve={resolve} onDelete={remove} />)}
          </div>
        </div>
      )}

      {creating && <BoloCreateModal onClose={() => setCreating(false)} onCreate={create} />}
    </div>
  );
}
