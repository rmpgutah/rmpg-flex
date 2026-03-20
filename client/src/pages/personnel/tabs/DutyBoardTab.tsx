// ============================================================
// RMPG Flex — Personnel: Duty Board Tab
// ============================================================

import React, { useState, useMemo } from 'react';
import { Radio, Clock, AlertTriangle, Shield } from 'lucide-react';
import type { TimeEntry, Credential } from '../../../types';
import type { OfficerWithStatus } from '../utils/personnelMappers';
import { calcDaysUntilExpiry } from '../utils/personnelFormatters';
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
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Fixed Header */}
      <div className="flex-shrink-0 px-4 py-2.5 border-b border-rmpg-600" style={{ background: 'linear-gradient(180deg, var(--surface-raised) 0%, var(--surface-base) 100%)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 section-icon" />
            <h2 className="section-header" style={{ border: 'none', padding: 0, margin: 0 }}>Duty Status Board</h2>
          </div>
          <div className="flex items-center gap-2">
            <div className="panel-inset p-1 flex items-center gap-1">
              {FILTER_BUTTONS.map((btn) => (
                <button
                  key={btn.value}
                  onClick={() => setDutyFilter(btn.value)}
                  className={`toolbar-btn text-[10px] px-2.5 py-1 flex items-center gap-1.5 ${
                    dutyFilter === btn.value ? 'bg-brand-900/40 text-brand-400 border-brand-700/50' : ''
                  }`}
                >
                  {btn.label}
                  <span className={`font-mono text-[9px] px-1 py-px rounded-sm ${
                    dutyFilter === btn.value
                      ? 'bg-brand-700/40 text-brand-300'
                      : 'bg-rmpg-700/50 text-rmpg-400'
                  }`}>
                    {btn.count}
                  </span>
                </button>
              ))}
            </div>
            <span className="w-px h-4 bg-rmpg-700/50" />
            <span className="text-[9px] text-rmpg-500 font-mono">
              <Clock className="w-2.5 h-2.5 inline mr-0.5" />
              {lastUpdated}
            </span>
          </div>
        </div>
      </div>

      {/* Scrollable Grid */}
      <div className="flex-1 overflow-y-auto min-h-0 p-4">
        {filtered.length === 0 ? (
          <div className="empty-state-container text-center py-16">
            <div className="empty-state-icon w-16 h-16 mx-auto mb-4 rounded-full border border-rmpg-700/50 flex items-center justify-center bg-surface-sunken">
              <Radio className="w-8 h-8 text-rmpg-600" />
            </div>
            <p className="text-xs text-rmpg-400 font-semibold">No officers match the selected filter</p>
            <p className="text-[10px] text-rmpg-600 mt-1.5">Try selecting a different duty status above to view personnel.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
            {filtered.map((officer) => {
              const isOnDuty = officer.status === 'on_duty';
              const activeEntry = activeEntryMap.get(officer.id);
              const alertCount = credAlertMap.get(officer.id) || 0;

              return (
                <button
                  key={officer.id}
                  onClick={() => onOfficerClick(officer)}
                  className={`stat-pod officer-card ${isOnDuty ? 'duty-card-active' : 'duty-card-inactive'} cascade-item panel-beveled p-3 text-left`}
                  style={{ '--pod-glow': isOnDuty ? 'rgba(34,197,94,0.12)' : 'rgba(148,163,184,0.06)' } as React.CSSProperties}
                >
                  <div className="flex items-start gap-3">
                    <div className={`relative flex-shrink-0 ${isOnDuty ? 'clock-active-ring' : ''}`} style={{ borderRadius: '50%' }}>
                      <OfficerAvatar officer={officer} size="md" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-xs text-rmpg-100 font-semibold truncate">
                          {officer.last_name}, {officer.first_name}
                        </span>
                        {officer.badge_number && (
                          <span className="text-[9px] font-mono text-rmpg-400 flex-shrink-0">#{officer.badge_number}</span>
                        )}
                      </div>
                      {officer.rank && (
                        <div className="text-[10px] text-rmpg-500 mt-0.5 truncate">{officer.rank}</div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                      isOnDuty
                        ? 'bg-green-900/50 text-green-400 border border-green-700/50'
                        : 'bg-rmpg-700/60 text-rmpg-400 border border-rmpg-600/60'
                    }`}>
                      <span className={isOnDuty ? 'led-dot led-green led-breathing' : 'led-dot led-off'} />
                      {isOnDuty ? 'On Duty' : 'Off Duty'}
                    </span>

                    {activeEntry && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono bg-blue-900/30 text-blue-400 border border-blue-700/30">
                        <Clock className="w-2.5 h-2.5" />
                        {getElapsedHours(activeEntry.clock_in)}
                      </span>
                    )}

                    {alertCount > 0 && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-bold bg-amber-900/30 text-amber-400 border border-amber-700/30">
                        <AlertTriangle className="w-2.5 h-2.5" />
                        <span className="font-mono">{alertCount}</span>
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
