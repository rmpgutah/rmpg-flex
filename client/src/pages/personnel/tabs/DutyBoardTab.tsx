// ============================================================
// RMPG Flex — Personnel: Duty Board Tab
// ============================================================

import { useState, useMemo } from 'react';
import { Radio, Clock, AlertTriangle } from 'lucide-react';
import type { TimeEntry, Credential } from '../../../types';
import type { OfficerWithStatus } from '../utils/personnelMappers';
import OfficerAvatar from '../components/OfficerAvatar';

type DutyFilter = 'all' | 'on_duty' | 'off_duty';

interface Props {
  officers: OfficerWithStatus[];
  timeEntries: TimeEntry[];
  credentials: Credential[];
  onOfficerClick: (officer: OfficerWithStatus) => void;
}

export default function DutyBoardTab({ officers, timeEntries, credentials, onOfficerClick }: Props) {
  const [dutyFilter, setDutyFilter] = useState<DutyFilter>('all');

  const filtered = useMemo(() => {
    if (dutyFilter === 'all') return officers;
    return officers.filter((o) => o.status === dutyFilter);
  }, [officers, dutyFilter]);

  // Map officer_id -> active time entry for clocked-in hours
  const activeEntryMap = useMemo(() => {
    const map = new Map<string, TimeEntry>();
    for (const te of timeEntries) {
      if (te.status === 'clocked_in' || te.status === 'on_break') {
        map.set(te.officer_id, te);
      }
    }
    return map;
  }, [timeEntries]);

  // Map officer_id -> credential alert count (expiring_soon + expired)
  const credAlertMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of credentials) {
      if (c.status === 'expiring_soon' || c.status === 'expired') {
        map.set(c.officer_id, (map.get(c.officer_id) || 0) + 1);
      }
    }
    return map;
  }, [credentials]);

  const onDutyCount = officers.filter((o) => o.status === 'on_duty').length;
  const offDutyCount = officers.filter((o) => o.status === 'off_duty').length;
  const lastUpdated = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  function getElapsedHours(clockIn: string): string {
    const diff = Date.now() - new Date(clockIn).getTime();
    if (isNaN(diff) || diff < 0) return '0h 0m';
    const hrs = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    return `${hrs}h ${mins}m`;
  }

  const FILTER_BUTTONS: { value: DutyFilter; label: string; count: number }[] = [
    { value: 'all', label: 'All', count: officers.length },
    { value: 'on_duty', label: 'On Duty', count: onDutyCount },
    { value: 'off_duty', label: 'Off Duty', count: offDutyCount },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-brand-400" />
          <h2 className="text-sm font-bold text-rmpg-200 uppercase tracking-wider">Duty Status Board</h2>
        </div>
        <div className="panel-inset p-2 flex items-center gap-2">
          {FILTER_BUTTONS.map((btn) => (
            <button type="button"
              key={btn.value}
              onClick={() => setDutyFilter(btn.value)}
              className={`toolbar-btn text-[10px] px-2.5 py-1 ${
                dutyFilter === btn.value ? 'bg-brand-900/40 text-brand-400 border-brand-700/50' : ''
              }`}
            >
              {btn.label} ({btn.count})
            </button>
          ))}
          <span className="text-[9px] text-rmpg-500 font-mono ml-2">
            <Clock className="w-2.5 h-2.5 inline mr-0.5" />
            {lastUpdated}
          </span>
        </div>
      </div>

      {/* Officer Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16" role="status">
          <div className="w-16 h-16 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-sunken">
            <Radio className="w-8 h-8 text-rmpg-600" />
          </div>
          <p className="text-sm text-rmpg-400 font-medium">No officers match the selected filter</p>
          <p className="text-[10px] text-rmpg-600 mt-1">Try selecting a different duty status filter</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3" role="list" aria-label="Duty board officers">
          {filtered.map((officer) => {
            const isOnDuty = officer.status === 'on_duty';
            const activeEntry = activeEntryMap.get(officer.id);
            const alertCount = credAlertMap.get(officer.id) || 0;

            return (
              <button type="button"
                key={officer.id}
                role="listitem"
                onClick={() => onOfficerClick(officer)}
                className={`panel-beveled p-3 text-left transition-all duration-200 hover:brightness-110 hover:shadow-lg border-l-2 border-t-2 focus:outline-none focus:ring-1 focus:ring-brand-500/50 ${
                  isOnDuty
                    ? 'border-l-green-500 border-t-green-500 bg-[#0a1a0a]'
                    : 'border-l-rmpg-600 border-t-rmpg-600 bg-surface-base'
                }`}
                aria-label={`${officer.last_name}, ${officer.first_name} — ${isOnDuty ? 'On Duty' : 'Off Duty'}`}
              >
                <div className="flex items-start gap-2.5">
                  <OfficerAvatar officer={officer} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-rmpg-200 font-semibold truncate">
                      {officer.last_name}, {officer.first_name}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {officer.badge_number && (
                        <span className="text-[9px] font-mono text-rmpg-400">#{officer.badge_number}</span>
                      )}
                      {officer.rank && (
                        <span className="text-[9px] text-rmpg-500">{officer.rank}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Status Badges */}
                <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                    isOnDuty
                      ? 'bg-green-900/50 text-green-400 border border-green-700/50'
                      : 'bg-rmpg-700 text-rmpg-400 border border-rmpg-600'
                  }`}>
                    <span className={isOnDuty ? 'led-dot led-green' : 'led-dot led-off'} aria-hidden="true" />
                    {isOnDuty ? 'On Duty' : 'Off Duty'}
                  </span>

                  {activeEntry && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono bg-gray-900/30 text-gray-400 border border-gray-700/30" title="Time clocked in">
                      <Clock className="w-2.5 h-2.5" aria-hidden="true" />
                      {getElapsedHours(activeEntry.clock_in)}
                    </span>
                  )}

                  {alertCount > 0 && (
                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-bold bg-amber-900/30 text-amber-400 border border-amber-700/30" title={`${alertCount} credential alert(s)`}>
                      <AlertTriangle className="w-2.5 h-2.5" aria-hidden="true" />
                      {alertCount}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
