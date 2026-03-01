// ============================================================
// RMPG Flex — Master Name Index / Involvements Panel
// Shows a person's cross-module involvements: incidents, calls,
// citations, warrants, BOLOs, FIs, trespass orders, vehicles, etc.
// Used as a detail panel when viewing a person record.
// ============================================================

import React, { useState, useEffect } from 'react';
import {
  User, FileText, Phone, FileWarning, AlertTriangle, Radio,
  ShieldBan, Car, ClipboardList, Shield, UserX, Loader2, X,
  ChevronDown, ChevronRight, ExternalLink,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';

interface InvolvementSummary {
  incidents: number;
  calls: number;
  citations: number;
  field_interviews: number;
  warrants: number;
  bolos: number;
  trespass_orders: number;
  vehicles: number;
  criminal_history: number;
  offender_alerts: number;
}

interface PersonRecord {
  id: number;
  first_name: string;
  last_name: string;
  date_of_birth?: string;
  ssn_last4?: string;
  race?: string;
  sex?: string;
  height?: string;
  weight?: string;
  hair_color?: string;
  eye_color?: string;
  address?: string;
}

interface InvolvementsData {
  person: PersonRecord;
  summary: InvolvementSummary;
  incidents: any[];
  calls: any[];
  citations: any[];
  field_interviews: any[];
  warrants: any[];
  bolos: any[];
  trespass_orders: any[];
  vehicles: any[];
  criminal_history: any[];
  offender_alerts: any[];
}

interface InvolvementsPanelProps {
  personId: string | number;
  onClose?: () => void;
}

// Collapsible section
function Section({
  title, icon: Icon, count, color, children, defaultOpen = false,
}: {
  title: string; icon: React.ElementType; count: number; color: string;
  children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (count === 0) return null;

  return (
    <div className="border-b border-rmpg-800">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-rmpg-800/30 transition-colors"
      >
        {open ? <ChevronDown style={{ width: 10, height: 10, color: '#707070' }} /> : <ChevronRight style={{ width: 10, height: 10, color: '#707070' }} />}
        <Icon style={{ width: 12, height: 12, color }} />
        <span className="text-[10px] font-bold uppercase tracking-wider text-rmpg-300">{title}</span>
        <span
          className="text-[9px] font-mono font-bold px-1.5 py-px ml-auto"
          style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}
        >
          {count}
        </span>
      </button>
      {open && <div className="px-3 pb-2 space-y-1">{children}</div>}
    </div>
  );
}

function ItemRow({ primary, secondary, badge, badgeColor }: {
  primary: string; secondary?: string; badge?: string; badgeColor?: string;
}) {
  return (
    <div className="flex items-center gap-2 px-2 py-1 text-[10px]" style={{ background: '#1a1a1a', border: '1px solid #252525' }}>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-white truncate">{primary}</div>
        {secondary && <div className="text-rmpg-500 truncate">{secondary}</div>}
      </div>
      {badge && (
        <span className="text-[8px] font-bold px-1.5 py-px flex-shrink-0" style={{ background: `${badgeColor || '#6b7280'}20`, color: badgeColor || '#6b7280', border: `1px solid ${badgeColor || '#6b7280'}40` }}>
          {badge}
        </span>
      )}
    </div>
  );
}

export default function InvolvementsPanel({ personId, onClose }: InvolvementsPanelProps) {
  const [data, setData] = useState<InvolvementsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!personId) return;
    setLoading(true);
    setError(null);

    apiFetch<InvolvementsData>(`/records/persons/${personId}/involvements`)
      .then(setData)
      .catch((err: any) => setError(err.message || 'Failed to load involvements'))
      .finally(() => setLoading(false));
  }, [personId]);

  if (loading) {
    return (
      <div className="panel-beveled bg-surface-base">
        <div className="panel-title-bar flex items-center gap-2">
          <User style={{ width: 11, height: 11 }} />
          <span>MASTER NAME INDEX</span>
        </div>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-4 h-4 animate-spin text-rmpg-500" />
          <span className="ml-2 text-[10px] text-rmpg-500 font-mono">LOADING INVOLVEMENTS...</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="panel-beveled bg-surface-base">
        <div className="panel-title-bar flex items-center gap-2">
          <User style={{ width: 11, height: 11 }} />
          <span>MASTER NAME INDEX</span>
          {onClose && (
            <button onClick={onClose} className="ml-auto text-rmpg-500 hover:text-white"><X style={{ width: 11, height: 11 }} /></button>
          )}
        </div>
        <div className="p-3 text-[10px] text-red-400">{error || 'No data available'}</div>
      </div>
    );
  }

  const { person, summary } = data;
  const totalInvolvements = Object.values(summary).reduce((a, b) => a + b, 0);

  return (
    <div className="panel-beveled bg-surface-base">
      {/* Title Bar */}
      <div className="panel-title-bar flex items-center gap-2">
        <User style={{ width: 11, height: 11 }} />
        <span>MASTER NAME INDEX — {person.last_name?.toUpperCase()}, {person.first_name}</span>
        {onClose && (
          <button onClick={onClose} className="ml-auto text-rmpg-500 hover:text-white"><X style={{ width: 11, height: 11 }} /></button>
        )}
      </div>

      {/* Person Header */}
      <div className="px-3 py-2 flex items-start gap-3" style={{ background: '#1a1a1a', borderBottom: '1px solid #303030' }}>
        <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center text-sm font-bold"
          style={{ background: 'linear-gradient(135deg, #8a0c0c, #bc1010)', color: '#fff', border: '2px solid #d93030' }}>
          {(person.first_name?.[0] || '').toUpperCase()}{(person.last_name?.[0] || '').toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold text-white">
            {person.last_name?.toUpperCase()}, {person.first_name}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-[9px] text-rmpg-400 font-mono">
            {person.date_of_birth && <span>DOB: {person.date_of_birth}</span>}
            {person.sex && <span>SEX: {person.sex}</span>}
            {person.race && <span>RACE: {person.race}</span>}
            {person.height && <span>HT: {person.height}</span>}
            {person.weight && <span>WT: {person.weight}</span>}
            {person.hair_color && <span>HAIR: {person.hair_color}</span>}
            {person.eye_color && <span>EYES: {person.eye_color}</span>}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-[9px] text-rmpg-500 font-mono">TOTAL</div>
          <div className="text-lg font-black" style={{ color: totalInvolvements > 10 ? '#ef4444' : totalInvolvements > 5 ? '#f97316' : '#22c55e' }}>
            {totalInvolvements}
          </div>
        </div>
      </div>

      {/* Summary badges row */}
      <div className="flex flex-wrap gap-1 px-3 py-1.5" style={{ background: '#141414', borderBottom: '1px solid #252525' }}>
        {summary.warrants > 0 && <span className="text-[8px] font-bold px-1.5 py-px" style={{ background: 'rgba(239,68,68,0.2)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.4)' }}>WARRANTS: {summary.warrants}</span>}
        {summary.bolos > 0 && <span className="text-[8px] font-bold px-1.5 py-px" style={{ background: 'rgba(249,115,22,0.2)', color: '#f97316', border: '1px solid rgba(249,115,22,0.4)' }}>BOLOs: {summary.bolos}</span>}
        {summary.trespass_orders > 0 && <span className="text-[8px] font-bold px-1.5 py-px" style={{ background: 'rgba(168,85,247,0.2)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.4)' }}>TRESPASS: {summary.trespass_orders}</span>}
        {summary.offender_alerts > 0 && <span className="text-[8px] font-bold px-1.5 py-px" style={{ background: 'rgba(239,68,68,0.2)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.4)' }}>OFFENDER ALERTS: {summary.offender_alerts}</span>}
        {summary.incidents > 0 && <span className="text-[8px] font-bold px-1.5 py-px" style={{ background: 'rgba(59,130,246,0.2)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.4)' }}>INCIDENTS: {summary.incidents}</span>}
        {summary.calls > 0 && <span className="text-[8px] font-bold px-1.5 py-px" style={{ background: 'rgba(34,197,94,0.2)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.4)' }}>CALLS: {summary.calls}</span>}
        {summary.citations > 0 && <span className="text-[8px] font-bold px-1.5 py-px" style={{ background: 'rgba(234,179,8,0.2)', color: '#eab308', border: '1px solid rgba(234,179,8,0.4)' }}>CITATIONS: {summary.citations}</span>}
        {summary.field_interviews > 0 && <span className="text-[8px] font-bold px-1.5 py-px" style={{ background: 'rgba(107,114,128,0.2)', color: '#9ca3af', border: '1px solid rgba(107,114,128,0.4)' }}>FIs: {summary.field_interviews}</span>}
        {summary.vehicles > 0 && <span className="text-[8px] font-bold px-1.5 py-px" style={{ background: 'rgba(107,114,128,0.2)', color: '#9ca3af', border: '1px solid rgba(107,114,128,0.4)' }}>VEHICLES: {summary.vehicles}</span>}
      </div>

      {/* Collapsible sections */}
      <div className="max-h-[500px] overflow-y-auto">
        {/* Warrants — highest priority */}
        <Section title="Active Warrants" icon={AlertTriangle} count={summary.warrants} color="#ef4444" defaultOpen>
          {data.warrants.map((w: any) => (
            <ItemRow key={w.id}
              primary={`${w.warrant_number || 'W-???'} — ${w.warrant_type?.replace(/_/g, ' ')}`}
              secondary={`Issued: ${w.issue_date || 'Unknown'} | ${w.charges || 'No charges listed'}`}
              badge={w.status?.toUpperCase()} badgeColor="#ef4444"
            />
          ))}
        </Section>

        {/* BOLOs */}
        <Section title="BOLOs" icon={Radio} count={summary.bolos} color="#f97316" defaultOpen>
          {data.bolos.map((b: any) => (
            <ItemRow key={b.id}
              primary={b.bolo_type?.replace(/_/g, ' ')?.toUpperCase() || 'BOLO'}
              secondary={b.description?.substring(0, 100) || 'No details'}
              badge={b.priority?.toUpperCase()} badgeColor="#f97316"
            />
          ))}
        </Section>

        {/* Trespass Orders */}
        <Section title="Trespass Orders" icon={ShieldBan} count={summary.trespass_orders} color="#a855f7">
          {data.trespass_orders.map((t: any) => (
            <ItemRow key={t.id}
              primary={`${t.order_number || '---'} — ${t.order_type?.replace(/_/g, ' ')}`}
              secondary={`${t.property_name || t.location || 'Unknown location'} | ${t.effective_date || ''} — ${t.expiration_date || 'No expiry'}`}
              badge={t.status?.toUpperCase()} badgeColor="#a855f7"
            />
          ))}
        </Section>

        {/* Offender Alerts */}
        <Section title="Offender Alerts" icon={UserX} count={summary.offender_alerts} color="#ef4444">
          {data.offender_alerts.map((o: any) => (
            <ItemRow key={o.id}
              primary={`${o.registry_type?.replace(/_/g, ' ')?.toUpperCase() || 'ALERT'} — Risk: ${o.risk_level || 'Unknown'}`}
              secondary={o.conditions || o.notes || 'No details'}
              badge={o.status?.toUpperCase()} badgeColor="#ef4444"
            />
          ))}
        </Section>

        {/* Incidents */}
        <Section title="Incidents" icon={FileText} count={summary.incidents} color="#3b82f6">
          {data.incidents.map((inc: any) => (
            <ItemRow key={inc.id}
              primary={`${inc.incident_number || '---'} — ${inc.incident_type?.replace(/_/g, ' ')}`}
              secondary={`${inc.incident_date || ''} | ${inc.involvement_type || 'involved'} | ${inc.status || ''}`}
              badge={inc.involvement_type?.toUpperCase()} badgeColor="#3b82f6"
            />
          ))}
        </Section>

        {/* Calls for Service */}
        <Section title="Calls for Service" icon={Phone} count={summary.calls} color="#22c55e">
          {data.calls.map((c: any, i: number) => (
            <ItemRow key={c.id || i}
              primary={`${c.call_number || '---'} — ${c.incident_type?.replace(/_/g, ' ')}`}
              secondary={`${c.created_at ? new Date(c.created_at).toLocaleDateString() : ''} | ${c.location_address || ''}`}
              badge={c.priority} badgeColor={c.priority === 'P1' ? '#ef4444' : c.priority === 'P2' ? '#f97316' : '#22c55e'}
            />
          ))}
        </Section>

        {/* Citations */}
        <Section title="Citations" icon={FileWarning} count={summary.citations} color="#eab308">
          {data.citations.map((c: any) => (
            <ItemRow key={c.id}
              primary={`${c.citation_number || '---'} — ${c.violation_description || c.violation_code || 'Violation'}`}
              secondary={`${c.violation_date || ''} | ${c.location || ''}`}
              badge={c.status?.toUpperCase()} badgeColor="#eab308"
            />
          ))}
        </Section>

        {/* Field Interviews */}
        <Section title="Field Interviews" icon={ClipboardList} count={summary.field_interviews} color="#9ca3af">
          {data.field_interviews.map((fi: any) => (
            <ItemRow key={fi.id}
              primary={`${fi.fi_number || '---'} — ${fi.reason || 'Field Contact'}`}
              secondary={`${fi.contact_date || ''} | ${fi.location || ''}`}
              badge={fi.disposition?.toUpperCase()} badgeColor="#9ca3af"
            />
          ))}
        </Section>

        {/* Vehicles */}
        <Section title="Associated Vehicles" icon={Car} count={summary.vehicles} color="#6b7280">
          {data.vehicles.map((v: any) => (
            <ItemRow key={v.id}
              primary={`${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim() || 'Unknown Vehicle'}
              secondary={`Plate: ${v.plate_number || 'N/A'} | ${v.state || ''} | VIN: ${v.vin || 'N/A'}`}
              badge={v.color?.toUpperCase()} badgeColor="#6b7280"
            />
          ))}
        </Section>

        {/* Criminal History */}
        <Section title="Criminal History" icon={Shield} count={summary.criminal_history} color="#dc2626">
          {data.criminal_history.map((ch: any) => (
            <ItemRow key={ch.id}
              primary={ch.offense || ch.charge || 'Offense'}
              secondary={`${ch.offense_date || ''} | ${ch.court || ''} | ${ch.disposition || ''}`}
              badge={ch.severity?.toUpperCase() || ch.classification?.toUpperCase()} badgeColor="#dc2626"
            />
          ))}
        </Section>
      </div>

      {/* Footer */}
      {totalInvolvements === 0 && (
        <div className="px-3 py-4 text-center text-[10px] text-rmpg-500 font-mono">
          NO INVOLVEMENTS FOUND FOR THIS INDIVIDUAL
        </div>
      )}
    </div>
  );
}
