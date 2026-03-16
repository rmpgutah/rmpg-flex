import React from 'react';
import { Radio, Clock, User, ArrowRight } from 'lucide-react';
import type { FleetAssignment } from '../../../types';
import { formatMilitary } from '../utils/fleetFormatters';

function formatDuration(start: string, end?: string): string {
  const s = new Date(start);
  const e = end ? new Date(end) : new Date();
  const diffMs = e.getTime() - s.getTime();
  const days = Math.floor(diffMs / 86400000);
  const hours = Math.floor((diffMs % 86400000) / 3600000);

  if (days > 365) return `${Math.floor(days / 365)}y ${days % 365}d`;
  if (days > 30) return `${Math.floor(days / 30)}mo ${days % 30}d`;
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h`;
}

interface Props {
  assignments: FleetAssignment[];
}

export default function FleetAssignmentsTab({ assignments }: Props) {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider flex items-center gap-1.5">
          <Radio className="w-3 h-3" /> Assignment History ({assignments.length})
          {assignments.some(a => !a.unassigned_at) && (
            <span className="ml-1 px-1.5 py-0.5 text-[8px] font-bold bg-green-900/30 text-green-400 border border-green-700/40">
              ACTIVE
            </span>
          )}
        </h3>
      </div>

      {/* Assignment Timeline */}
      {assignments.length === 0 ? (
        <div className="text-center py-10 panel-beveled bg-surface-base">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center" style={{ background: '#161616' }}>
            <Radio className="w-7 h-7 text-rmpg-600" />
          </div>
          <p className="text-[11px] text-rmpg-400 font-semibold">No Assignment History</p>
          <p className="text-[9px] text-rmpg-600 mt-1 max-w-[260px] mx-auto">
            Assignments are logged automatically when vehicles are assigned to or unassigned from units.
          </p>
        </div>
      ) : (
        <div className="panel-beveled p-3 bg-surface-base">
          <div className="relative">
            <div className="absolute left-3 top-0 bottom-0 w-px" style={{ background: 'linear-gradient(to bottom, #f59e0b40, #162236)' }} />
            <div className="space-y-2">
              {assignments.map((a) => {
                const isActive = !a.unassigned_at;
                const dotColor = isActive ? 'bg-amber-500 animate-pulse' : 'bg-green-500';

                return (
                  <div key={a.id} className="flex gap-3 relative pl-6">
                    <div className={`absolute left-1.5 top-2 w-3 h-3 rounded-full border-2 border-surface-base ${dotColor}`} />
                    <div className={`flex-1 p-2.5 border ${
                      isActive ? 'bg-amber-900/10 border-amber-700/30' : 'bg-surface-sunken border-rmpg-700'
                    }`}>
                      <div className="flex items-center gap-2 justify-between">
                        <div className="flex items-center gap-2">
                          {a.unit_call_sign && (
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase border ${
                              isActive
                                ? 'bg-amber-900/40 text-amber-400 border-amber-700/40'
                                : 'bg-brand-900/30 text-brand-400 border-brand-700/30'
                            }`}>
                              <Radio className="w-2.5 h-2.5" />{a.unit_call_sign}
                            </span>
                          )}
                          {isActive && (
                            <span className="px-1.5 py-0.5 text-[8px] font-bold uppercase bg-green-900/40 text-green-400 border border-green-700/40">
                              CURRENT
                            </span>
                          )}
                        </div>
                        <span className="text-[9px] text-rmpg-400 font-mono flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          {formatDuration(a.assigned_at, a.unassigned_at || undefined)}
                        </span>
                      </div>

                      {a.officer_name && (
                        <div className="flex items-center gap-1 mt-1 text-[10px] text-rmpg-300">
                          <User className="w-2.5 h-2.5 text-rmpg-400" />
                          {a.officer_name}
                        </div>
                      )}

                      <div className="flex items-center gap-2 mt-1 text-[9px] text-rmpg-500">
                        <span className="flex items-center gap-0.5">
                          <Clock className="w-2.5 h-2.5" />
                          Assigned: {formatMilitary(a.assigned_at)}
                        </span>
                        {a.unassigned_at && (
                          <>
                            <ArrowRight className="w-2.5 h-2.5" />
                            <span>Unassigned: {formatMilitary(a.unassigned_at)}</span>
                          </>
                        )}
                      </div>

                      {a.notes && <p className="text-[9px] text-rmpg-400 mt-1">{a.notes}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
