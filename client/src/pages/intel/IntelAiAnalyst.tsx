// Intel AI Analyst — natural-language questions answered from the FTS index
// with citations (POST /api/intel/ai/ask), plus a per-person Claude dossier
// summary (fetch system-history → POST /api/intel/ai/summarize). Degrades
// cleanly when the Anthropic key isn't configured (the API returns 503).
import { useState } from 'react';
import { Sparkles, Loader2, FileText, AlertTriangle, Search } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

interface Source { type: string; id: number; label: string; snippet?: string; }
interface AskResult { answer: string; citations: Source[]; sources: Source[]; }

const EXAMPLES = [
  'Any active warrants linked to a silver Toyota?',
  'Who has had the most calls for service this month?',
  'Vehicles seen near recent thefts',
];

function notConfigured(err: any): boolean {
  const s = `${err?.code ?? ''} ${err?.message ?? ''}`;
  return /NO_AI_KEY|not configured/i.test(s);
}

export default function IntelAiAnalyst() {
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState('');
  const [summaries, setSummaries] = useState<Record<number, string>>({});
  const [summarizing, setSummarizing] = useState<number | null>(null);

  const ask = async (q?: string) => {
    const text = (q ?? question).trim();
    if (!text) return;
    if (q) setQuestion(q);
    setAsking(true); setError(''); setResult(null); setSummaries({});
    try {
      const res = await apiFetch<AskResult>('/intel/ai/ask', { method: 'POST', body: JSON.stringify({ question: text }) });
      setResult(res);
    } catch (e: any) {
      setError(notConfigured(e)
        ? 'AI is not configured — set the Anthropic API key in Admin → API Integrations.'
        : (e?.message || 'AI request failed'));
    } finally { setAsking(false); }
  };

  const summarize = async (s: Source) => {
    setSummarizing(s.id);
    try {
      const hist = await apiFetch<any>(`/records/persons/${s.id}/system-history`);
      const sections = {
        warrants: hist?.warrants ?? [], incidents: hist?.incidents ?? [],
        calls: hist?.calls ?? [], citations: hist?.citations ?? [],
      };
      const res = await apiFetch<{ summary: string }>('/intel/ai/summarize', {
        method: 'POST', body: JSON.stringify({ label: s.label, sections }),
      });
      setSummaries((prev) => ({ ...prev, [s.id]: res.summary }));
    } catch (e: any) {
      setSummaries((prev) => ({ ...prev, [s.id]: '✗ ' + (notConfigured(e) ? 'AI not configured' : (e?.message || 'summary failed')) }));
    } finally { setSummarizing(null); }
  };

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-brand-400" />
        <h1 className="text-sm font-semibold text-rmpg-100">AI Analyst</h1>
        <span className="text-[10px] text-rmpg-500">Claude over your intel index</span>
      </div>

      <div className="flex gap-2">
        <div className="flex-1 flex items-center gap-2 bg-surface-raised border border-rmpg-700/50 rounded-sm px-3 py-2">
          <Search className="w-3.5 h-3.5 text-rmpg-500" />
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') ask(); }}
            placeholder="Ask anything about your records…"
            className="flex-1 bg-transparent text-[13px] text-rmpg-100 placeholder-rmpg-600 outline-none"
          />
        </div>
        <button type="button" onClick={() => ask()} disabled={asking || !question.trim()} className="toolbar-btn toolbar-btn-primary">
          {asking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Ask
        </button>
      </div>

      {!result && !asking && !error && (
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => ask(ex)}
              className="text-[11px] text-rmpg-400 border border-rmpg-700/50 rounded-sm px-2 py-1 hover:bg-rmpg-800/40">
              {ex}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 text-[12px] text-amber-400 bg-amber-900/15 border border-amber-700/30 rounded-sm p-3">
          <AlertTriangle className="w-4 h-4 mt-px shrink-0" /> <span>{error}</span>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="bg-surface-raised border border-rmpg-700/50 rounded-sm p-4">
            <div className="text-[10px] uppercase tracking-wide text-brand-400 mb-1">Answer</div>
            <p className="text-[13px] text-rmpg-100 whitespace-pre-wrap leading-relaxed">{result.answer}</p>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wide text-rmpg-500 mb-2">
              Sources {result.sources.length > 0 && `(${result.sources.length})`}
            </div>
            {result.sources.length === 0 && <div className="text-[11px] text-rmpg-600">No indexed records matched.</div>}
            <div className="space-y-1.5">
              {result.sources.map((s, i) => {
                const cited = result.citations.some((c) => c.type === s.type && c.id === s.id);
                return (
                  <div key={`${s.type}:${s.id}`} className={`border rounded-sm p-2 ${cited ? 'border-brand-600/50 bg-brand-900/10' : 'border-rmpg-800/60'}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-bold text-rmpg-500">[{i + 1}]</span>
                      <span className="text-[9px] uppercase text-rmpg-500">{s.type}</span>
                      <span className="text-[12px] font-semibold text-rmpg-100">{s.label}</span>
                      {cited && <span className="text-[8px] font-bold text-brand-400 ml-auto">CITED</span>}
                      {s.type === 'person' && (
                        <button type="button" onClick={() => summarize(s)} disabled={summarizing === s.id}
                          className="ml-auto text-[10px] text-brand-400 hover:text-brand-300 flex items-center gap-1">
                          {summarizing === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />} AI summary
                        </button>
                      )}
                    </div>
                    {s.snippet && <div className="text-[10px] text-rmpg-500 mt-0.5">{s.snippet}</div>}
                    {summaries[s.id] && (
                      <div className="text-[11px] text-rmpg-300 mt-2 pl-4 border-l-2 border-brand-700/50 whitespace-pre-wrap">
                        {summaries[s.id]}
                      </div>
                    )}
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
