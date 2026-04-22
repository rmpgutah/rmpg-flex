import React, { useEffect, useState } from 'react';
import {
  FileText, Loader2, AlertTriangle, RefreshCw, Eye, ToggleLeft, ToggleRight, CheckCircle2,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { PdfReviewModal } from '../../components/PdfReviewModal';
import { getV2Schema } from '../../utils/pdf/v2/forms';
import { invalidateFlagsCache } from '../../utils/pdf/facade';

interface Props {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

interface FormRow {
  key: string;
  label: string;
  wave: string;     // 'Wave 1: Blank' | 'Wave 2: Ops' | 'Wave 3: Business' | 'Wave 4: Legal'
  enabled: boolean;
  hasV2Schema: boolean;
}

// Catalog matching server's ALL_FORMS list. Order = wave + alphabetical within wave.
const FORM_CATALOG: Array<Pick<FormRow, 'key' | 'label' | 'wave' | 'hasV2Schema'>> = [
  // Wave 1 — blank forms (all 6 schemas exist on branch)
  { key: 'incident_blank',        label: 'Incident Report (blank)',     wave: 'Wave 1: Blank Forms', hasV2Schema: true },
  { key: 'person_blank',          label: 'Person Record (blank)',       wave: 'Wave 1: Blank Forms', hasV2Schema: true },
  { key: 'vehicle_blank',         label: 'Vehicle Record (blank)',      wave: 'Wave 1: Blank Forms', hasV2Schema: true },
  { key: 'property_blank',        label: 'Property Record (blank)',     wave: 'Wave 1: Blank Forms', hasV2Schema: true },
  { key: 'citation_blank',        label: 'Citation (blank)',            wave: 'Wave 1: Blank Forms', hasV2Schema: true },
  { key: 'field_interview_blank', label: 'Field Interview (blank)',     wave: 'Wave 1: Blank Forms', hasV2Schema: true },
  // Wave 2 — operational records (schemas not yet built)
  { key: 'fleet',     label: 'Fleet Record',     wave: 'Wave 2: Ops Records', hasV2Schema: false },
  { key: 'personnel', label: 'Personnel Record', wave: 'Wave 2: Ops Records', hasV2Schema: false },
  { key: 'property',  label: 'Property Record',  wave: 'Wave 2: Ops Records', hasV2Schema: false },
  // Wave 3 — business / client-facing
  { key: 'invoice',         label: 'Invoice',          wave: 'Wave 3: Business', hasV2Schema: false },
  { key: 'proposal',        label: 'Proposal',         wave: 'Wave 3: Business', hasV2Schema: false },
  { key: 'patrol_tracking', label: 'Patrol Tracking',  wave: 'Wave 3: Business', hasV2Schema: false },
  { key: 'bolo',            label: 'BOLO',             wave: 'Wave 3: Business', hasV2Schema: false },
  // Wave 4 — legal documents
  { key: 'call',                  label: 'Call for Service',          wave: 'Wave 4: Legal', hasV2Schema: false },
  { key: 'person',                label: 'Person Record',             wave: 'Wave 4: Legal', hasV2Schema: false },
  { key: 'vehicle',               label: 'Vehicle Record',            wave: 'Wave 4: Legal', hasV2Schema: false },
  { key: 'citation',              label: 'Citation',                  wave: 'Wave 4: Legal', hasV2Schema: false },
  { key: 'warrant',               label: 'Warrant',                   wave: 'Wave 4: Legal', hasV2Schema: false },
  { key: 'warrant_summary',       label: 'Warrant Summary',           wave: 'Wave 4: Legal', hasV2Schema: false },
  { key: 'evidence',              label: 'Evidence',                  wave: 'Wave 4: Legal', hasV2Schema: false },
  { key: 'affidavit_service',     label: 'Affidavit of Service',      wave: 'Wave 4: Legal', hasV2Schema: false },
  { key: 'affidavit_non_service', label: 'Affidavit of Non-Service',  wave: 'Wave 4: Legal', hasV2Schema: false },
  { key: 'service_log',           label: 'Service Log',               wave: 'Wave 4: Legal', hasV2Schema: false },
];

export default function AdminPdfEngineTab({ LoadingSpinner, error, setError }: Props) {
  const [flags, setFlags] = useState<Record<string, boolean> | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [confirmRevertAll, setConfirmRevertAll] = useState(false);
  const [previewKey, setPreviewKey] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<Record<string, boolean>>('/api/admin/pdf-engine/flags');
      setFlags(data);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load PDF engine flags');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggle = async (key: string, next: boolean) => {
    setSavingKey(key);
    try {
      await apiFetch(`/api/admin/pdf-engine/flags/${key}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: next }),
      });
      setFlags((f) => (f ? { ...f, [key]: next } : f));
      invalidateFlagsCache();
    } catch (e: any) {
      setError(e?.message ?? `Failed to toggle ${key}`);
    } finally {
      setSavingKey(null);
    }
  };

  const revertAll = async () => {
    setSavingKey('__all__');
    try {
      await apiFetch('/api/admin/pdf-engine/revert-all', { method: 'PUT' });
      await load();
      invalidateFlagsCache();
      setConfirmRevertAll(false);
    } catch (e: any) {
      setError(e?.message ?? 'Revert-all failed');
    } finally {
      setSavingKey(null);
    }
  };

  if (loading || !flags) return <LoadingSpinner />;

  // Group by wave
  const byWave = FORM_CATALOG.reduce<Record<string, FormRow[]>>((acc, f) => {
    const enabled = Boolean(flags[f.key]);
    (acc[f.wave] ||= []).push({ ...f, enabled });
    return acc;
  }, {});

  const enabledCount = Object.values(flags).filter(Boolean).length;

  return (
    <div className="p-4 space-y-4 text-white">
      <header className="flex items-start justify-between">
        <div>
          <h2 className="text-[#d4a017] font-bold flex items-center gap-2">
            <FileText size={16} /> PDF Engine Flags
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            Toggle individual forms between v1 (legacy) and v2 (new engine with preview).
            Changes take effect on next PDF generation. {enabledCount} of {FORM_CATALOG.length} forms on v2.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            disabled={savingKey !== null}
            className="px-3 py-1 text-xs bg-[#141414] border border-[#222] hover:bg-[#1a1a1a] flex items-center gap-1"
          >
            <RefreshCw size={12} /> Reload
          </button>
          {!confirmRevertAll ? (
            <button
              onClick={() => setConfirmRevertAll(true)}
              disabled={enabledCount === 0 || savingKey !== null}
              className="px-3 py-1 text-xs bg-red-900/60 border border-red-700 hover:bg-red-800 disabled:opacity-40 flex items-center gap-1"
              title="Set all flags to false (rollback to v1 for every form)"
            >
              <AlertTriangle size={12} /> Revert All to v1
            </button>
          ) : (
            <div className="flex gap-1 items-center text-xs">
              <span className="text-amber-400">Confirm?</span>
              <button onClick={revertAll} disabled={savingKey === '__all__'} className="px-2 py-1 bg-red-700 hover:bg-red-600">
                Yes, revert {enabledCount}
              </button>
              <button onClick={() => setConfirmRevertAll(false)} className="px-2 py-1 bg-[#141414] border border-[#222]">
                Cancel
              </button>
            </div>
          )}
        </div>
      </header>

      {error && (
        <div className="text-red-400 text-xs border border-red-900 bg-red-950/40 p-2">{error}</div>
      )}

      {Object.entries(byWave).map(([wave, rows]) => (
        <section key={wave} className="border border-[#222]">
          <div className="px-3 py-1 bg-gradient-to-b from-[#1a1a1a] to-[#242424] text-[#d4a017] font-bold text-xs uppercase">
            {wave}
          </div>
          <table className="w-full">
            <thead>
              <tr className="text-[9px] text-gray-500 uppercase border-b border-[#222]">
                <th className="text-left px-3 py-1 font-semibold">Form</th>
                <th className="text-left px-3 py-1 font-semibold w-20">Engine</th>
                <th className="text-left px-3 py-1 font-semibold w-32">Status</th>
                <th className="text-right px-3 py-1 font-semibold w-32">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="text-[11px] border-b border-[#1a1a1a] hover:bg-[#0d0d0d]">
                  <td className="px-3 py-[3px]">
                    {row.label}
                    <span className="text-gray-600 ml-2 text-[9px]">({row.key})</span>
                  </td>
                  <td className="px-3 py-[3px]">
                    {row.enabled ? (
                      <span className="text-emerald-400">v2</span>
                    ) : (
                      <span className="text-gray-400">v1</span>
                    )}
                  </td>
                  <td className="px-3 py-[3px]">
                    {row.hasV2Schema ? (
                      <span className="text-emerald-500 flex items-center gap-1">
                        <CheckCircle2 size={10} /> Schema ready
                      </span>
                    ) : (
                      <span className="text-gray-500">No v2 schema yet</span>
                    )}
                  </td>
                  <td className="px-3 py-[3px] text-right">
                    <div className="inline-flex gap-2 items-center">
                      {row.hasV2Schema && (
                        <button
                          onClick={() => setPreviewKey(row.key)}
                          className="text-[#d4a017] hover:underline flex items-center gap-1"
                          title="Preview the v2 output without enabling the flag"
                        >
                          <Eye size={10} /> Preview
                        </button>
                      )}
                      <button
                        onClick={() => toggle(row.key, !row.enabled)}
                        disabled={!row.hasV2Schema || savingKey === row.key}
                        className="flex items-center gap-1 disabled:opacity-30"
                        title={row.hasV2Schema
                          ? (row.enabled ? 'Disable v2 (revert to v1)' : 'Enable v2 for this form')
                          : 'No v2 schema — cannot enable'}
                      >
                        {savingKey === row.key ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : row.enabled ? (
                          <ToggleRight size={14} className="text-emerald-400" />
                        ) : (
                          <ToggleLeft size={14} className="text-gray-500" />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {previewKey && (
        <PreviewModal
          formKey={previewKey}
          onClose={() => setPreviewKey(null)}
        />
      )}
    </div>
  );
}

function PreviewModal({ formKey, onClose }: { formKey: string; onClose: () => void }) {
  let schema;
  try {
    schema = getV2Schema(formKey);
  } catch {
    return (
      <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center">
        <div className="bg-[#141414] border border-[#222] p-4 max-w-md">
          <p className="text-amber-400 text-sm">No v2 schema registered for "{formKey}".</p>
          <button onClick={onClose} className="mt-3 px-3 py-1 bg-[#1a1a1a] border border-[#222] text-xs">
            Close
          </button>
        </div>
      </div>
    );
  }
  return (
    <PdfReviewModal
      open
      schema={schema}
      initialData={{} as any}
      onClose={onClose}
      onCommit={() => onClose()}
      allowedActions={['download', 'print']}
    />
  );
}
