// ============================================================
// Background Check Detail Panel
// ============================================================
// Modal/slide-over that displays full background check report.
// Opened from NCIC terminal when a QB query returns results.
// Shows criminal records, court cases, and sex offender registry
// data in a structured, readable format.

import React, { useState, useEffect } from 'react';
import {
  X, FileSearch, AlertTriangle, Shield, Gavel,
  Clock, MapPin, Loader2,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import type { BackgroundRecord } from '../utils/ncicFormatter';

interface BackgroundCheckDetailProps {
  searchId: number;
  onClose: () => void;
}

interface BackgroundCheckData {
  found: boolean;
  search?: {
    id: number;
    product: string;
    search_type: string;
    search_input: string;
    response_data: {
      hit: boolean;
      sources: string[];
      records: BackgroundRecord[];
      resultCount: number;
    };
    hit: number;
    subject_count: number;
    searched_by: number;
    created_at: string;
  };
}

export default function BackgroundCheckDetail({ searchId, onClose }: BackgroundCheckDetailProps) {
  const [data, setData] = useState<BackgroundCheckData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<BackgroundCheckData>(`/microbilt/background/${searchId}`)
      .then(setData)
      .catch(() => setData({ found: false }))
      .finally(() => setLoading(false));
  }, [searchId]);

  const records = data?.search?.response_data?.records || [];
  const criminal = records.filter(r => r.record_type === 'CRIMINAL');
  const court = records.filter(r => r.record_type === 'COURT');
  const sexOffender = records.filter(r => r.record_type === 'SEX_OFFENDER');

  // Parse search input for display
  let subjectName = '';
  try {
    const input = JSON.parse(data?.search?.search_input || '{}');
    subjectName = `${input.firstName || ''} ${input.lastName || ''}`.trim().toUpperCase();
  } catch { /* */ }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="bg-surface-base border border-rmpg-700 rounded-sm shadow-md w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-700">
          <div className="flex items-center gap-2">
            <FileSearch className="w-4 h-4 text-brand-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-rmpg-200">
              Background Check Report
            </span>
            <span className="text-[9px] px-1.5 py-0.5 rounded-sm bg-red-900/30 text-red-400 border border-red-800/30 font-bold">
              CONFIDENTIAL
            </span>
          </div>
          <button type="button" onClick={onClose} className="text-rmpg-500 hover:text-rmpg-300" aria-label="Close" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading && (
            <div className="flex items-center justify-center py-8 gap-2 text-rmpg-400 text-xs">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading report...
            </div>
          )}

          {!loading && !data?.found && (
            <div className="text-center py-8 text-rmpg-500 text-xs">
              Report not found. It may have been removed from the cache.
            </div>
          )}

          {!loading && data?.found && (
            <>
              {/* Subject Info */}
              <div className="bg-surface-sunken p-3 rounded-sm space-y-1">
                <div className="text-sm font-bold text-rmpg-100">{subjectName || 'UNKNOWN SUBJECT'}</div>
                <div className="flex items-center gap-4 text-[10px] text-rmpg-400">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Searched: {data.search?.created_at ? new Date(data.search.created_at).toLocaleString() : 'N/A'}
                  </span>
                  <span>Search ID: #{searchId}</span>
                  <span>{records.length} record(s) found</span>
                </div>
                {data.search?.response_data?.sources && (
                  <div className="flex items-center gap-1 mt-1">
                    {data.search.response_data.sources.map(src => (
                      <span key={src} className="text-[8px] px-1.5 py-0.5 bg-brand-900/30 text-brand-400 border border-brand-800/30 rounded-sm">
                        {src}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Sex Offender Alert */}
              {sexOffender.length > 0 && (
                <div className="bg-red-950/30 border border-red-800/40 p-3 rounded-sm flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-bold text-red-400">SEX OFFENDER REGISTRY MATCH</div>
                    <div className="text-[10px] text-red-300/80 mt-0.5">
                      {sexOffender.length} record(s) found in the national sex offender registry. Exercise caution.
                    </div>
                  </div>
                </div>
              )}

              {/* Criminal Records */}
              {criminal.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
                    <Shield className="w-3.5 h-3.5 text-amber-400" />
                    Criminal Records ({criminal.length})
                  </div>
                  <div className="space-y-1.5">
                    {criminal.map((r, i) => (
                      <div key={i} className="bg-surface-sunken p-2.5 rounded-sm space-y-1 border-l-2 border-amber-500/50">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-medium text-rmpg-100">{r.offense || 'Unknown Offense'}</span>
                          {r.status && (
                            <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-sm ${
                              r.status.toUpperCase() === 'ACTIVE'
                                ? 'bg-red-900/30 text-red-400 border border-red-800/30'
                                : 'bg-rmpg-700/30 text-rmpg-400 border border-rmpg-600/30'
                            }`}>
                              {r.status.toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] text-rmpg-400">
                          {r.offense_date && <div>Date: <span className="text-rmpg-300">{r.offense_date}</span></div>}
                          {r.court && <div>Court: <span className="text-rmpg-300">{r.court}</span></div>}
                          {r.case_number && <div>Case #: <span className="text-rmpg-300">{r.case_number}</span></div>}
                          {r.state && <div>State: <span className="text-rmpg-300">{r.state}</span></div>}
                          {r.disposition && <div>Disposition: <span className="text-rmpg-300">{r.disposition.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</span></div>}
                          {r.sentence && <div>Sentence: <span className="text-rmpg-300">{r.sentence}</span></div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Court / Public Records */}
              {court.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
                    <Gavel className="w-3.5 h-3.5 text-gray-400" />
                    Court / Public Records ({court.length})
                  </div>
                  <div className="space-y-1.5">
                    {court.map((r, i) => (
                      <div key={i} className="bg-surface-sunken p-2.5 rounded-sm space-y-1 border-l-2 border-gray-500/50">
                        <div className="text-[11px] font-medium text-rmpg-100">{r.offense || 'Court Record'}</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] text-rmpg-400">
                          {r.offense_date && <div>Filed: <span className="text-rmpg-300">{r.offense_date}</span></div>}
                          {r.court && <div>Court: <span className="text-rmpg-300">{r.court}</span></div>}
                          {r.case_number && <div>Case #: <span className="text-rmpg-300">{r.case_number}</span></div>}
                          {r.state && <div>State: <span className="text-rmpg-300">{r.state}</span></div>}
                          {r.disposition && <div>Disposition: <span className="text-rmpg-300">{r.disposition.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</span></div>}
                          {r.status && <div>Status: <span className="text-rmpg-300">{r.status.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</span></div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sex Offender Registry */}
              {sexOffender.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-red-400 uppercase tracking-wider">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Sex Offender Registry ({sexOffender.length})
                  </div>
                  <div className="space-y-1.5">
                    {sexOffender.map((r, i) => (
                      <div key={i} className="bg-red-950/20 p-2.5 rounded-sm space-y-1 border-l-2 border-red-500/50">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-medium text-red-300">{r.offense || 'Registered Sex Offender'}</span>
                          {r.tier && (
                            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-sm bg-red-900/30 text-red-400 border border-red-800/30">
                              {r.tier.toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] text-rmpg-400">
                          {r.state && <div>State: <span className="text-red-300/80">{r.state}</span></div>}
                          {r.status && <div>Status: <span className="text-red-300/80">{r.status.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</span></div>}
                          {r.offense_date && <div>Date: <span className="text-red-300/80">{r.offense_date}</span></div>}
                          {r.court && <div>Jurisdiction: <span className="text-red-300/80">{r.court}</span></div>}
                          {r.registry_address && (
                            <div className="col-span-2 flex items-center gap-1">
                              <MapPin className="w-3 h-3 text-red-400/60" />
                              <span className="text-red-300/80">{r.registry_address}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Footer disclaimer */}
              <div className="text-[9px] text-rmpg-600 bg-surface-sunken p-2 rounded-sm">
                This report contains information from third-party databases. Verify all information
                independently before taking any official action. Search ID: #{searchId}.
                Results cached for 30 days — use QB! to force a fresh search.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
