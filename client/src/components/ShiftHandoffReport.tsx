// ============================================================
// RMPG Flex — Shift Handoff Report
// Generates a printable shift transition report for officers
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from './PanelTitleBar';
import { safeDateTimeStr } from '../utils/dateUtils';
import {
  FileText, Printer, StickyNote, Plus,
} from 'lucide-react';

interface ShiftHandoffProps {
  officerId?: number;
}

interface HandoffData {
  text: string;
  updated_by: number | null;
  updated_at: string | null;
}

export default function ShiftHandoffReport({ officerId }: ShiftHandoffProps) {
  const [data, setData] = useState<HandoffData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [noteCategory, setNoteCategory] = useState('general');
  const [submitting, setSubmitting] = useState(false);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<HandoffData>('/dispatch/shift-handoff');
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [officerId]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  const addNote = async () => {
    if (!noteText.trim() || submitting) return;
    setSubmitting(true);
    try {
      const existing = data?.text || '';
      const noteEntry = `[${noteCategory}] ${noteText.trim()}`;
      const updatedText = existing ? `${existing}\n${noteEntry}` : noteEntry;
      await apiFetch('/dispatch/shift-handoff', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: updatedText }),
      });
      setNoteText('');
      fetchReport();
    } catch {
      setError('Failed to add note');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4 max-w-[1100px] mx-auto print:p-0 print:max-w-none">
      {/* ── Controls (hidden in print) ── */}
      <div className="flex items-center gap-3 flex-wrap print:hidden">
        <button onClick={fetchReport} className="toolbar-btn text-xs" disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
        <button onClick={() => window.print()} className="toolbar-btn text-xs ml-auto">
          <Printer size={13} className="mr-1 inline" />Print Report
        </button>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 text-red-400 text-xs px-3 py-2 rounded-[2px] font-mono">
          {error}
        </div>
      )}

      {/* ── Report Header ── */}
      <div className="panel-beveled bg-surface-base p-3 print:border print:border-rmpg-400">
        <h1 className="text-brand-400 text-sm font-bold tracking-wider uppercase flex items-center gap-2 mb-2">
          <FileText size={16} /> Shift Handoff Report
        </h1>
        {data?.updated_at && (
          <p className="text-[10px] text-rmpg-400 font-mono mb-2">
            Last updated: {safeDateTimeStr(data.updated_at)}
          </p>
        )}
      </div>

      {/* ── Handoff Text ── */}
      <div className="panel-beveled bg-surface-base print:border print:border-rmpg-400">
        <PanelTitleBar title="Handoff Notes" icon={StickyNote} />
        <div className="p-3">
          {data?.text ? (
            <pre className="text-xs font-mono text-rmpg-200 whitespace-pre-wrap leading-relaxed">
              {data.text}
            </pre>
          ) : (
            <p className="text-rmpg-400 text-xs font-mono py-2 text-center">No handoff notes yet</p>
          )}
        </div>
      </div>

      {/* ── Add Note ── */}
      <div className="panel-beveled bg-surface-base print:border print:border-rmpg-400 print:hidden">
        <PanelTitleBar title="Add Note" icon={Plus} />
        <div className="p-2">
          <div className="flex gap-2 items-end">
            <select id="ff-shifthandoffreport-2"
              value={noteCategory}
              onChange={e => setNoteCategory(e.target.value)}
              className="bg-surface-overlay border border-rmpg-600 text-rmpg-200 text-xs px-2 py-1.5 rounded-[2px] font-mono"
            >
              <option value="general">General</option>
              <option value="safety">Safety</option>
              <option value="followup">Follow-Up</option>
              <option value="equipment">Equipment</option>
            </select>
            <input id="ff-shifthandoffreport-3"
              type="text"
              placeholder="Add shift note..."
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addNote()}
              className="flex-1 bg-surface-overlay border border-rmpg-600 text-rmpg-100 text-xs px-2 py-1.5 rounded-[2px] font-mono placeholder:text-rmpg-500"
            />
            <button onClick={addNote} disabled={submitting || !noteText.trim()} className="toolbar-btn text-xs">
              <Plus size={13} className="mr-1 inline" />{submitting ? 'Saving...' : 'Add'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Print Styles ── */}
      <style>{`
        @media print {
          body { background: white !important; color: black !important; }
          .panel-beveled { background: white !important; box-shadow: none !important; }
          .panel-title-bar { background: #eee !important; color: #333 !important; -webkit-print-color-adjust: exact; }
          .text-rmpg-100, .text-rmpg-200, .text-rmpg-300 { color: #222 !important; }
          .text-rmpg-400 { color: #666 !important; }
          .text-brand-400 { color: #888888 !important; }
        }
      `}</style>
    </div>
  );
}
