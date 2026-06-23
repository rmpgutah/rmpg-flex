/**
 * ServeBulkActions — fixed bottom bar for batch operations on selected serve jobs.
 *
 * Mounts when selectedIds.size > 0. Provides: Mark Served, Mark Failed, Archive,
 * Export PDF, and Clear. All status mutations call the Worker's
 * PUT /serve/bulk-status endpoint (see apiServeBulkStatus below).
 *
 * The confirmation dialog is self-contained (no external modal dep) so the
 * component can be dropped into any folder view without additional plumbing.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  CheckCircle,
  XCircle,
  Archive,
  FileText,
  X,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import type { ServeJob } from '../../types';
import { apiFetch } from '../../hooks/useApi';

// ─── Worker API helper ────────────────────────────────────────────────────────

interface BulkStatusResult {
  updated: number;
  ids: number[];
}

/**
 * PUT /api/serve/bulk-status
 * Body: { ids: number[], status: string }
 *
 * The Worker upserts the `status` field on each row in `serve_queue` whose
 * id appears in `ids`. Returns { updated, ids }.
 */
export async function apiServeBulkStatus(
  ids: number[],
  status: string,
): Promise<BulkStatusResult> {
  return apiFetch<BulkStatusResult>('/serve/bulk-status', {
    method: 'PUT',
    body: JSON.stringify({ ids, status }),
  });
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ServeBulkActionsProps {
  selectedIds: Set<number>;
  jobs: ServeJob[];
  onClearSelection: () => void;
  /** Parent refreshes the list after a bulk status change. */
  onStatusChange: (ids: number[], newStatus: string) => Promise<void>;
  /** Parent handles PDF generation for the given ids. */
  onExport: (ids: number[]) => void;
  /** The folder currently displayed (e.g. 'pending', 'in_progress', …). */
  currentFolder: string;
}

// ─── Confirmation dialog ──────────────────────────────────────────────────────

interface ConfirmDialogProps {
  action: string;
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ action, count, onConfirm, onCancel }: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Focus the confirm button on mount for keyboard operability.
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  // Trap Escape to cancel.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-confirm-title"
      aria-describedby="bulk-confirm-desc"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[1px]"
      onClick={onCancel}
    >
      <div
        className="rounded-[2px] border border-border-default bg-surface-raised shadow-xl p-4 w-[320px] max-w-full space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" aria-hidden />
          <div>
            <p id="bulk-confirm-title" className="text-sm font-semibold text-rmpg-100">
              Confirm bulk action
            </p>
            <p id="bulk-confirm-desc" className="text-xs text-rmpg-300 mt-0.5">
              {action} will apply to{' '}
              <span className="font-bold text-rmpg-100">{count}</span> selected{' '}
              {count === 1 ? 'job' : 'jobs'}. This cannot be undone from here.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1 text-[11px] font-medium text-rmpg-300 hover:text-rmpg-100 bg-surface-sunken hover:bg-surface-sunken/80 border border-border-default rounded-[2px] transition-colors focus:outline-none focus:ring-1 focus:ring-rmpg-500/50"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className="px-3 py-1 text-[11px] font-semibold text-rmpg-100 bg-amber-700 hover:bg-amber-600 border border-amber-600 rounded-[2px] transition-colors focus:outline-none focus:ring-1 focus:ring-amber-400"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ServeBulkActions({
  selectedIds,
  jobs,
  onClearSelection,
  onStatusChange,
  onExport,
  currentFolder,
}: ServeBulkActionsProps) {
  const [pending, setPending] = useState<string | null>(null); // status being applied
  const [confirm, setConfirm] = useState<{ action: string; status: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Derive the subset of selected jobs for logic checks.
  const selectedJobs = jobs.filter((j) => selectedIds.has(j.id));
  const selectedCount = selectedIds.size;

  // Status-transition guards: disable a button when ALL selected jobs already
  // have the target status.
  const allServed  = selectedJobs.every((j) => j.status === 'served');
  const allFailed  = selectedJobs.every((j) => j.status === 'failed');
  const allArchived = selectedJobs.every((j) =>
    j.status === 'archived' || j.status === 'skipped',
  );

  const ids = Array.from(selectedIds);

  const requestConfirm = useCallback((action: string, status: string) => {
    setError(null);
    setConfirm({ action, status });
  }, []);

  const handleConfirmed = useCallback(async () => {
    if (!confirm) return;
    const { status } = confirm;
    setConfirm(null);
    setPending(status);
    setError(null);
    try {
      await apiServeBulkStatus(ids, status);
      await onStatusChange(ids, status);
      onClearSelection();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Bulk update failed';
      setError(msg);
    } finally {
      setPending(null);
    }
  }, [confirm, ids, onStatusChange, onClearSelection]);

  const handleExport = useCallback(() => {
    onExport(ids);
  }, [ids, onExport]);

  if (selectedCount === 0) return null;

  const isLoading = pending !== null;

  return (
    <>
      {/* Confirmation dialog (portal-free — sits above the bar in z-stack) */}
      {confirm && (
        <ConfirmDialog
          action={confirm.action}
          count={selectedCount}
          onConfirm={handleConfirmed}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* Fixed bottom action bar */}
      <div
        role="toolbar"
        aria-label="Bulk actions for selected serve jobs"
        className="fixed bottom-0 left-0 right-0 z-40 bg-surface-raised border-t border-border-default shadow-[0_-2px_12px_rgba(0,0,0,0.35)] px-3 py-2 flex items-center gap-2 flex-wrap"
      >
        {/* Selection count badge */}
        <span
          aria-live="polite"
          aria-atomic="true"
          className="text-[11px] font-semibold text-rmpg-200 bg-surface-sunken border border-border-default rounded-[2px] px-2 py-0.5 flex-shrink-0 tabular-nums"
        >
          {selectedCount} selected
        </span>

        {/* Error message */}
        {error && (
          <span
            role="alert"
            className="text-[10px] text-red-400 bg-red-900/30 border border-red-700/50 rounded-[2px] px-2 py-0.5 flex-shrink-0"
          >
            {error}
          </span>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Mark Served */}
          <button
            type="button"
            disabled={isLoading || allServed}
            onClick={() => requestConfirm('Mark Served', 'served')}
            aria-disabled={isLoading || allServed}
            className="
              inline-flex items-center gap-1 px-2 py-1 rounded-[2px] text-[11px] font-semibold
              transition-colors focus:outline-none focus:ring-1 focus:ring-green-400
              text-green-300 bg-green-900/40 border border-green-700/60 hover:bg-green-900/70
              disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none
            "
            title={allServed ? 'All selected jobs are already served' : 'Mark selected jobs as served'}
          >
            {pending === 'served' ? (
              <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
            ) : (
              <CheckCircle className="w-3 h-3" aria-hidden />
            )}
            Mark Served
          </button>

          {/* Mark Failed */}
          <button
            type="button"
            disabled={isLoading || allFailed}
            onClick={() => requestConfirm('Mark Failed', 'failed')}
            aria-disabled={isLoading || allFailed}
            className="
              inline-flex items-center gap-1 px-2 py-1 rounded-[2px] text-[11px] font-semibold
              transition-colors focus:outline-none focus:ring-1 focus:ring-red-400
              text-red-300 bg-red-900/40 border border-red-700/60 hover:bg-red-900/70
              disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none
            "
            title={allFailed ? 'All selected jobs are already failed' : 'Mark selected jobs as failed / non-service'}
          >
            {pending === 'failed' ? (
              <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
            ) : (
              <XCircle className="w-3 h-3" aria-hidden />
            )}
            Mark Failed
          </button>

          {/* Archive */}
          <button
            type="button"
            disabled={isLoading || allArchived}
            onClick={() => requestConfirm('Archive', 'archived')}
            aria-disabled={isLoading || allArchived}
            className="
              inline-flex items-center gap-1 px-2 py-1 rounded-[2px] text-[11px] font-semibold
              transition-colors focus:outline-none focus:ring-1 focus:ring-rmpg-400
              text-rmpg-300 bg-surface-sunken border border-border-default hover:bg-surface-raised
              disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none
            "
            title={allArchived ? 'All selected jobs are already archived' : 'Archive selected jobs'}
          >
            {pending === 'archived' ? (
              <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
            ) : (
              <Archive className="w-3 h-3" aria-hidden />
            )}
            Archive
          </button>

          {/* Export PDF */}
          <button
            type="button"
            disabled={isLoading}
            onClick={handleExport}
            className="
              inline-flex items-center gap-1 px-2 py-1 rounded-[2px] text-[11px] font-semibold
              transition-colors focus:outline-none focus:ring-1 focus:ring-brand-400
              text-brand-400 bg-surface-sunken border border-brand-400/40 hover:bg-surface-raised
              disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none
            "
            title="Export selected jobs as PDF"
          >
            <FileText className="w-3 h-3" aria-hidden />
            Export PDF
          </button>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Clear selection */}
        <button
          type="button"
          onClick={onClearSelection}
          disabled={isLoading}
          aria-label="Clear selection"
          className="
            inline-flex items-center gap-1 px-2 py-1 rounded-[2px] text-[11px] font-medium
            text-rmpg-400 hover:text-rmpg-200 border border-transparent hover:border-border-default
            transition-colors focus:outline-none focus:ring-1 focus:ring-rmpg-500/50
            disabled:opacity-40 disabled:cursor-not-allowed
          "
        >
          <X className="w-3 h-3" aria-hidden />
          Clear
        </button>
      </div>

      {/* Bottom spacer so fixed bar doesn't overlap the last card */}
      <div className="h-12" aria-hidden="true" />
    </>
  );
}
