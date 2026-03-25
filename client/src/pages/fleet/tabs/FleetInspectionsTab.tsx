import React, { useState, useEffect } from 'react';
import {
  ClipboardCheck, Plus, Calendar, CheckCircle, XCircle, AlertTriangle, ChevronDown, ChevronRight, Gauge, Pencil, Trash2,
} from 'lucide-react';
import type { FleetInspection, InspectionType, InspectionResult, InspectionItemStatus } from '../../../types';
import { formatMilitary } from '../utils/fleetFormatters';

const TYPE_BADGE: Record<InspectionType, { bg: string; text: string; border: string }> = {
  pre_trip: { bg: 'bg-blue-900/30', text: 'text-blue-400', border: 'border-blue-700/40' },
  post_trip: { bg: 'bg-cyan-900/30', text: 'text-cyan-400', border: 'border-cyan-700/40' },
  monthly: { bg: 'bg-amber-900/30', text: 'text-amber-400', border: 'border-amber-700/40' },
  annual: { bg: 'bg-green-900/30', text: 'text-green-400', border: 'border-green-700/40' },
};

const TYPE_LABEL: Record<InspectionType, string> = {
  pre_trip: 'Pre-Trip', post_trip: 'Post-Trip', monthly: 'Monthly', annual: 'Annual',
};

const RESULT_LED: Record<InspectionResult, string> = {
  pass: 'led-dot led-green', fail: 'led-dot led-red', needs_attention: 'led-dot led-amber',
};

const RESULT_LABEL: Record<InspectionResult, string> = {
  pass: 'PASS', fail: 'FAIL', needs_attention: 'ATTENTION',
};

const RESULT_COLOR: Record<InspectionResult, string> = {
  pass: 'text-green-400', fail: 'text-red-400', needs_attention: 'text-amber-400',
};

const ITEM_STATUS_ICON: Record<InspectionItemStatus, React.ReactNode> = {
  pass: <CheckCircle className="w-3 h-3 text-green-400" />,
  fail: <XCircle className="w-3 h-3 text-red-400" />,
  needs_attention: <AlertTriangle className="w-3 h-3 text-amber-400" />,
  na: <span className="w-3 h-3 inline-flex items-center justify-center text-[8px] text-rmpg-500 font-bold">N/A</span>,
};

interface Props {
  inspections: FleetInspection[];
  onNewInspection: () => void;
  onEditInspection?: (inspection: FleetInspection) => void;
  onDeleteInspection?: (inspection: FleetInspection) => void;
}

export default function FleetInspectionsTab({ inspections, onNewInspection, onEditInspection, onDeleteInspection }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const passCount = inspections.filter(i => i.overall_result === 'pass').length;
  const failCount = inspections.filter(i => i.overall_result === 'fail').length;
  const passRate = inspections.length > 0 ? Math.round((passCount / inspections.length) * 100) : 0;
  const lastInspection = inspections.length > 0 ? inspections[0] : null;

  // Set document title
  useEffect(() => { document.title = 'Fleet - Inspections \u2014 RMPG Flex'; }, []);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="panel-beveled p-2.5 text-center bg-surface-sunken">
          <ClipboardCheck className="w-3.5 h-3.5 mx-auto text-blue-400 mb-1" />
          <div className="text-sm font-bold font-mono text-blue-400">{inspections.length}</div>
          <div className="text-[7px] text-rmpg-500 uppercase">Total</div>
        </div>
        <div className="panel-beveled p-2.5 text-center bg-surface-sunken">
          <CheckCircle className="w-3.5 h-3.5 mx-auto mb-1" style={{ color: passRate >= 80 ? '#22c55e' : passRate >= 50 ? '#f59e0b' : '#ef4444' }} />
          <div className="text-sm font-bold font-mono" style={{ color: passRate >= 80 ? '#22c55e' : passRate >= 50 ? '#f59e0b' : '#ef4444' }}>
            {inspections.length > 0 ? `${passRate}%` : '-'}
          </div>
          <div className="text-[7px] text-rmpg-500 uppercase">Pass Rate</div>
        </div>
        <div className="panel-beveled p-2.5 text-center bg-surface-sunken">
          <Calendar className="w-3.5 h-3.5 mx-auto text-cyan-400 mb-1" />
          <div className="text-[10px] font-bold font-mono text-cyan-400">
            {lastInspection ? formatMilitary(lastInspection.inspection_date) : '-'}
          </div>
          <div className="text-[7px] text-rmpg-500 uppercase">Last Insp.</div>
        </div>
        <div className="panel-beveled p-2.5 text-center bg-surface-sunken">
          <span className={lastInspection ? RESULT_LED[lastInspection.overall_result] : 'led-dot led-off'} style={{ width: 10, height: 10, margin: '0 auto 4px' }} />
          <div className={`text-[10px] font-bold ${lastInspection ? RESULT_COLOR[lastInspection.overall_result] : 'text-rmpg-500'}`}>
            {lastInspection ? RESULT_LABEL[lastInspection.overall_result] : '-'}
          </div>
          <div className="text-[7px] text-rmpg-500 uppercase">Last Result</div>
        </div>
      </div>

      {/* Action Bar */}
      <div className="flex items-center justify-between">
        <h3 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider flex items-center gap-1.5">
          <ClipboardCheck className="w-3 h-3" /> Inspection History ({inspections.length})
          {failCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 text-[8px] font-bold bg-red-900/30 text-red-400 border border-red-700/40">
              {failCount} FAILED
            </span>
          )}
        </h3>
        <button type="button" className="toolbar-btn toolbar-btn-primary print:hidden" onClick={onNewInspection}>
          <Plus className="w-3 h-3" /> New Inspection
        </button>
      </div>

      {/* Inspection List */}
      {inspections.length === 0 ? (
        <div className="text-center py-10 panel-beveled bg-surface-base">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-sunken">
            <ClipboardCheck className="w-7 h-7 text-rmpg-600" />
          </div>
          <p className="text-[11px] text-rmpg-400 font-semibold">No Inspections Recorded</p>
          <p className="text-[9px] text-rmpg-600 mt-1 max-w-[260px] mx-auto">
            Perform pre-trip, post-trip, monthly, or annual inspections to maintain compliance and track vehicle condition.
          </p>
          <button type="button" className="toolbar-btn toolbar-btn-primary mt-3" onClick={onNewInspection}>
            <Plus className="w-3 h-3" /> Start First Inspection
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          {inspections.map((insp) => {
            const badge = TYPE_BADGE[insp.inspection_type];
            const isExpanded = expandedId === insp.id;
            const itemFailCount = (insp.items || []).filter(i => i.status === 'fail').length;
            const attentionCount = (insp.items || []).filter(i => i.status === 'needs_attention').length;

            return (
              <div key={insp.id} className="panel-beveled bg-surface-base">
                <div
                  className="flex items-center gap-3 p-2.5 cursor-pointer hover:bg-surface-raised transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : insp.id)}
                >
                  <div className="flex-shrink-0">
                    <span className={RESULT_LED[insp.overall_result]} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`px-1 py-0.5 text-[8px] font-bold uppercase border ${badge.bg} ${badge.text} ${badge.border}`}>
                        {TYPE_LABEL[insp.inspection_type]}
                      </span>
                      <span className={`text-[9px] font-bold ${RESULT_COLOR[insp.overall_result]}`}>
                        {RESULT_LABEL[insp.overall_result]}
                      </span>
                      {itemFailCount > 0 && <span className="text-[8px] text-red-400">{itemFailCount} failed</span>}
                      {attentionCount > 0 && <span className="text-[8px] text-amber-400">{attentionCount} attention</span>}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-[9px] text-rmpg-500">
                      <span className="flex items-center gap-0.5">
                        <Calendar className="w-2.5 h-2.5" />
                        {formatMilitary(insp.inspection_date)}
                      </span>
                      <span>Inspector: {insp.inspector_name}</span>
                      {insp.mileage != null && (
                        <span className="flex items-center gap-0.5"><Gauge className="w-2.5 h-2.5" />{insp.mileage.toLocaleString()} mi</span>
                      )}
                    </div>
                  </div>
                  {/* Admin Edit / Delete */}
                  {(onEditInspection || onDeleteInspection) && (
                    <div className="flex items-center gap-1 mr-1">
                      {onEditInspection && (
                        <button type="button"
                          className="p-1 text-rmpg-500 hover:text-brand-400 hover:bg-rmpg-700 rounded-sm transition-colors"
                          onClick={(e) => { e.stopPropagation(); onEditInspection(insp); }}
                          title="Edit inspection"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      )}
                      {onDeleteInspection && (
                        <button type="button"
                          className="p-1 text-rmpg-500 hover:text-red-400 hover:bg-red-900/20 rounded-sm transition-colors"
                          onClick={(e) => { e.stopPropagation(); onDeleteInspection(insp); }}
                          title="Delete inspection"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  )}
                  {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-rmpg-400" /> : <ChevronRight className="w-3.5 h-3.5 text-rmpg-400" />}
                </div>

                {/* Expanded Items */}
                {isExpanded && (
                  <div className="border-t border-rmpg-700">
                    {/* Group by category */}
                    {Array.from(new Set((insp.items || []).map(i => i.category))).map(category => (
                      <div key={category}>
                        <div className="px-3 py-1 text-[8px] text-rmpg-400 uppercase font-bold tracking-wider bg-surface-sunken">
                          {category}
                        </div>
                        {(insp.items || []).filter(i => i.category === category).map((item, idx) => (
                          <div key={idx} className="flex items-center gap-2 px-3 py-1 border-t border-rmpg-700">
                            {ITEM_STATUS_ICON[item.status]}
                            <span className="text-[10px] text-rmpg-300 flex-1">{item.item}</span>
                            {item.notes && <span className="text-[9px] text-rmpg-500 italic">{item.notes}</span>}
                          </div>
                        ))}
                      </div>
                    ))}
                    {insp.notes && (
                      <div className="px-3 py-2 border-t border-rmpg-700">
                        <span className="text-[9px] text-rmpg-400 uppercase font-bold">Notes: </span>
                        <span className="text-[10px] text-rmpg-300">{insp.notes}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
