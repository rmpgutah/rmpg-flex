import React, { useCallback, useState } from 'react';
import { apiFetch } from '../../hooks/useApi';
import {
  ADDRESS_CLASS_OPTIONS,
  VENUE_OPTIONS,
  parseServeJobMeta,
  ensureServeJobOps,
  type ServeJobOps,
} from '../../utils/serveJobIntake';
import type { ServeJob } from '../../types';

export default function ServeJobQuickFields({
  job,
  onUpdated,
}: {
  job: ServeJob;
  onUpdated: (parsedData: string) => void;
}) {
  const meta = parseServeJobMeta(job.parsed_data);
  const [ops, setOps] = useState<ServeJobOps>(ensureServeJobOps(meta.ops));
  const [klass, setKlass] = useState(meta.addressClass);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = useCallback(async () => {
    setSaving(true);
    setErr(null);
    try {
      await apiFetch(`/process-server/${job.id}/address-class`, {
        method: 'PATCH',
        body: JSON.stringify({ klass, confirmed: klass !== 'unknown' }),
      });
      const res = await apiFetch<{ success: boolean }>(`/process-server/${job.id}/ops`, {
        method: 'PATCH',
        body: JSON.stringify(ops),
      });
      // Parent refreshes parsed_data from a list reload; merge locally for snappiness.
      let pd: Record<string, unknown> = {};
      try { pd = job.parsed_data ? JSON.parse(job.parsed_data) : {}; } catch { pd = {}; }
      pd._ops = ops;
      const intake = (pd._intake && typeof pd._intake === 'object') ? pd._intake as Record<string, unknown> : {};
      intake.address_class = { klass, confirmed: klass !== 'unknown' };
      pd._intake = intake;
      onUpdated(JSON.stringify(pd));
      void res;
    } catch {
      setErr('Could not save scene fields');
    } finally {
      setSaving(false);
    }
  }, [job.id, job.parsed_data, klass, ops, onUpdated]);

  const chk = (key: keyof ServeJobOps, label: string) => (
    <label className="inline-flex items-center gap-1 text-[10px] text-rmpg-200 cursor-pointer">
      <input
        type="checkbox"
        checked={!!ops[key]}
        onChange={(e) => setOps((p) => ({ ...p, [key]: e.target.checked }))}
        className="w-3 h-3 rounded-[2px] border-rmpg-600 bg-surface-deep"
      />
      {label}
    </label>
  );

  return (
    <div className="space-y-1.5 p-2 rounded-[2px] border border-rmpg-700/40 bg-surface-sunken/40">
      <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--panel-header-color)' }}>
        Scene / Packet — quick edit
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <div>
          <label className="block text-[9px] text-fg-muted mb-0.5">Location type</label>
          <select
            value={klass}
            onChange={(e) => setKlass(e.target.value)}
            className="w-full px-1.5 py-1 text-[11px] bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100"
          >
            {ADDRESS_CLASS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[9px] text-fg-muted mb-0.5">Venue overlay</label>
          <select
            value={ops.venue_kind}
            onChange={(e) => setOps((p) => ({ ...p, venue_kind: e.target.value }))}
            className="w-full px-1.5 py-1 text-[11px] bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100"
          >
            {VENUE_OPTIONS.map(([v, l]) => <option key={v || 'auto'} value={v}>{l}</option>)}
          </select>
        </div>
      </div>
      <textarea
        value={ops.documents_to_serve}
        onChange={(e) => setOps((p) => ({ ...p, documents_to_serve: e.target.value }))}
        rows={2}
        placeholder="Documents in packet (semicolon-separated)"
        className="w-full px-1.5 py-1 text-[11px] bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 resize-none"
      />
      <div className="grid grid-cols-2 gap-1.5">
        <input
          value={ops.gate_code}
          onChange={(e) => setOps((p) => ({ ...p, gate_code: e.target.value }))}
          placeholder="Gate / call-box code"
          className="px-1.5 py-1 text-[11px] bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100"
        />
        <input
          value={ops.authorized_acceptor}
          onChange={(e) => setOps((p) => ({ ...p, authorized_acceptor: e.target.value }))}
          placeholder="Who may accept"
          className="px-1.5 py-1 text-[11px] bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100"
        />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {chk('dogs_on_site', 'Dogs')}
        {chk('cameras_on_site', 'Cameras')}
        {chk('no_sunday', 'No Sunday')}
        {chk('no_saturday', 'No Saturday')}
        {chk('photo_required', 'Photo req.')}
        {chk('sub_service_first', 'Sub-serve 1st')}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); void save(); }}
          disabled={saving}
          className="px-2 py-1 text-[10px] font-bold rounded-[2px] border border-brand-600/50 text-brand-200 hover:bg-brand-900/20 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Apply & replan'}
        </button>
        {err && <span className="text-[10px] text-red-400">{err}</span>}
      </div>
    </div>
  );
}
