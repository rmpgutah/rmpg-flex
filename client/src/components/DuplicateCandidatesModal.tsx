import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, X, Loader2, Users } from 'lucide-react';

// Generic duplicate-candidates picker. Used by dispatch quick-add for persons,
// vehicles, and businesses. The caller passes the candidate list returned by
// the server's 409 DUPLICATE_CANDIDATES response plus a row-render function so
// each entity type can show its own meaningful columns. The dialog returns:
//   - { action: 'merge', id }   → caller resends with merge_into_id: id
//   - { action: 'force_create' } → caller resends with force_create: true
//   - null (cancelled)          → caller does nothing
export interface DuplicateCandidate {
  id: number;
  [field: string]: any;
}

interface Props {
  isOpen: boolean;
  title: string;             // e.g. "Possible existing person"
  entityLabel: string;       // e.g. "person", "vehicle", "business" — used in copy
  candidates: DuplicateCandidate[];
  renderRow: (c: DuplicateCandidate) => React.ReactNode;
  isSubmitting?: boolean;
  onClose: () => void;
  onResolve: (resolution: { action: 'merge'; id: number } | { action: 'force_create' }) => void;
}

export default function DuplicateCandidatesModal({
  isOpen, title, entityLabel, candidates, renderRow, isSubmitting, onClose, onResolve,
}: Props) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Reset selection whenever the candidates list changes (new dup check)
  useEffect(() => { setSelectedId(null); }, [candidates]);

  // Body scroll lock + ESC to close + initial focus
  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    const raf = requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('button, [tabindex]:not([tabindex="-1"])')?.focus();
    });
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      ref={dialogRef}
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" role="presentation" />
      <div
        className="relative w-full max-w-2xl mx-4 bg-surface-base border border-rmpg-600 shadow-md animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-4 py-2 border-b border-rmpg-600"
          style={{ background: 'linear-gradient(180deg, #181818 0%, #141414 100%)' }}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <h2 id={titleId} className="text-xs font-bold text-white uppercase tracking-wider">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 min-w-[32px] min-h-[32px] flex items-center justify-center hover:bg-rmpg-700 text-rmpg-400 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <p className="text-sm text-rmpg-200 leading-relaxed flex items-start gap-2">
            <Users className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
            <span>
              Found <strong className="text-amber-300">{candidates.length}</strong> existing {entityLabel}
              {candidates.length === 1 ? '' : 's'} that may already be this one.
              Pick a row to <strong>link the existing record</strong>, or click
              {' '}<em>Create New Anyway</em> to add a separate record.
            </span>
          </p>

          <div className="max-h-[50vh] overflow-y-auto border border-rmpg-700 bg-black/40">
            <ul role="listbox" aria-label={`Possible existing ${entityLabel} matches`} className="divide-y divide-rmpg-800">
              {candidates.map((c) => {
                const isSel = selectedId === c.id;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSel}
                      onClick={() => setSelectedId(c.id)}
                      onDoubleClick={() => { setSelectedId(c.id); onResolve({ action: 'merge', id: c.id }); }}
                      className={`w-full text-left px-3 py-2 text-xs transition-colors focus:outline-none ${
                        isSel
                          ? 'bg-amber-900/40 text-white border-l-2 border-amber-400'
                          : 'text-rmpg-200 hover:bg-rmpg-800 border-l-2 border-transparent'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">{renderRow(c)}</div>
                        <span className="text-[10px] text-rmpg-500 font-mono whitespace-nowrap">#{c.id}</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="flex items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={() => onResolve({ action: 'force_create' })}
              disabled={isSubmitting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wide border border-rmpg-600 bg-rmpg-800 hover:bg-rmpg-700 text-rmpg-100 transition-colors disabled:opacity-50"
              title="Create a new record even though duplicates exist"
            >
              {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Create New Anyway
            </button>
            <div className="flex items-center gap-3">
              <button type="button" onClick={onClose} disabled={isSubmitting} className="toolbar-btn">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => selectedId != null && onResolve({ action: 'merge', id: selectedId })}
                disabled={isSubmitting || selectedId == null}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wide border border-amber-500 bg-amber-700 hover:bg-amber-600 text-white transition-colors disabled:opacity-50"
              >
                {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Link Selected
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
