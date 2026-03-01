import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Shield, AlertTriangle, Radio, Users, Car, Award, Clock,
  ChevronDown, ChevronRight, Printer, RefreshCw, Calendar,
  MapPin, User, FileText, Eye, Bell,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import StatusBadge from '../components/StatusBadge';
import { formatDateTime, formatShortTime } from '../utils/dateUtils';

interface BriefingData {
  shift_date: string;
  generated_at: string;
  stats: {
    calls_24h: number; incidents_24h: number; active_bolos: number;
    active_warrants: number; officers_scheduled: number;
    vehicles_in_service: number; vehicles_out: number; credentials_expiring: number;
  };
  bolos: any[];
  warrants: any[];
  recent_incidents: any[];
  recent_calls: any[];
  assignments: any[];
  active_trespass: any[];
  fleet_status: any[];
  expiring_credentials: any[];
  offender_alerts: any[];
}

export default function BriefingBoardPage() {
  const [data, setData] = useState<BriefingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const refreshTimer = useRef<ReturnType<typeof setInterval>>();

  const load = useCallback(async () => {
    try {
      const result = await apiFetch<BriefingData>('/api/reports/briefing');
      setData(result);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    refreshTimer.current = setInterval(load, 5 * 60 * 1000); // 5 min
    return () => clearInterval(refreshTimer.current);
  }, [load]);

  const toggle = (key: string) => setCollapsed(p => ({ ...p, [key]: !p[key] }));

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-5 h-5 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
    </div>
  );

  if (error || !data) return (
    <div className="flex-1 flex items-center justify-center text-red-400">
      <AlertTriangle className="w-4 h-4 mr-2" />
      {error || 'Failed to load briefing'}
    </div>
  );

  const { stats } = data;

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4 print:p-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <Shield className="w-5 h-5 text-brand-500" />
            ROLL CALL / BRIEFING BOARD
          </h1>
          <p className="text-[10px] text-neutral-500 mt-0.5">
            Shift Date: {data.shift_date} — Generated: {formatDateTime(data.generated_at)}
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <button onClick={load} className="toolbar-btn text-[10px] flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
          <button onClick={() => window.print()} className="toolbar-btn text-[10px] flex items-center gap-1">
            <Printer className="w-3 h-3" /> Print
          </button>
        </div>
      </div>

      {/* Stats Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {[
          { label: 'Calls (24h)', value: stats.calls_24h, icon: Radio, color: 'text-blue-400' },
          { label: 'Incidents (24h)', value: stats.incidents_24h, icon: FileText, color: 'text-amber-400' },
          { label: 'Active BOLOs', value: stats.active_bolos, icon: Eye, color: 'text-red-400' },
          { label: 'Active Warrants', value: stats.active_warrants, icon: AlertTriangle, color: 'text-red-400' },
          { label: 'Officers On', value: stats.officers_scheduled, icon: Users, color: 'text-green-400' },
          { label: 'Vehicles In', value: stats.vehicles_in_service, icon: Car, color: 'text-green-400' },
          { label: 'Vehicles Out', value: stats.vehicles_out, icon: Car, color: 'text-amber-400' },
          { label: 'Creds Expiring', value: stats.credentials_expiring, icon: Award, color: 'text-orange-400' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="panel-beveled p-2 text-center">
            <Icon className={`w-3.5 h-3.5 mx-auto mb-1 ${color}`} />
            <div className="text-base font-bold text-white">{value}</div>
            <div className="text-[8px] uppercase tracking-wide text-neutral-500">{label}</div>
          </div>
        ))}
      </div>

      {/* BOLOs Section */}
      <Section title="ACTIVE BOLOs" icon={Eye} count={data.bolos.length} color="text-red-400"
        collapsed={collapsed.bolos} toggle={() => toggle('bolos')}>
        {data.bolos.length === 0 ? <Empty text="No active BOLOs" /> : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.bolos.map((b: any) => (
              <div key={b.id} className="p-2 border border-neutral-700 bg-neutral-800/50 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white">{b.bolo_number}</span>
                  <StatusBadge status={b.priority || 'P3'} size="xs" />
                </div>
                <div className="font-semibold text-amber-300">{b.title}</div>
                {b.type === 'person' && b.subject_description && (
                  <div className="text-neutral-400"><User className="w-3 h-3 inline mr-1" />{b.subject_description}</div>
                )}
                {b.type === 'vehicle' && b.vehicle_description && (
                  <div className="text-neutral-400"><Car className="w-3 h-3 inline mr-1" />{b.vehicle_description}</div>
                )}
                <div className="text-neutral-500 text-[10px]">{b.description}</div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Wanted Persons (Active Warrants) */}
      <Section title="WANTED PERSONS — ACTIVE WARRANTS" icon={AlertTriangle} count={data.warrants.length} color="text-red-400"
        collapsed={collapsed.warrants} toggle={() => toggle('warrants')}>
        {data.warrants.length === 0 ? <Empty text="No active warrants" /> : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.warrants.map((w: any) => (
              <div key={w.id} className="p-2 border border-neutral-700 bg-neutral-800/50 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white">{w.first_name} {w.last_name}</span>
                  <span className="text-[9px] px-1.5 py-0.5 bg-red-900/50 text-red-300 border border-red-800">
                    {(w.offense_level || '').replace(/_/g, ' ').toUpperCase()}
                  </span>
                </div>
                <div className="text-neutral-400">{w.warrant_number} — {w.charge_description}</div>
                {w.dob && <div className="text-neutral-500">DOB: {w.dob}</div>}
                {w.bail_amount && <div className="text-neutral-500">Bail: ${Number(w.bail_amount).toLocaleString()}</div>}
                {(w.height_feet || w.hair_color) && (
                  <div className="text-neutral-500">
                    {w.height_feet && `${w.height_feet}'${w.height_inches || 0}"`}
                    {w.weight && ` ${w.weight}lbs`}
                    {w.hair_color && ` ${w.hair_color} hair`}
                    {w.eye_color && ` ${w.eye_color} eyes`}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Shift Assignments */}
      <Section title="SHIFT ASSIGNMENTS" icon={Users} count={data.assignments.length} color="text-green-400"
        collapsed={collapsed.assignments} toggle={() => toggle('assignments')}>
        {data.assignments.length === 0 ? <Empty text="No assignments for this shift" /> : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[9px] uppercase tracking-wide text-neutral-500 border-b border-neutral-700">
                <th className="text-left p-1.5">Officer</th>
                <th className="text-left p-1.5">Badge</th>
                <th className="text-left p-1.5">Property</th>
                <th className="text-left p-1.5">Time</th>
                <th className="text-left p-1.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.assignments.map((a: any) => (
                <tr key={a.id} className="border-b border-neutral-800 hover:bg-neutral-800/50">
                  <td className="p-1.5 text-white font-medium">{a.officer_name}</td>
                  <td className="p-1.5 text-neutral-400">{a.badge_number}</td>
                  <td className="p-1.5 text-neutral-400">{a.property_name || '—'}</td>
                  <td className="p-1.5 text-neutral-400">{a.start_time} – {a.end_time}</td>
                  <td className="p-1.5"><StatusBadge status={a.status} size="xs" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* Recent Activity */}
      <Section title="RECENT ACTIVITY (24H)" icon={Clock} count={data.recent_incidents.length + data.recent_calls.length} color="text-blue-400"
        collapsed={collapsed.activity} toggle={() => toggle('activity')}>
        <div className="space-y-1 max-h-60 overflow-auto">
          {[...data.recent_incidents.map(i => ({ ...i, _src: 'incident' })), ...data.recent_calls.map(c => ({ ...c, _src: 'call' }))]
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, 30)
            .map((item: any, idx: number) => (
              <div key={idx} className="flex items-center gap-2 text-xs p-1.5 border-b border-neutral-800">
                <span className={`text-[9px] px-1 py-0.5 font-bold ${item._src === 'incident' ? 'bg-amber-900/50 text-amber-300' : 'bg-blue-900/50 text-blue-300'}`}>
                  {item._src === 'incident' ? 'INC' : 'CFS'}
                </span>
                <span className="text-neutral-500 w-14">{formatShortTime(item.created_at)}</span>
                <span className="text-white font-medium">{item.incident_number || item.call_number}</span>
                <span className="text-neutral-400 flex-1 truncate">{item.incident_type} — {item.location_address}</span>
                <StatusBadge status={item.status} size="xs" />
              </div>
            ))}
        </div>
      </Section>

      {/* Active Trespass Orders */}
      <Section title="ACTIVE TRESPASS ORDERS" icon={Bell} count={data.active_trespass.length} color="text-orange-400"
        collapsed={collapsed.trespass} toggle={() => toggle('trespass')}>
        {data.active_trespass.length === 0 ? <Empty text="No active trespass orders" /> : (
          <div className="space-y-1">
            {data.active_trespass.map((t: any, i: number) => (
              <div key={i} className="flex items-center gap-3 text-xs p-1.5 border-b border-neutral-800">
                <span className="font-medium text-white">{t.subject_first_name} {t.subject_last_name}</span>
                <span className="text-neutral-500">@</span>
                <span className="text-neutral-400">{t.property_name}</span>
                <span className="text-neutral-500 ml-auto text-[10px]">Exp: {t.expiration_date || 'N/A'}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Fleet Status */}
      <Section title="FLEET STATUS" icon={Car} count={data.fleet_status.length} color="text-cyan-400"
        collapsed={collapsed.fleet} toggle={() => toggle('fleet')}>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-1.5">
          {data.fleet_status.map((v: any) => (
            <div key={v.id} className={`p-1.5 text-[10px] border ${v.status === 'in_service' ? 'border-green-800 bg-green-900/20' : v.status === 'maintenance' ? 'border-amber-800 bg-amber-900/20' : 'border-neutral-700 bg-neutral-800/50'}`}>
              <div className="font-bold text-white">{v.vehicle_number}</div>
              <div className="text-neutral-400">{v.year} {v.make} {v.model}</div>
              <div className={v.status === 'in_service' ? 'text-green-400' : 'text-amber-400'}>{v.status.replace(/_/g, ' ')}</div>
              {v.assigned_unit && <div className="text-blue-400">Unit: {v.assigned_unit}</div>}
            </div>
          ))}
        </div>
      </Section>

      {/* Expiring Credentials */}
      {data.expiring_credentials.length > 0 && (
        <Section title="CREDENTIALS EXPIRING (30 DAYS)" icon={Award} count={data.expiring_credentials.length} color="text-orange-400"
          collapsed={collapsed.creds} toggle={() => toggle('creds')}>
          <div className="space-y-1">
            {data.expiring_credentials.map((c: any, i: number) => (
              <div key={i} className="flex items-center gap-3 text-xs p-1.5 border-b border-neutral-800">
                <span className="text-white font-medium">{c.officer_name}</span>
                <span className="text-neutral-400">{c.credential_type}</span>
                <span className="text-orange-400 ml-auto">{c.expiry_date}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Offender Alerts */}
      {data.offender_alerts.length > 0 && (
        <Section title="OFFENDER ALERTS" icon={AlertTriangle} count={data.offender_alerts.length} color="text-red-400"
          collapsed={collapsed.offenders} toggle={() => toggle('offenders')}>
          <div className="space-y-1">
            {data.offender_alerts.map((o: any, i: number) => (
              <div key={i} className="flex items-center gap-3 text-xs p-1.5 border-b border-neutral-800">
                <span className={`text-[9px] px-1 py-0.5 font-bold ${o.severity === 'critical' ? 'bg-red-900/50 text-red-300' : 'bg-amber-900/50 text-amber-300'}`}>
                  {o.severity?.toUpperCase()}
                </span>
                <span className="text-white font-medium">{o.first_name} {o.last_name}</span>
                <span className="text-neutral-400 flex-1 truncate">{o.description}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

// ── Reusable Section Component ──
function Section({ title, icon: Icon, count, color, collapsed, toggle, children }: {
  title: string; icon: any; count: number; color: string;
  collapsed?: boolean; toggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="panel-beveled overflow-hidden">
      <button onClick={toggle} className="panel-title-bar w-full flex items-center gap-2 cursor-pointer hover:bg-neutral-700/30">
        {collapsed ? <ChevronRight className="w-3 h-3 text-neutral-500" /> : <ChevronDown className="w-3 h-3 text-neutral-500" />}
        <Icon className={`w-3.5 h-3.5 ${color}`} />
        <span>{title}</span>
        <span className="ml-auto text-[9px] bg-neutral-700 px-1.5 py-0.5 text-neutral-300">{count}</span>
      </button>
      {!collapsed && <div className="p-2">{children}</div>}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="text-center text-neutral-500 text-xs py-4">{text}</div>;
}
