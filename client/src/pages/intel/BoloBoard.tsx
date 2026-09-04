// Intel command-center BOLO board. Priority-grouped cards over the existing
// /comms/bolos API. Surfaces ACTIVE BOLOs; create + resolve/cancel. (Full
// lifecycle/history is the Communications BOLO view's job.)
//
// v1047 — Page 30 (Intel Portal) audit:
//   • Cancel BOLO is destructive (admin role, removes the row entirely).
//     The prior implementation fired DELETE on click with zero confirmation;
//     a misclick erased an active critical alert. Now gated by ConfirmDialog
//     (danger variant, Cancel button pre-focused — same contract used by
//     Court Tracker / Field Interviews / Evidence in v1024–v1037).
//   • URL deep-link `/intel/bolos?bolo_id=<id>` direct-fetches the BOLO
//     (uses GET /comms/bolos/:id — already on the worker), highlights its
//     card, and strips the param so a refresh doesn't re-fetch. Lets units
//     paste a BOLO link into the MDT and have it land highlighted.
//   • "N" keyboard shortcut → opens the New BOLO modal (typing-suppressed
//     so it doesn't fire while operators are typing in any input).
//   • Esc smart-cascade — cancel confirm closes first, then the create
//     modal (Court Tracker pattern).
//   • Distinct empty state — when there are no active BOLOs at all, give
//     the operator a way to act, not just a flat "No active BOLOs." string.
import { useMemo, useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { Plus, Flag } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ToastProvider';
import ConfirmDialog from '../../components/ConfirmDialog';
import { apiFetch } from '../../hooks/useApi';
import { useBolos, type Bolo } from './useBolos';
import BoloCard from './bolo/BoloCard';
import BoloCreateModal from './bolo/BoloCreateModal';
import { formatEnumValue } from '../../utils/formatters';

const PRIORITIES = ['P1', 'P2', 'P3'] as const;
const ADMIN_ROLES = new Set(['admin', 'manager']);

export default function BoloBoard() {
  const { bolos, loading, error, create, resolve, remove } = useBolos();
  const { user } = useAuth();
  const { addToast } = useToast();
  const canDelete = ADMIN_ROLES.has(String((user as any)?.role || '').toLowerCase());
  const [creating, setCreating] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Bolo | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);

  // Server returns active by default; defensive filter in case a non-active row slips through.
  const visible = useMemo(() => bolos.filter((b) => b.status === 'active'), [bolos]);
  const groups = useMemo(() => {
    const g: Record<string, typeof bolos> = { P1: [], P2: [], P3: [] };
    const other: typeof bolos = [];
    for (const b of visible) (g[b.priority] ? g[b.priority] : other).push(b);
    return { g, other };
  }, [visible]);

  // ── `?bolo_id=<id>` URL deep-link auto-select ──
  // Pre-loads the BOLO and scrolls/highlights its card. The BOLO might be
  // returned by /comms/bolos already (active list) OR it might not (resolved
  // or expired) — fetch the row directly so the highlight always lands.
  const [searchParams, setSearchParams] = useSearchParams();
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [deepLinkedBolo, setDeepLinkedBolo] = useState<Bolo | null>(null);
  const pendingBoloIdRef = useRef<string | null>(searchParams.get('bolo_id'));
  useEffect(() => {
    const target = pendingBoloIdRef.current;
    if (!target) return;
    pendingBoloIdRef.current = null;
    const id = parseInt(target, 10);
    if (!Number.isFinite(id) || id <= 0) return;
    let cancelled = false;
    (async () => {
      try {
        const row = await apiFetch<Bolo>(`/comms/bolos/${id}`);
        if (cancelled) return;
        if (row && (row as any).id != null) {
          setHighlightId(row.id);
          // If the deep-linked BOLO isn't in the active list, surface it as
          // a standalone card so a court-attached BOLO link doesn't dead-end.
          setDeepLinkedBolo(row);
        } else {
          addToast(`BOLO #${id} not found`, 'warning');
        }
      } catch {
        if (!cancelled) addToast(`Failed to load BOLO #${id}`, 'error');
      } finally {
        if (!cancelled) {
          const next = new URLSearchParams(searchParams);
          next.delete('bolo_id');
          setSearchParams(next, { replace: true });
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-clear the highlight after 6s so it doesn't ghost into other workflows.
  useEffect(() => {
    if (highlightId == null) return;
    const t = setTimeout(() => setHighlightId(null), 6000);
    return () => clearTimeout(t);
  }, [highlightId]);

  // "N" keyboard shortcut → opens the New BOLO modal. Typing-aware
  // (skipped while focus is in any input/textarea/contenteditable). Same
  // contract used across MDT / Patrol / Cases / Court Tracker.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'n' && e.key !== 'N') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return;
      }
      if (creating || cancelTarget) return; // don't open on top of another modal
      e.preventDefault();
      setCreating(true);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [creating, cancelTarget]);

  // Esc smart-cascade — cancel confirm (smallest, most-recent) closes first,
  // then the create modal. ConfirmDialog already binds its own Esc — but
  // we still need the cascade for the create modal which doesn't.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (cancelTarget) return; // ConfirmDialog handles its own Esc
      if (creating) { setCreating(false); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [creating, cancelTarget]);

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    setCancelBusy(true);
    try {
      await remove(cancelTarget.id);
      addToast(`BOLO ${cancelTarget.bolo_number} cancelled`, 'success');
      setCancelTarget(null);
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to cancel BOLO', 'error');
    } finally {
      setCancelBusy(false);
    }
  };

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-3">
        <div className="font-mono text-[10px] tracking-widest text-rmpg-400 uppercase flex-1">Active BOLOs ({visible.length})</div>
        <button onClick={() => setCreating(true)}
          title="New BOLO (N)"
          className="flex items-center gap-1 font-mono text-[9px] tracking-wide text-black bg-brand-600 rounded-[2px] px-2 py-[4px] uppercase">
          <Plus size={11} /> New BOLO <span className="text-[8px] opacity-70 ml-1">N</span>
        </button>
      </div>

      {error && <div className="text-[10px] text-red-400">{error}</div>}
      {loading && <div className="text-[11px] text-rmpg-500">Loading BOLOs…</div>}

      {/* Distinct empty state — the prior "No active BOLOs." line looked
          identical to a server-side error. Give the operator a way to act. */}
      {!loading && visible.length === 0 && !deepLinkedBolo && (
        <div className="border border-dashed border-border-default rounded-[2px] py-6 px-4 text-center">
          <Flag size={20} className="mx-auto text-rmpg-500 mb-2" />
          <div className="text-[11px] text-rmpg-300">No active BOLOs.</div>
          <div className="text-[10px] text-rmpg-500 mt-1">Press <span className="font-mono text-brand-400">N</span> or click <span className="font-mono text-brand-400">New BOLO</span> to issue one.</div>
        </div>
      )}

      {deepLinkedBolo && !visible.some((b) => b.id === deepLinkedBolo.id) && (
        <div className="border border-brand-500 bg-brand-900/20 rounded-[2px] p-2">
          <div className="font-mono text-[8px] tracking-widest text-brand-400 uppercase mb-1">Deep-Link BOLO ({deepLinkedBolo.status})</div>
          <BoloCard
            bolo={deepLinkedBolo}
            canDelete={false}
            onResolve={() => addToast('Already resolved', 'info')}
            onDelete={() => addToast('Already resolved', 'info')}
          />
        </div>
      )}

      {PRIORITIES.map((p) => groups.g[p].length > 0 && (
        <div key={p}>
          <div className="font-mono text-[8px] tracking-widest text-rmpg-500 uppercase mb-1">Priority {p}</div>
          <div className="grid grid-cols-2 gap-2">
            {groups.g[p].map((b) => (
              <div key={b.id} className={highlightId === b.id ? 'ring-2 ring-brand-500 rounded-[2px]' : undefined}>
                <BoloCard
                  bolo={b}
                  canDelete={canDelete}
                  onResolve={resolve}
                  onDelete={() => setCancelTarget(b)}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
      {groups.other.length > 0 && (
        <div>
          <div className="font-mono text-[8px] tracking-widest text-rmpg-500 uppercase mb-1">Other</div>
          <div className="grid grid-cols-2 gap-2">
            {groups.other.map((b) => (
              <div key={b.id} className={highlightId === b.id ? 'ring-2 ring-brand-500 rounded-[2px]' : undefined}>
                <BoloCard
                  bolo={b}
                  canDelete={canDelete}
                  onResolve={resolve}
                  onDelete={() => setCancelTarget(b)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {creating && <BoloCreateModal onClose={() => setCreating(false)} onCreate={create} />}

      <ConfirmDialog
        isOpen={cancelTarget != null}
        onClose={() => !cancelBusy && setCancelTarget(null)}
        onConfirm={confirmCancel}
        title="Cancel BOLO?"
        message={`Cancel ${cancelTarget?.bolo_number || 'this BOLO'}? This removes it from active dispatch view.`}
        details={cancelTarget ? (
          <>
            <div><span className="text-rmpg-500">Title:</span> {cancelTarget.title}</div>
            <div><span className="text-rmpg-500">Priority:</span> {formatEnumValue(cancelTarget.priority)}</div>
            {cancelTarget.subject_description && <div><span className="text-rmpg-500">Subject:</span> {cancelTarget.subject_description}</div>}
            {cancelTarget.vehicle_description && <div><span className="text-rmpg-500">Vehicle:</span> {cancelTarget.vehicle_description}</div>}
          </>
        ) : undefined}
        confirmLabel="Cancel BOLO"
        cancelLabel="Keep BOLO"
        confirmVariant="danger"
        isLoading={cancelBusy}
      />
    </div>
  );
}
