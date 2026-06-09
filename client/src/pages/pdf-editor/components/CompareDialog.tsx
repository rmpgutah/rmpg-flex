import { useState } from 'react';
import { GitCompare, X } from 'lucide-react';
import IconButton from '../../../components/IconButton';

interface Props {
  open: boolean;
  onClose: () => void;
  pageCount: number;
  onCompare: (otherBytes: Uint8Array, pageNumber: number) => Promise<{ diffUrl: string; changed: number; aUrl: string; bUrl: string }>;
}

type View = 'diff' | 'side';

/** Compare the current document against a second PDF, page-by-page, via a
 *  pixel diff. Renders both pages through the engine and highlights changed
 *  regions in gold. Side-by-side and overlay-diff views. */
export default function CompareDialog({ open, onClose, pageCount, onCompare }: Props) {
  const [other, setOther] = useState<Uint8Array | null>(null);
  const [otherName, setOtherName] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ diffUrl: string; changed: number; aUrl: string; bUrl: string } | null>(null);
  const [view, setView] = useState<View>('diff');

  if (!open) return null;

  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.pdf')) { setErr('Choose a PDF to compare against.'); return; }
    setErr(null);
    setOther(new Uint8Array(await f.arrayBuffer()));
    setOtherName(f.name);
    setResult(null);
  };

  const run = async () => {
    if (!other) { setErr('Load a second PDF first.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await onCompare(other, page);
      setResult(r);
    } catch (e) {
      setErr(`Compare failed: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally { setBusy(false); }
  };

  const close = () => { setOther(null); setOtherName(''); setResult(null); setErr(null); setPage(1); onClose(); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={close}>
      <div className="bg-[#0d0d0d] border border-[#222222] rounded-[2px] w-[680px] max-h-[88vh] overflow-y-auto p-4 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-[11px] uppercase tracking-wider text-[#d4a017] font-semibold inline-flex items-center gap-1.5">
            <GitCompare className="w-3.5 h-3.5" /> Compare PDFs
          </div>
          <IconButton onClick={close} aria-label="Close" title="Close" className="text-rmpg-400 hover:text-white p-1"><X className="w-4 h-4" /></IconButton>
        </div>

        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <label className="text-[10px] text-rmpg-300 border border-[#222] rounded-sm px-2 py-1 cursor-pointer hover:text-white">
            {otherName ? `2nd PDF: ${otherName}` : 'Choose 2nd PDF…'}
            <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={e => { pickFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <span className="text-[10px] text-rmpg-500">Page</span>
          <input id="ff-compare-page" type="number" min={1} max={pageCount} value={page}
            onChange={e => setPage(Math.max(1, Math.min(pageCount, parseInt(e.target.value, 10) || 1)))}
            className="bg-[#0a0a0a] border border-[#222] text-xs text-white px-2 py-1 rounded-sm w-16 focus:outline-none focus:border-[#d4a017]" />
          <span className="text-[10px] text-rmpg-600">of {pageCount}</span>
          <button type="button" disabled={busy || !other} onClick={run} className="btn-primary text-[11px] ml-auto disabled:opacity-40">{busy ? 'Comparing…' : 'Compare'}</button>
        </div>

        {err && <div className="text-[10px] text-yellow-300 mb-2">{err}</div>}

        {result && (
          <>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] text-rmpg-400">
                Changed area: <span className="text-[#d4a017] font-mono">{(result.changed * 100).toFixed(2)}%</span>
                {result.changed < 0.0005 && <span className="text-green-300"> — pages look identical</span>}
              </span>
              <div className="ml-auto flex gap-1">
                <button type="button" onClick={() => setView('diff')} className={`px-2 py-0.5 text-[10px] rounded-sm border ${view === 'diff' ? 'bg-[#d4a017]/20 text-[#d4a017] border-[#d4a017]' : 'border-[#222] text-rmpg-400'}`}>Diff overlay</button>
                <button type="button" onClick={() => setView('side')} className={`px-2 py-0.5 text-[10px] rounded-sm border ${view === 'side' ? 'bg-[#d4a017]/20 text-[#d4a017] border-[#d4a017]' : 'border-[#222] text-rmpg-400'}`}>Side by side</button>
              </div>
            </div>
            <div className="bg-[#050505] border border-[#222] rounded-sm p-2">
              {view === 'diff' ? (
                <img src={result.diffUrl} alt="Page diff" className="max-w-full mx-auto block" />
              ) : (
                <div className="flex gap-2 justify-center">
                  <div className="flex-1">
                    <div className="text-[9px] text-rmpg-500 text-center mb-1">This document</div>
                    <img src={result.aUrl} alt="Document A page" className="max-w-full block border border-[#222]" />
                  </div>
                  <div className="flex-1">
                    <div className="text-[9px] text-rmpg-500 text-center mb-1">{otherName || 'Second document'}</div>
                    <img src={result.bUrl} alt="Document B page" className="max-w-full block border border-[#222]" />
                  </div>
                </div>
              )}
            </div>
            <div className="text-[9px] text-rmpg-600 mt-1">Gold pixels mark regions that differ. Compares the same 1-indexed page in each document.</div>
          </>
        )}
      </div>
    </div>
  );
}
