import React, { useState, useEffect, useCallback } from 'react';
import {
  Archive, Play, Eye, Save, Loader2, Clock, Trash2,
  AlertTriangle, CheckCircle2, Database, RefreshCw,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { formatDateTime } from '../../utils/dateUtils';
import { pluralize } from '../../utils/formatters';
import ConfirmDialog from '../../components/ConfirmDialog';

// ============================================================
// Data Retention & Archival Policy Manager
// ============================================================

interface RetentionPolicy {
  id: string;
  entity_type: string;
  retention_days: number;
  auto_archive: number;
  auto_delete: number;
  last_run_at?: string;
  records_affected: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

interface RetentionPreview {
  entity_type: string;
  retention_days: number;
  archivable: number;
  deletable: number;
}

interface RunResult {
  results: Array<{
    entity_type: string;
    action: string;
    affected: number;
  }>;
  total_affected: number;
}

interface Props {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

const ENTITY_LABELS: Record<string, string> = {
  activity_log: 'Activity Log',
  login_attempts: 'Login Attempts',
  patrol_scans: 'Patrol Scans',
  notifications: 'Notifications',
  sessions: 'User Sessions',
  attachments: 'File Attachments',
  messages: 'Messages',
};

export default function AdminRetentionTab({ LoadingSpinner, error, setError }: Props) {
  const [policies, setPolicies] = useState<RetentionPolicy[]>([]);
  const [preview, setPreview] = useState<RetentionPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [runConfirm, setRunConfirm] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);

  const fetchPolicies = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<RetentionPolicy[]>('/admin/retention');
      setPolicies(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load retention policies');
    } finally {
      setLoading(false);
    }
  }, [setError]);

  const fetchPreview = useCallback(async () => {
    setPreviewLoading(true);
    try {
      const data = await apiFetch<RetentionPreview[]>('/admin/retention/preview');
      setPreview(data);
    } catch {
      // Preview is optional
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPolicies();
    fetchPreview();
  }, [fetchPolicies, fetchPreview]);

  const updatePolicy = async (id: string, updates: Partial<RetentionPolicy>) => {
    setSaving(id);
    try {
      await apiFetch(`/admin/retention/${id}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
      await fetchPolicies();
      await fetchPreview();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update policy');
    } finally {
      setSaving(null);
    }
  };

  const runPolicies = async () => {
    setRunning(true);
    setRunConfirm(false);
    try {
      const result = await apiFetch<RunResult>('/admin/retention/run', { method: 'POST' });
      setRunResult(result);
      await fetchPolicies();
      await fetchPreview();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to execute retention policies');
    } finally {
      setRunning(false);
    }
  };

  if (loading && policies.length === 0) return <LoadingSpinner />;

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Archive className="w-4 h-4 text-brand-400" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-rmpg-200">Data Retention Policies</h2>
        </div>
        <div className="flex items-center gap-2">
          <button type="button"
            onClick={fetchPreview}
            disabled={previewLoading}
            className="toolbar-btn text-[10px] flex items-center gap-1"
          >
            <Eye className={`w-3 h-3 ${previewLoading ? 'animate-pulse' : ''}`} />
            Preview Impact
          </button>
          <button type="button"
            onClick={() => setRunConfirm(true)}
            disabled={running}
            className="toolbar-btn-primary text-[10px] flex items-center gap-1"
          >
            {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            Run Policies Now
          </button>
        </div>
      </div>

      {/* Run Result Banner */}
      {runResult && (
        <div className="bg-green-950/30 border border-green-800/40 p-3 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="text-xs font-bold text-green-300 mb-1">Retention policies executed successfully</div>
            <div className="text-[10px] text-green-400">
              {runResult.total_affected > 0
                ? `${pluralize(runResult.total_affected, 'record')} processed across ${runResult.results.length} ${runResult.results.length === 1 ? 'policy' : 'policies'}.`
                : 'No records needed processing.'}
            </div>
            <button type="button" onClick={() => setRunResult(null)} className="text-[10px] text-green-500 hover:text-green-300 mt-1">Dismiss</button>
          </div>
        </div>
      )}

      {/* Policies Table */}
      <div className="panel-beveled bg-surface-base overflow-hidden">
        <table className="table-dark w-full">
          <thead>
            <tr>
              <th className="text-left px-3 py-2 text-[10px]">Entity Type</th>
              <th className="text-center px-3 py-2 text-[10px]">Retention (Days)</th>
              <th className="text-center px-3 py-2 text-[10px]">Auto Archive</th>
              <th className="text-center px-3 py-2 text-[10px]">Auto Delete</th>
              <th className="text-center px-3 py-2 text-[10px]">Impact Preview</th>
              <th className="text-center px-3 py-2 text-[10px]">Last Run</th>
              <th className="text-center px-3 py-2 text-[10px]">Active</th>
              <th className="text-right px-3 py-2 text-[10px]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {policies.map((p) => {
              const prev = preview.find((pr) => pr.entity_type === p.entity_type);
              const isSaving = saving === p.id;

              return (
                <tr key={p.id} className="border-t border-rmpg-700 hover:bg-surface-raised transition-colors">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Database className="w-3 h-3 text-rmpg-500" />
                      <span className="text-xs text-rmpg-200 font-medium">{ENTITY_LABELS[p.entity_type] || p.entity_type}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="number"
                      min={7}
                      max={3650}
                      value={p.retention_days}
                      onChange={(e) => updatePolicy(p.id, { retention_days: parseInt(e.target.value, 10) || 365 })}
                      className="input-dark text-[10px] w-16 text-center font-mono"
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button type="button"
                      onClick={() => updatePolicy(p.id, { auto_archive: p.auto_archive ? 0 : 1 })}
                      className={`w-6 h-6 rounded-sm flex items-center justify-center transition-colors ${
                        p.auto_archive ? 'bg-amber-600/30 border border-amber-600 text-amber-400' : 'bg-surface-sunken border border-rmpg-700 text-rmpg-600'
                      }`}
                    >
                      <Archive className="w-3 h-3" />
                    </button>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button type="button"
                      onClick={() => updatePolicy(p.id, { auto_delete: p.auto_delete ? 0 : 1 })}
                      className={`w-6 h-6 rounded-sm flex items-center justify-center transition-colors ${
                        p.auto_delete ? 'bg-red-600/30 border border-red-600 text-red-400' : 'bg-surface-sunken border border-rmpg-700 text-rmpg-600'
                      }`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </td>
                  <td className="px-3 py-2 text-center">
                    {prev ? (
                      <div className="text-[10px] space-x-2">
                        {prev.archivable > 0 && <span className="text-amber-400">{prev.archivable} archive</span>}
                        {prev.deletable > 0 && <span className="text-red-400">{prev.deletable} delete</span>}
                        {prev.archivable === 0 && prev.deletable === 0 && <span className="text-green-400">0 affected</span>}
                      </div>
                    ) : (
                      <span className="text-[10px] text-rmpg-600">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className="text-[10px] text-rmpg-400 font-mono">
                      {p.last_run_at ? formatDateTime(p.last_run_at) : 'Never'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button type="button"
                      onClick={() => updatePolicy(p.id, { is_active: p.is_active ? 0 : 1 })}
                      className={`text-[10px] px-2 py-0.5 rounded-sm font-bold ${
                        p.is_active ? 'bg-green-900/40 text-green-400' : 'bg-rmpg-700 text-rmpg-500'
                      }`}
                    >
                      {p.is_active ? 'ON' : 'OFF'}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {isSaving && <Loader2 className="w-3 h-3 animate-spin text-brand-400 inline" />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Info Box */}
      <div className="bg-surface-sunken panel-inset p-3 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
        <div className="text-[10px] text-rmpg-400 space-y-1">
          <p><strong className="text-rmpg-300">Auto Archive</strong> sets <code className="text-rmpg-300">archived_at</code> on records older than the retention period.</p>
          <p><strong className="text-rmpg-300">Auto Delete</strong> permanently removes records older than the retention period. <span className="text-red-400">This cannot be undone.</span></p>
          <p>Policies only execute when <strong className="text-rmpg-300">Run Policies Now</strong> is clicked. There is no automatic scheduler yet.</p>
        </div>
      </div>

      {/* Run Confirmation */}
      <ConfirmDialog
        isOpen={runConfirm}
        onClose={() => setRunConfirm(false)}
        onConfirm={runPolicies}
        title="Execute Retention Policies"
        message="This will archive and/or delete records according to active retention policies. Deleted records cannot be recovered. Continue?"
        confirmLabel="Execute"
        confirmVariant="danger"
        isLoading={running}
      />
    </div>
  );
}
