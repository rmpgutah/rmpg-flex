// ============================================================
// RMPG Flex — Dispatch Record Panel
// ============================================================
// The record file the AI radio dispatcher auto-opens when it runs a
// plate/person check. Shared by two surfaces:
//   • operator console (LiveTab) — docked beside the live feed (floating=false)
//   • field officer's MDT (PttController) — a floating card over any page,
//     shown only on the officer's OWN request (floating=true)
//
// Fetches the SAME endpoints as the detached record window; a header link pops
// the full file out in a new tab. Styling uses the radio console's --rt-* theme
// vars WITH hex fallbacks, so it renders correctly both inside the themed
// console and on plain app pages where those vars don't exist.
// ============================================================

import type React from 'react';
import { useEffect, useState } from 'react';
import { X, Loader2, User, Car, ExternalLink } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import type { DispatchRecordRef } from '../pages/radio/useVoiceChannel';

interface Props {
  record: DispatchRecordRef;
  onClose: () => void;
  /** Floating overlay (field MDT) vs. docked aside (operator console). */
  floating?: boolean;
}

export default function DispatchRecordPanel({ record, onClose, floating = false }: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null); setData(null);
    const endpoint = record.kind === 'person'
      ? `/records/persons/${record.id}`
      : `/records/vehicles/${record.id}`;
    apiFetch<any>(endpoint)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setError(e?.message || 'Failed to load record'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [record.kind, record.id]);

  const title = record.kind === 'person'
    ? (data ? `${data.last_name || ''}, ${data.first_name || ''}`.replace(/^, |, $/g, '') || 'Person' : 'Person')
    : (data?.plate_number || 'Vehicle');

  const inner = (
    <>
      <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid var(--rt-border, #1f1f1f)' }}>
        {record.kind === 'person'
          ? <User className="w-3.5 h-3.5" style={{ color: 'var(--rt-accent, #d4a017)' }} />
          : <Car className="w-3.5 h-3.5" style={{ color: 'var(--rt-accent, #d4a017)' }} />}
        <span className="text-[10px] font-bold uppercase tracking-wider flex-1 truncate" style={{ color: 'var(--rt-text, #e8e8e8)' }}>
          {title}
        </span>
        <a
          href={`/detached/record/${record.kind}/${record.id}`}
          target="_blank" rel="noopener noreferrer"
          aria-label="Open full record in new window"
          className="hover:opacity-80" style={{ color: 'var(--rt-muted, #888)' }}
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
        <button type="button" onClick={onClose} aria-label="Close record panel" className="hover:opacity-80" style={{ color: 'var(--rt-muted, #888)' }}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-auto p-3 text-[10px] font-mono" style={{ color: 'var(--rt-text, #e8e8e8)' }}>
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--rt-muted, #888)' }} role="status" aria-label="Loading record" />
          </div>
        )}
        {error && <p style={{ color: '#f87171' }}>{error}</p>}
        {data && record.kind === 'person' && <PersonFields p={data} />}
        {data && record.kind === 'vehicle' && <VehicleFields v={data} />}
      </div>
    </>
  );

  if (floating) {
    return (
      <div
        role="dialog"
        aria-label="Dispatch record"
        className="flex flex-col"
        style={{
          position: 'fixed', right: 12, bottom: 78, width: 300, maxHeight: '60vh', zIndex: 9000,
          border: '1px solid var(--rt-border, #1f1f1f)', background: 'var(--rt-panel, #0d0d0d)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.6)', borderRadius: 2,
        }}
      >
        {inner}
      </div>
    );
  }

  return (
    <aside
      className="w-72 shrink-0 flex flex-col min-h-0"
      style={{ borderLeft: '1px solid var(--rt-border, #1f1f1f)', background: 'var(--rt-panel, #0d0d0d)' }}
    >
      {inner}
    </aside>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === '') return null;
  return (
    <div className="flex gap-2 py-0.5">
      <span className="shrink-0" style={{ color: 'var(--rt-muted, #888)', minWidth: 64 }}>{label}</span>
      <span className="flex-1 break-words" style={{ color: 'var(--rt-text, #e8e8e8)' }}>{value}</span>
    </div>
  );
}

function PersonFields({ p }: { p: any }) {
  let flags: any[] = [];
  try { flags = JSON.parse(p.flags || '[]'); } catch { /* ignore */ }
  return (
    <div className="space-y-0.5">
      <Field label="Name" value={[p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ')} />
      <Field label="DOB" value={p.dob} />
      <Field label="Sex" value={p.gender} />
      <Field label="Race" value={p.race} />
      <Field label="Ht/Wt" value={[p.height, p.weight].filter(Boolean).join(' / ')} />
      <Field label="Address" value={p.address} />
      <Field label="Phone" value={p.phone} />
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1.5">
          {flags.map((f, i) => {
            const t = typeof f === 'object' && f ? (f.type || JSON.stringify(f)) : String(f);
            return (
              <span key={`${t}-${i}`} className="px-1.5 py-0.5 text-[9px] uppercase font-bold"
                style={{ background: 'rgba(248,113,113,0.15)', color: '#f87171', border: '1px solid rgba(248,113,113,0.3)' }}>
                {t}
              </span>
            );
          })}
        </div>
      )}
      {(p.incidents?.length ?? 0) > 0 && (
        <Field label="History" value={`${p.incidents.length} incident${p.incidents.length === 1 ? '' : 's'} on file`} />
      )}
    </div>
  );
}

function VehicleFields({ v }: { v: any }) {
  return (
    <div className="space-y-0.5">
      <Field label="Plate" value={[v.plate_number, v.state].filter(Boolean).join('  ')} />
      <Field label="Vehicle" value={[v.year, v.color, v.make, v.model].filter(Boolean).join(' ')} />
      <Field label="VIN" value={v.vin} />
      <Field label="Style" value={v.style} />
      <Field label="Owner" value={[v.owner_first_name, v.owner_last_name].filter(Boolean).join(' ') || v.registered_owner} />
      <Field label="Owner ph" value={v.owner_phone} />
      <Field label="Status" value={(v.is_stolen || /stolen|active/i.test(String(v.stolen_status || ''))) ? 'FLAGGED STOLEN' : null} />
      {(v.incidents?.length ?? 0) > 0 && (
        <Field label="History" value={`${v.incidents.length} incident${v.incidents.length === 1 ? '' : 's'} on file`} />
      )}
    </div>
  );
}
