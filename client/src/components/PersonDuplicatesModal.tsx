import React, { useState, useEffect, useCallback } from 'react';
import { X, Loader2, AlertTriangle, Users, ChevronRight, Merge } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';

interface DuplicatePair {
  id1: number; first_name1: string; last_name1: string; dob1: string | null;
  id2: number; first_name2: string; last_name2: string; dob2: string | null;
}

interface PersonDuplicatesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMergeComplete: () => void;
}

export default function PersonDuplicatesModal({ isOpen, onClose, onMergeComplete }: PersonDuplicatesModalProps) {
  const [pairs, setPairs] = useState<DuplicatePair[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [merging, setMerging] = useState<string | null>(null);
  const [confirmMerge, setConfirmMerge] = useState<{ keepId: number; mergeId: number; keepName: string; mergeName: string } | null>(null);

  const fetchDuplicates = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<DuplicatePair[]>('/records/persons/duplicates');
      setPairs(res || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch duplicates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) fetchDuplicates();
  }, [isOpen, fetchDuplicates]);

  const handleMerge = async () => {
    if (!confirmMerge) return;
    const key = `${confirmMerge.keepId}-${confirmMerge.mergeId}`;
    setMerging(key);
    try {
      await apiFetch('/records/persons/merge', {
        method: 'POST',
        body: JSON.stringify({ keep_id: confirmMerge.keepId, merge_id: confirmMerge.mergeId }),
      });
      setPairs(prev => prev.filter(p =>
        !(p.id1 === confirmMerge.keepId && p.id2 === confirmMerge.mergeId) &&
        !(p.id1 === confirmMerge.mergeId && p.id2 === confirmMerge.keepId)
      ));
      setConfirmMerge(null);
      onMergeComplete();
    } catch (err: any) {
      setError(err?.message || 'Merge failed');
    } finally {
      setMerging(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative w-full max-w-2xl mx-4 shadow-md panel-beveled" style={{ background: '#0a0a0a' }} onClick={e => e.stopPropagation()}>
        <div className="panel-title-bar">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2" style={{ background: '#d4a017' }} />
            <Users className="title-icon" />
            <span>DUPLICATE PERSON RECORDS</span>
            <span className="text-[9px] text-rmpg-400 ml-1">({pairs.length} pairs)</span>
          </div>
          <button type="button" onClick={onClose} className="toolbar-btn" style={{ padding: '1px 4px' }}>
            <X className="w-3 h-3" />
          </button>
        </div>

        <div className="p-4 max-h-[70vh] overflow-y-auto space-y-3">
          {loading && (
            <div className="flex items-center justify-center py-8 text-rmpg-400 text-xs">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Scanning for duplicates...
            </div>
          )}

          {error && (
            <div className="px-3 py-2 bg-red-900/30 border border-red-700 text-red-400 text-xs">{error}</div>
          )}

          {!loading && pairs.length === 0 && !error && (
            <div className="text-center py-8 text-rmpg-400 text-xs">No duplicate records detected.</div>
          )}

          {pairs.map((p) => (
            <div key={`${p.id1}-${p.id2}`} className="border border-rmpg-700 bg-surface-sunken">
              <div className="flex items-center gap-2 px-3 py-2">
                {/* Person A */}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-white">{p.first_name1} {p.last_name1}</div>
                  <div className="text-[9px] text-rmpg-400">ID #{p.id1} {p.dob1 && `• DOB: ${p.dob1}`}</div>
                </div>

                <ChevronRight className="w-3 h-3 text-rmpg-500 flex-shrink-0" />

                {/* Person B */}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-white">{p.first_name2} {p.last_name2}</div>
                  <div className="text-[9px] text-rmpg-400">ID #{p.id2} {p.dob2 && `• DOB: ${p.dob2}`}</div>
                </div>

                {/* Merge buttons */}
                <div className="flex gap-1 flex-shrink-0">
                  <button
                    type="button"
                    className="toolbar-btn text-[9px] text-green-400"
                    style={{ padding: '2px 6px' }}
                    title={`Keep ${p.first_name1} ${p.last_name1}, merge #${p.id2} into it`}
                    onClick={() => setConfirmMerge({ keepId: p.id1, mergeId: p.id2, keepName: `${p.first_name1} ${p.last_name1}`, mergeName: `${p.first_name2} ${p.last_name2}` })}
                  >
                    Keep Left
                  </button>
                  <button
                    type="button"
                    className="toolbar-btn text-[9px] text-green-400"
                    style={{ padding: '2px 6px' }}
                    title={`Keep ${p.first_name2} ${p.last_name2}, merge #${p.id1} into it`}
                    onClick={() => setConfirmMerge({ keepId: p.id2, mergeId: p.id1, keepName: `${p.first_name2} ${p.last_name2}`, mergeName: `${p.first_name1} ${p.last_name1}` })}
                  >
                    Keep Right
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Confirm Merge Dialog */}
        {confirmMerge && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center" onClick={() => setConfirmMerge(null)}>
            <div className="absolute inset-0 bg-black/50" />
            <div className="relative w-full max-w-sm mx-4 bg-surface-base border border-rmpg-600 shadow-md" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-2 px-4 py-2 border-b border-rmpg-600" style={{ background: 'linear-gradient(180deg, #1a1a1a 0%, #0a0a0a 100%)' }}>
                <Merge className="w-4 h-4 text-amber-400" />
                <h2 className="text-xs font-bold text-white uppercase tracking-wider">Confirm Merge</h2>
              </div>
              <div className="p-5 space-y-3">
                <p className="text-sm text-rmpg-200">
                  Keep <strong className="text-white">{confirmMerge.keepName}</strong> and merge
                  <strong className="text-amber-400"> {confirmMerge.mergeName}</strong> into it?
                </p>
                <p className="text-[10px] text-rmpg-400">
                  All linked records (calls, incidents, citations, warrants) will be transferred to the kept record.
                  The merged record will be archived.
                </p>
                <div className="flex items-center justify-end gap-3 pt-3">
                  <button type="button" onClick={() => setConfirmMerge(null)} className="toolbar-btn" style={{ padding: '4px 12px' }}>Cancel</button>
                  <button
                    type="button"
                    onClick={handleMerge}
                    disabled={!!merging}
                    className="toolbar-btn toolbar-btn-primary"
                    style={{ padding: '4px 12px' }}
                  >
                    {merging ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Merge'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
