// "Ask Flex" — question → cited answer from the RMPG documentation knowledge
// base (/api/knowledge). Mounted as the "Docs & SOPs" mode of KnowledgeBasePage;
// self-contained so the audited records-search page stays untouched apart from
// the mode toggle.

import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Loader2, Send, X, ChevronDown, ChevronRight, AlertTriangle, Globe, ExternalLink } from 'lucide-react';
import { askFlexDocs, docTitle, MAX_QUESTION_CHARS, type AskResponse, type WebMode } from '../utils/flexDocs';

interface Turn {
  id: number;
  question: string;
  response?: AskResponse;
  error?: string;
}

const SUGGESTIONS = [
  'How do I escape Flex Kiosk Mode?',
  'Who can authorize a redaction of dashcam evidence?',
  'What does Utah Rule of Civil Procedure 4 say about the time limit for service?',
  'How do I create a serve receipt in ServeManager?',
];

const WEB_MODES: Array<{ id: WebMode; label: string; hint: string }> = [
  { id: 'auto', label: 'Docs + Web (auto)', hint: 'RMPG docs first; searches the web when the question looks external or the docs are thin' },
  { id: 'off', label: 'Docs only', hint: 'Only indexed RMPG documents' },
  { id: 'on', label: 'Always web', hint: 'Always search the live web as well and cite both' },
];

export default function FlexDocsPanel({ autoFocus = true }: { autoFocus?: boolean }) {
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [openSources, setOpenSources] = useState<Record<number, boolean>>({});
  const [webMode, setWebMode] = useState<WebMode>(() => {
    try { const v = localStorage.getItem('flex_docs_web_mode'); return v === 'off' || v === 'on' ? v : 'auto'; } catch { return 'auto'; }
  });
  useEffect(() => { try { localStorage.setItem('flex_docs_web_mode', webMode); } catch { /* private mode */ } }, [webMode]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [turns.length, busy]);

  const ask = useCallback(async (q: string) => {
    const text = q.trim();
    if (!text || busy) return;
    const id = nextId.current++;
    setTurns((t) => [...t, { id, question: text }]);
    setQuestion('');
    setBusy(true);
    try {
      const res = await askFlexDocs(text, { web: webMode });
      if (res.skipped) {
        setTurns((t) => t.map((x) => (x.id === id ? { ...x, error: 'The documentation search is not configured on this server yet (FLEX_SEARCH binding missing).' } : x)));
      } else {
        setTurns((t) => t.map((x) => (x.id === id ? { ...x, response: res } : x)));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Request failed';
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, error: msg } : x)));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }, [busy, webMode]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(question); }
    if (e.key === 'Escape') { e.stopPropagation(); setQuestion(''); }
  };

  return (
    <div className="space-y-3" data-testid="flex-docs-panel">
      {/* Composer */}
      <div
        className="flex items-start gap-3 px-3 py-2.5 bg-surface-raised border border-rmpg-600"
        style={{ borderTop: '2px solid var(--brand-500)', borderRadius: 2 }}
      >
        {busy ? <Loader2 className="w-5 h-5 text-fg-secondary animate-spin shrink-0 mt-0.5" /> : <BookOpen className="w-5 h-5 text-fg-secondary shrink-0 mt-0.5" />}
        <textarea
          ref={inputRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value.slice(0, MAX_QUESTION_CHARS))}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="Ask about an SOP, procedure, form, kiosk issue, court rule… (Enter to ask, Shift+Enter for a new line)"
          aria-label="Ask the RMPG documentation knowledge base"
          className="flex-1 bg-transparent text-sm text-rmpg-100 placeholder-fg-muted outline-none resize-none leading-relaxed"
        />
        {question && (
          <button type="button" onClick={() => setQuestion('')} className="text-fg-muted hover:text-rmpg-100 shrink-0" aria-label="Clear"><X className="w-4 h-4" /></button>
        )}
        <button
          type="button"
          onClick={() => void ask(question)}
          disabled={!question.trim() || busy}
          className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide border text-rmpg-100 disabled:opacity-40 disabled:cursor-not-allowed hover:border-brand-500 transition-colors shrink-0"
          style={{ borderRadius: 2, borderColor: 'var(--border-default)' }}
          aria-label="Ask"
        >
          <Send className="w-3.5 h-3.5" /> Ask
        </button>
      </div>

      {/* Web mode */}
      <div className="flex flex-wrap items-center gap-1.5 px-1" role="radiogroup" aria-label="Answer sources">
        <Globe className="w-3.5 h-3.5 text-fg-muted" />
        {WEB_MODES.map((m) => {
          const active = webMode === m.id;
          return (
            <button
              key={m.id} type="button" role="radio" aria-checked={active} title={m.hint} onClick={() => setWebMode(m.id)}
              className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide border"
              style={{
                borderRadius: 2,
                color: active ? 'var(--surface-base)' : 'var(--text-secondary)',
                background: active ? 'var(--brand-500)' : 'transparent',
                borderColor: active ? 'var(--brand-500)' : 'var(--border-default)',
              }}
            >{m.label}</button>
          );
        })}
      </div>

      {/* Empty state */}
      {turns.length === 0 && (
        <div className="px-1 space-y-2">
          <p className="text-[11px] text-fg-muted">
            Answers draw on indexed RMPG documents — SOPs, runbooks, guides, forms, engineering specs — and, when useful, live web sources.
            Every claim is tagged [I#] (internal) or [W#] (web). For calls, persons, warrants and other records, switch to <span className="text-fg-secondary">Records</span>.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s} type="button" onClick={() => void ask(s)}
                className="px-2 py-0.5 text-[10px] border text-fg-secondary hover:text-rmpg-100 hover:border-brand-500 transition-colors"
                style={{ borderRadius: 2, borderColor: 'var(--border-default)' }}
              >{s}</button>
            ))}
          </div>
        </div>
      )}

      {/* Turns */}
      <div className="space-y-3">
        {turns.map((t) => (
          <div key={t.id} className="border border-rmpg-700 bg-surface-raised" style={{ borderRadius: 2 }}>
            <div className="px-3 py-2 border-b border-rmpg-700">
              <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--field-label-color)' }}>Question</div>
              <div className="text-sm text-rmpg-100 whitespace-pre-wrap">{t.question}</div>
            </div>
            <div className="px-3 py-2">
              {!t.response && !t.error && (
                <div className="flex items-center gap-2 text-[11px] text-fg-muted"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching RMPG documents…</div>
              )}
              {t.error && (
                <div className="flex items-start gap-2 text-[12px]" style={{ color: 'var(--sev-warn)' }}>
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{t.error}</span>
                </div>
              )}
              {t.response && (
                <>
                  <div className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--field-label-color)' }}>Answer</div>
                  <div className="text-sm text-rmpg-100 whitespace-pre-wrap leading-relaxed">{t.response.answer || 'No answer was generated.'}</div>
                  {t.response.citations.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] uppercase tracking-wide text-fg-muted">Sources</span>
                      {t.response.citations.map((c) => (
                        <span
                          key={c.key}
                          className="px-2 py-0.5 text-[10px] border text-fg-secondary"
                          style={{ borderRadius: 2, borderColor: 'var(--border-default)' }}
                          title={c.key}
                        >{docTitle(c.source)}</span>
                      ))}
                    </div>
                  )}
                  {(t.response.web?.length ?? 0) > 0 && (
                    <div className="mt-2 space-y-1">
                      <span className="text-[10px] uppercase tracking-wide text-fg-muted">Web sources</span>
                      {t.response.web!.map((w) => (
                        <a
                          key={w.tag} href={w.url} target="_blank" rel="noopener noreferrer"
                          className="flex items-start gap-1.5 text-[11px] text-fg-secondary hover:text-brand-400"
                          title={w.snippet}
                        >
                          <span className="font-mono text-[10px] text-fg-muted shrink-0 mt-px">[{w.tag}]</span>
                          <span className="truncate">{w.title || w.url}</span>
                          <ExternalLink className="w-3 h-3 shrink-0 mt-0.5" />
                        </a>
                      ))}
                    </div>
                  )}
                  {t.response.mode === 'docs+web-unavailable' && (
                    <div className="mt-1 text-[10px] text-fg-muted">Web search returned no usable sources for this question; answer is from RMPG documents only.</div>
                  )}
                  {t.response.results.length > 0 && (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => setOpenSources((o) => ({ ...o, [t.id]: !o[t.id] }))}
                        className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-fg-muted hover:text-fg-secondary"
                        aria-expanded={!!openSources[t.id]}
                      >
                        {openSources[t.id] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        {t.response.results.length} source passage{t.response.results.length === 1 ? '' : 's'}
                      </button>
                      {openSources[t.id] && (
                        <div className="mt-1.5 space-y-1.5">
                          {t.response.results.slice(0, 8).map((r, i) => (
                            <div key={`${r.key}-${i}`} className="px-2 py-1.5 border border-rmpg-700 text-[11px] text-fg-secondary whitespace-pre-wrap" style={{ borderRadius: 2 }}>
                              <div className="text-[10px] text-fg-muted mb-0.5">{docTitle(r.source)} · {(r.score * 100).toFixed(0)}%</div>
                              {r.text.length > 900 ? `${r.text.slice(0, 900)}…` : r.text}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
