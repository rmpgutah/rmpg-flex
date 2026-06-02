// ============================================================
// RMPG Flex — Personnel: Command Dashboard (landing view)
// ------------------------------------------------------------
// At-a-glance operational picture. Every tile/row deep-links into
// the relevant drill-down tab (onNavigate) or opens an officer in
// the roster (onSelectOfficer). Runs entirely on data already in
// PersonnelPage state plus the self-fetching live panels.
// ============================================================

import { useMemo } from 'react';
import {
  Users, UserCheck, Clock, ShieldAlert, AlertTriangle, MapPinned, Radio,
  CalendarClock, ChevronRight,
} from 'lucide-react';
import type { Credential, TimeEntry, TrainingRecord, Schedule, CoverageGap } from '../../types';
import type { OfficerWithStatus } from './utils/personnelMappers';
import type { MainTab } from './utils/personnelConstants';
import OfficerAvatar from './components/OfficerAvatar';
import { parseTimestamp, dateToLocalYMD } from '../../utils/dateUtils';
import { toDisplayLabel } from '../../utils/formatters';
import {
  CredentialComplianceCard, RoleDistributionCard, TrainingStatusCard,
  HoursTrendCard, DutyHoursPanel, CertWarningsPanel,
} from './dashboard/DashboardWidgets';

interface Props {
  officers: OfficerWithStatus[];
  credentials: Credential[];
  timeEntries: TimeEntry[];
  training: TrainingRecord[];
  schedules: Schedule[];
  coverageGaps: CoverageGap[];
  onNavigate: (tab: MainTab) => void;
  onSelectOfficer: (officer: OfficerWithStatus) => void;
}

function elapsedSince(clockIn: string): string {
  const diff = Date.now() - parseTimestamp(clockIn).getTime();
  if (isNaN(diff) || diff < 0) return '0h 0m';
  const hrs = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return `${hrs}h ${mins}m`;
}

// Clickable KPI tile
function Kpi({ icon: Icon, value, label, color, topBorder, onClick }: {
  icon: React.ElementType; value: string | number; label: string;
  color: string; topBorder: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`panel-beveled p-3 text-center bg-surface-base border-t-2 ${topBorder} hover:brightness-110 hover:shadow-lg transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-brand-500/50`}
    >
      <Icon className={`w-4 h-4 mx-auto mb-1 ${color}`} />
      <p className={`text-xl font-bold font-mono ${color}`}>{value}</p>
      <p className="field-label">{label}</p>
    </button>
  );
}

function SectionTitle({ icon: Icon, title, action }: { icon: React.ElementType; title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <h4 className="field-label text-brand-400 flex items-center gap-1.5">
        <Icon className="w-3 h-3" /> {title}
      </h4>
      {action}
    </div>
  );
}

export default function PersonnelDashboard({
  officers, credentials, timeEntries, training, schedules, coverageGaps,
  onNavigate, onSelectOfficer,
}: Props) {
  const onDuty = officers.filter(o => o.status === 'on_duty');
  const clockedIn = timeEntries.filter(t => t.status === 'clocked_in').length;
  const totalHours = timeEntries.reduce((s, t) => s + (t.total_hours || 0), 0);
  const validCreds = credentials.filter(c => c.status === 'valid').length;
  const credCompliance = credentials.length > 0 ? Math.round((validCreds / credentials.length) * 100) : 100;

  // Active time entry per officer (for elapsed on-duty time)
  const activeEntryMap = useMemo(() => {
    const map = new Map<string, TimeEntry>();
    for (const te of timeEntries) {
      if (te.status === 'clocked_in' || te.status === 'on_break') map.set(te.officer_id, te);
    }
    return map;
  }, [timeEntries]);

  const credAlerts = useMemo(
    () => credentials.filter(c => c.status === 'expired' || c.status === 'expiring_soon'),
    [credentials],
  );
  const realGaps = useMemo(() => coverageGaps.filter(g => g.gap > 0), [coverageGaps]);

  const todaysShifts = useMemo(() => {
    const today = dateToLocalYMD(new Date());
    return schedules
      .filter(s => (s.shift_start || '').slice(0, 10) === today)
      .sort((a, b) => (a.shift_start || '').localeCompare(b.shift_start || ''));
  }, [schedules]);

  const fmtTime = (iso: string) => {
    const d = parseTimestamp(iso);
    return isNaN(d.getTime()) ? '--' : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-dark">
      {/* Hero KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Kpi icon={Users} value={officers.length} label="Total Personnel" color="text-white" topBorder="border-t-brand-500" onClick={() => onNavigate('roster')} />
        <Kpi icon={UserCheck} value={onDuty.length} label="On Duty" color="text-green-400" topBorder="border-t-green-500" onClick={() => onNavigate('duty_board')} />
        <Kpi icon={Clock} value={clockedIn} label="Clocked In" color="text-brand-400" topBorder="border-t-brand-500" onClick={() => onNavigate('time')} />
        <Kpi icon={CalendarClock} value={totalHours.toFixed(0)} label="Period Hours" color="text-white" topBorder="border-t-rmpg-500" onClick={() => onNavigate('time')} />
        <Kpi
          icon={ShieldAlert}
          value={`${credCompliance}%`}
          label="Cred. Compliance"
          color={credCompliance >= 90 ? 'text-green-400' : credCompliance >= 70 ? 'text-amber-400' : 'text-red-400'}
          topBorder={credCompliance >= 90 ? 'border-t-green-500' : credCompliance >= 70 ? 'border-t-amber-500' : 'border-t-red-500'}
          onClick={() => onNavigate('credentials')}
        />
      </div>

      {/* Operational row: On-Duty Now + Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* On-Duty Now */}
        <div className="panel-beveled p-4 bg-surface-base">
          <SectionTitle
            icon={Radio}
            title={`On-Duty Now (${onDuty.length})`}
            action={
              <button type="button" onClick={() => onNavigate('duty_board')} className="text-[9px] text-rmpg-400 hover:text-brand-400 flex items-center gap-0.5">
                Duty Board <ChevronRight className="w-2.5 h-2.5" />
              </button>
            }
          />
          {onDuty.length === 0 ? (
            <p className="text-xs text-rmpg-500 text-center py-6">No officers on duty</p>
          ) : (
            <div className="space-y-1 max-h-[260px] overflow-y-auto scrollbar-dark">
              {onDuty.map(officer => {
                const active = activeEntryMap.get(officer.id);
                return (
                  <button
                    type="button"
                    key={officer.id}
                    onClick={() => onSelectOfficer(officer)}
                    className="w-full flex items-center gap-2.5 p-2 bg-surface-sunken hover:bg-surface-raised border-l-2 border-l-green-500 text-left transition-colors duration-150 focus:outline-none focus:ring-1 focus:ring-brand-500/50"
                  >
                    <OfficerAvatar officer={officer} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-rmpg-100 font-semibold truncate">{officer.last_name}, {officer.first_name}</div>
                      <div className="flex items-center gap-1.5 text-[9px] text-rmpg-400">
                        {officer.badge_number && <span className="font-mono">#{officer.badge_number}</span>}
                        {officer.rank && <span>{officer.rank}</span>}
                      </div>
                    </div>
                    {active && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono bg-gray-900/30 text-gray-300 border border-gray-700/30">
                        <Clock className="w-2.5 h-2.5" /> {elapsedSince(active.clock_in)}
                      </span>
                    )}
                    <ChevronRight className="w-3 h-3 text-rmpg-600 flex-shrink-0" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Alerts */}
        <div className="space-y-4">
          {/* Credential alerts */}
          <div className="panel-beveled p-4 bg-surface-base">
            <SectionTitle
              icon={AlertTriangle}
              title={`Credential Alerts (${credAlerts.length})`}
              action={
                <button type="button" onClick={() => onNavigate('credentials')} className="text-[9px] text-rmpg-400 hover:text-brand-400 flex items-center gap-0.5">
                  Credentials <ChevronRight className="w-2.5 h-2.5" />
                </button>
              }
            />
            {credAlerts.length === 0 ? (
              <p className="text-xs text-green-500/80 text-center py-3">All credentials valid</p>
            ) : (
              <div className="space-y-1 max-h-[120px] overflow-y-auto scrollbar-dark">
                {credAlerts.slice(0, 6).map(cred => (
                  <button
                    type="button"
                    key={cred.id}
                    onClick={() => onNavigate('credentials')}
                    className="w-full flex items-center justify-between text-xs p-1.5 bg-surface-sunken hover:bg-surface-raised text-left transition-colors duration-150"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className={cred.status === 'expired' ? 'led-dot led-red' : 'led-dot led-amber'} />
                      <span className="text-rmpg-200 truncate">{cred.officer_name}</span>
                      <span className="text-rmpg-500">—</span>
                      <span className="text-rmpg-300 truncate">{toDisplayLabel(cred.type)}</span>
                    </span>
                    <span className={`text-[10px] font-mono flex-shrink-0 ${cred.status === 'expired' ? 'text-red-400' : 'text-amber-400'}`}>
                      {cred.expiry_date || 'No expiry'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Coverage gaps */}
          <div className="panel-beveled p-4 bg-surface-base">
            <SectionTitle
              icon={MapPinned}
              title={`Coverage Gaps (${realGaps.length})`}
              action={
                <button type="button" onClick={() => onNavigate('deployment')} className="text-[9px] text-rmpg-400 hover:text-brand-400 flex items-center gap-0.5">
                  Deployment <ChevronRight className="w-2.5 h-2.5" />
                </button>
              }
            />
            {realGaps.length === 0 ? (
              <p className="text-xs text-green-500/80 text-center py-3">No coverage gaps</p>
            ) : (
              <div className="space-y-1 max-h-[120px] overflow-y-auto scrollbar-dark">
                {realGaps.slice(0, 6).map((g, i) => (
                  <button
                    type="button"
                    key={`${g.property_id}-${g.shift_type}-${i}`}
                    onClick={() => onNavigate('deployment')}
                    className="w-full flex items-center justify-between text-xs p-1.5 bg-surface-sunken hover:bg-surface-raised text-left transition-colors duration-150"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="led-dot led-red" />
                      <span className="text-rmpg-200 truncate">{g.property_name}</span>
                      <span className="text-rmpg-500 capitalize">{g.shift_type}</span>
                    </span>
                    <span className="text-[10px] font-mono text-red-400 flex-shrink-0">
                      {g.assigned_officers}/{g.required_officers} (−{g.gap})
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Today's coverage */}
      <div className="panel-beveled p-4 bg-surface-base">
        <SectionTitle
          icon={CalendarClock}
          title={`Today's Schedule (${todaysShifts.length})`}
          action={
            <button type="button" onClick={() => onNavigate('schedule')} className="text-[9px] text-rmpg-400 hover:text-brand-400 flex items-center gap-0.5">
              Schedule <ChevronRight className="w-2.5 h-2.5" />
            </button>
          }
        />
        {todaysShifts.length === 0 ? (
          <p className="text-xs text-rmpg-500 text-center py-3">No shifts scheduled today</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 max-h-[160px] overflow-y-auto scrollbar-dark">
            {todaysShifts.map(s => (
              <div key={s.id} className="flex items-center justify-between text-xs p-1.5 bg-surface-sunken border-l-2 border-l-brand-600">
                <span className="min-w-0">
                  <span className="text-rmpg-200 truncate block">{s.officer_name}</span>
                  <span className="text-[9px] text-rmpg-500 truncate block">{s.property_name || s.position || '—'}</span>
                </span>
                <span className="text-[10px] font-mono text-brand-400 flex-shrink-0">
                  {fmtTime(s.shift_start)}–{fmtTime(s.shift_end)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Charts grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CredentialComplianceCard credentials={credentials} />
        <RoleDistributionCard officers={officers} />
        <TrainingStatusCard training={training} />
        <HoursTrendCard timeEntries={timeEntries} />
      </div>

      {/* Live panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DutyHoursPanel />
        <CertWarningsPanel />
      </div>
    </div>
  );
}
