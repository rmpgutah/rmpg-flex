import { useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { X, Merge, Search, RefreshCw } from 'lucide-react';
import {
  scanPlaceholders, fetchCallForMerge, buildMergeValues, applyMerge, resolveKey,
  type MergeCall, type OfficerContext,
} from '../mailMerge';

/** Mail-merge side panel: scans the current document for {{placeholders}},
 *  pulls a CFS call + officer context, lets the user fill any remaining tokens
 *  manually, then replaces every token in the document in one pass. */
export default function MergePanel({
  editor, officer, onClose, flash,
}: {
  editor: Editor;
  officer: OfficerContext;
  onClose: () => void;
  flash: (msg: string) => void;
}) {
  const [version, setVersion] = useState(0);
  const [callNumber, setCallNumber] = useState('');
  const [call, setCall] = useState<MergeCall | null>(null);
  const [loadingCall, setLoadingCall] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const [manual, setManual] = useState<Record<string, string>>({});

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    editor.on('update', bump);
    return () => { editor.off('update', bump); };
  }, [editor]);

  const placeholders = useMemo(() => scanPlaceholders(editor.getHTML()), [editor, version]);
  const autoValues = useMemo(() => buildMergeValues(call, officer), [call, officer]);

  const lookupCall = async () => {
    if (!callNumber.trim()) return;
    setLoadingCall(true); setCallError(null);
    const c = await fetchCallForMerge(callNumber);
    setLoadingCall(false);
    if (c) { setCall(c); }
    else { setCall(null); setCallError('No matching call found.'); }
  };

  const doMerge = () => {
    const values = { ...autoValues, ...manual };
    const res = applyMerge(editor, values);
    if (res.filled === 0 && res.missing.length === 0) {
      flash('No {{placeholders}} found in this document.');
    } else if (res.missing.length) {
      flash(`Filled ${res.filled}. ${res.missing.length} still unmapped: ${res.missing.slice(0, 4).join(', ')}${res.missing.length > 4 ? '…' : ''}`);
    } else {
      flash(`Mail-merge complete — filled ${res.filled} placeholder${res.filled === 1 ? '' : 's'}.`);
    }
  };

  // Tokens that have no automatic value (so the user can type one).
  const unmapped = placeholders.filter((p) => resolveKey(p, autoValues) === undefined);

  return (
    <div className="w-[320px] flex-shrink-0 bg-surface-sunken border border-border-default rounded-[2px] flex flex-col text-rmpg-200 text-xs">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default">
        <span className="font-semibold text-rmpg-100 uppercase tracking-wider text-[10px] flex items-center gap-1.5">
          <Merge className="w-3.5 h-3.5 text-[#d4a017]" /> Mail Merge
        </span>
        <button type="button" onClick={onClose} aria-label="Close mail merge" className="text-rmpg-500 hover:text-rmpg-100"><X className="w-3.5 h-3.5" /></button>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-3">
        {/* CFS call lookup */}
        <div>
          <div className="text-[9px] uppercase tracking-wider text-rmpg-500 mb-1">Pull from CFS call</div>
          <div className="flex items-center gap-1">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-600" />
              <input
                value={callNumber}
                onChange={(e) => setCallNumber(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') lookupCall(); }}
                placeholder="Call number…"
                className="w-full bg-surface-sunken border border-border-default rounded-[2px] pl-6 pr-2 py-1 text-[11px] focus:border-[#d4a017]/40 focus:outline-none"
              />
            </div>
            <button type="button" onClick={lookupCall} disabled={loadingCall}
              className="px-2 py-1 text-[10px] bg-[#d4a017]/10 border border-[#d4a017]/30 text-[#d4a017] rounded-[2px] hover:bg-[#d4a017]/20 disabled:opacity-50">
              {loadingCall ? '…' : 'Fetch'}
            </button>
          </div>
          {callError && <div className="text-[10px] text-red-400/80 mt-1">{callError}</div>}
          {call && (
            <div className="mt-1.5 p-1.5 bg-surface-base border border-border-default rounded-[2px] text-[10px]">
              <div className="text-[#d4a017] font-mono">{String(call.call_number || '')}</div>
              <div className="text-rmpg-300">{String(call.call_type || '')} · {String(call.address || '')}</div>
            </div>
          )}
        </div>

        {/* Placeholders found */}
        <div>
          <div className="text-[9px] uppercase tracking-wider text-rmpg-500 mb-1">
            Placeholders in document ({placeholders.length})
          </div>
          {placeholders.length === 0 && (
            <p className="text-[10px] text-rmpg-600 leading-snug">
              No <code className="text-[#d4a017]">{'{{tokens}}'}</code> found. Add tokens like
              {' '}<code className="text-[#d4a017]">{'{{officer_name}}'}</code>,
              {' '}<code className="text-[#d4a017]">{'{{call_number}}'}</code>,
              {' '}<code className="text-[#d4a017]">{'{{address}}'}</code> and they'll be filled here.
            </p>
          )}
          <div className="space-y-0.5">
            {placeholders.map((p) => {
              const auto = resolveKey(p, autoValues);
              const val = auto ?? manual[p] ?? '';
              return (
                <div key={p} className="flex items-center gap-1">
                  <code className="text-[10px] text-[#d4a017] w-28 truncate" title={p}>{`{{${p}}}`}</code>
                  {auto !== undefined ? (
                    <span className="min-w-0 flex-1 text-[10px] text-rmpg-300 truncate" title={auto}>{auto || <span className="text-rmpg-600 italic">empty</span>}</span>
                  ) : (
                    <input
                      value={manual[p] ?? ''}
                      onChange={(e) => setManual((m) => ({ ...m, [p]: e.target.value }))}
                      placeholder="(manual)"
                      className="flex-1 bg-surface-sunken border border-border-default rounded-[2px] px-1.5 py-0.5 text-[10px] focus:border-[#d4a017]/40 focus:outline-none"
                    />
                  )}
                </div>
              );
            })}
          </div>
          {unmapped.length > 0 && (
            <p className="text-[9px] text-rmpg-600 mt-1 leading-snug">
              {unmapped.length} token{unmapped.length === 1 ? '' : 's'} need a manual value above.
            </p>
          )}
        </div>
      </div>

      <div className="p-2 border-t border-border-default flex items-center gap-1">
        <button type="button" onClick={() => setVersion((v) => v + 1)}
          title="Re-scan document for placeholders"
          className="px-2 py-1.5 text-[10px] bg-surface-base border border-border-default text-rmpg-300 rounded-[2px] hover:bg-surface-raised flex items-center gap-1">
          <RefreshCw className="w-3 h-3" /> Rescan
        </button>
        <button type="button" onClick={doMerge}
          disabled={placeholders.length === 0}
          className="flex-1 px-2 py-1.5 text-[10px] font-medium bg-[#d4a017]/10 border border-[#d4a017]/30 text-[#d4a017] rounded-[2px] hover:bg-[#d4a017]/20 disabled:opacity-40 flex items-center justify-center gap-1">
          <Merge className="w-3 h-3" /> Merge into document
        </button>
      </div>
    </div>
  );
}
