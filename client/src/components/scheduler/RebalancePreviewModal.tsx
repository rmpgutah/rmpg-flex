import { useState, useEffect } from 'react';
import { apiFetch } from '../../hooks/useApi';
import ConfirmDialog from '../ConfirmDialog';

interface RebalanceChange {
  queue_id: number;
  from_tier: string | null;
  to_tier: string;
  from_priority: string;
  to_priority: string | null;
  reason: string;
}

interface RebalanceResponse {
  dry_run: boolean;
  changes: RebalanceChange[];
  skipped_manual: number;
  tiers_promoted_critical: number;
  priority_escalated: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onApplied?: () => void;
}

export default function RebalancePreviewModal({ open, onClose, onApplied }: Props) {
  const [preview, setPreview] = useState<RebalanceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!open) { setPreview(null); setError(null); return; }
    setLoading(true);
    apiFetch<RebalanceResponse>('/serve-intake/schedule/rebalance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dry_run: true }),
    })
      .then(setPreview)
      .catch((e) => setError(e instanceof Error ? e.message : 'Preview failed'))
      .finally(() => setLoading(false));
  }, [open]);

  const handleApply = async () => {
    setConfirmOpen(false);
    setApplying(true);
    try {
      await apiFetch('/serve-intake/schedule/rebalance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: false }),
      });
      onApplied?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Apply failed');
    } finally {
      setApplying(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div className="bg-surface-base border border-rmpg-700 rounded-[2px] max-w-lg w-full">
          <div className="px-3 py-2 border-b border-rmpg-700 bg-surface-raised text-[12px] font-semibold uppercase tracking-wide text-rmpg-100">
            Auto-rebalance preview
          </div>
          <div className="px-3 py-2 text-[11px] text-rmpg-200">
            {loading ? <div>Computing…</div>
              : error ? <div className="text-red-300">{error}</div>
              : preview ? (
                <div className="space-y-1">
                  <div>{preview.tiers_promoted_critical} slot(s) promoted to <span className="text-red-300">critical</span></div>
                  <div>{preview.priority_escalated} priority escalation(s) to rush</div>
                  <div>{preview.skipped_manual} manually-moved slot(s) skipped</div>
                  <div className="mt-2 text-rmpg-400">Total queue rows affected: {preview.changes.length}</div>
                </div>
              ) : null
            }
          </div>
          <div className="px-3 py-2 border-t border-rmpg-700 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={applying}
              className="px-3 py-1 text-[11px] uppercase border border-rmpg-700 rounded-[2px] text-rmpg-300 hover:bg-surface-raised disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={!preview || preview.changes.length === 0 || applying}
              className="px-3 py-1 text-[11px] uppercase bg-brand-500/30 text-brand-100 border border-brand-500 rounded-[2px] hover:bg-brand-500/40 disabled:opacity-50"
            >
              {applying ? 'Applying…' : 'Apply changes'}
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleApply}
        title="Apply rebalance"
        confirmVariant="warning"
        confirmLabel="Apply"
        message="This will reassign urgency tiers and priority levels for the affected serve queue rows. Manually-moved slots are skipped."
        details={preview ? (
          <>
            <div>{preview.changes.length} row(s) will be updated</div>
            {preview.tiers_promoted_critical > 0 && (
              <div>{preview.tiers_promoted_critical} slot(s) promoted to critical</div>
            )}
          </>
        ) : undefined}
        isLoading={applying}
      />
    </>
  );
}
