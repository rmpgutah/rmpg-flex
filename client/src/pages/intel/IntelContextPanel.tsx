// Right docked panel. Renders whatever is selected in IntelContext, flipping
// between a compact Dossier Peek and an embedded Mini Graph. Collapsible.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { apiFetch } from '../../hooks/useApi';
import ConnectionsGraphPanel from '../../components/ConnectionsGraphPanel';
import { useIntelContext } from './IntelContext';
import { useWatchToggle } from './useWatchToggle';
import { formatEnumValue } from '../../utils/formatters';

const SENTINELS = new Set(['', 'none', 'n/a', 'na', 'null', '0', 'unknown']);
const real = (v: unknown) => v != null && !SENTINELS.has(String(v).trim().toLowerCase());

// Defined outside the parent component so React sees a stable identity across renders.
// Previously defined inside an IIFE in render, which caused remount on every parent
// re-render and prevented useWatchToggle's internal state from persisting.
function WatchBtn({ personId, initialWatched }: { personId: number; initialWatched: boolean }) {
  const { watched, toggle } = useWatchToggle('person', personId, initialWatched);
  return (
    <button onClick={toggle}
      className={`flex-1 text-center font-mono text-[8px] tracking-wide border rounded-[2px] py-[6px] uppercase ${watched ? 'border-brand-400 text-brand-300' : 'border-border-subtle text-fg-muted'}`}>
      {watched ? '★ Watching' : '☆ Watch'}
    </button>
  );
}

interface DossierLite {
  person: { id: number; first_name?: string; middle_name?: string; last_name?: string };
  flags?: string[];
  escalation?: { recent: number; baseline: number; ratio: number; trend: string } | null;
  timeline?: Array<{ kind: string; label?: string; description?: string; date?: string }>;
  associates?: Array<{ person_id: number; name: string; shared_events: number; kinds: string[] }>;
  watched?: boolean;
}

export default function IntelContextPanel() {
  const { selected, selectEntity, panelMode, setPanelMode, panelCollapsed, togglePanel } = useIntelContext();
  const [dossier, setDossier] = useState<DossierLite | null>(null);
  const [loading, setLoading] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!selected || selected.type !== 'person' || panelMode !== 'dossier') { setDossier(null); return; }
    let cancelled = false;
    setLoading(true); setDossier(null); setAiSummary(null);
    const ctrl = new AbortController();
    apiFetch<DossierLite>(`/intel/dossier/person/${selected.id}`, { signal: ctrl.signal })
      .then((d) => { if (!cancelled) setDossier(d); })
      .catch(() => { if (!cancelled) setDossier(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; ctrl.abort(); };
  }, [selected, panelMode]);

  // Claude summary of the loaded dossier. Sends the sections the panel already
  // has; degrades to an inline notice if AI isn't configured / has no credit.
  const summarizeDossier = async (label: string) => {
    if (!dossier) return;
    setAiBusy(true); setAiSummary(null);
    try {
      const sections = {
        flags: dossier.flags || [],
        timeline: dossier.timeline || [],
        associates: dossier.associates || [],
      };
      const res = await apiFetch<{ summary?: string; error?: string }>('/intel/ai/summarize', {
        method: 'POST', body: JSON.stringify({ label, sections }),
      });
      setAiSummary(res?.summary || res?.error || 'No summary returned.');
    } catch (e: any) {
      const s = `${e?.code ?? ''} ${e?.message ?? ''}`;
      setAiSummary(/NO_AI_KEY|not configured/i.test(s) ? 'AI not configured (set the Anthropic key in Admin).' : (e?.message || 'AI summary failed.'));
    } finally { setAiBusy(false); }
  };

  if (panelCollapsed) {
    return (
      <aside className="w-[24px] bg-surface-overlay border-l border-border-default flex items-start justify-center pt-2">
        <button aria-label="Expand context panel" onClick={togglePanel} className="text-fg-muted text-[12px]">⟩</button>
      </aside>
    );
  }

  return (
    <aside className="w-[264px] bg-surface-overlay border-l border-border-default flex flex-col">
      <div className="flex items-center px-[11px] py-[8px] border-b border-border-default">
        <span className="font-mono text-[9px] tracking-widest text-fg-muted uppercase">◈ Context</span>
        {selected && (
          <div className="ml-2 flex gap-1">
            <button onClick={() => setPanelMode('dossier')}
              className={`text-[8px] font-mono px-[5px] py-[1px] rounded-[2px] border ${panelMode === 'dossier' ? 'border-brand-400 text-brand-300' : 'border-border-default text-rmpg-400'}`}>DOSSIER</button>
            <button onClick={() => setPanelMode('graph')}
              className={`text-[8px] font-mono px-[5px] py-[1px] rounded-[2px] border ${panelMode === 'graph' ? 'border-brand-400 text-brand-300' : 'border-border-default text-rmpg-400'}`}>GRAPH</button>
          </div>
        )}
        <button aria-label="Collapse context panel" onClick={togglePanel} className="ml-auto text-rmpg-500 text-[12px]">⟨</button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-[11px] py-[12px]">
        {!selected && <div className="text-[10px] text-rmpg-500">Select an entity from any list to peek its dossier.</div>}

        {selected && panelMode === 'graph' && (
          <ConnectionsGraphPanel personId={selected.id} personName={selected.label} />
        )}

        {selected && panelMode === 'dossier' && (
          <>
            {loading && <div className="text-[10px] text-rmpg-400">Loading dossier…</div>}
            {dossier && (() => {
              const p = dossier.person;
              const name = [p.first_name, p.middle_name, p.last_name].filter(real).join(' ') || selected.label;
                return (
                <div className="space-y-3">
                  <div>
                    <div className="text-[13px] text-rmpg-100 font-bold">{name}</div>
                    <div className="flex gap-1 flex-wrap mt-[6px]">
                      {(dossier.flags || []).map((f) => (
                        <span key={f} className="font-mono text-[8px] px-[5px] py-[1px] rounded-[2px] bg-red-950/80 text-red-400">{f}</span>
                      ))}
                    </div>
                  </div>

                  {dossier.escalation && (
                    <div className="border border-amber-900/50 bg-surface-sunken rounded-[2px] px-[10px] py-[8px]">
                      <div className="text-[8px] text-[color:var(--field-label-color)] uppercase tracking-wider">Escalation Index</div>
                      <div className="font-mono text-[16px] text-amber-300 font-bold">
                        {Number(dossier.escalation.ratio || 0).toFixed(1)}
                        <span className="text-[9px] text-amber-700 ml-1">{dossier.escalation.trend}</span>
                      </div>
                      <div className="text-[9px] text-rmpg-400">{dossier.escalation.recent} recent vs {dossier.escalation.baseline} baseline</div>
                    </div>
                  )}

                  {(dossier.timeline || []).length > 0 && (
                    <div>
                      <div className="font-mono text-[8px] tracking-widest text-rmpg-500 uppercase mb-[6px]">Recent Timeline</div>
                      {(dossier.timeline || []).slice(0, 5).map((t, i) => (
                        <div key={i} className="flex gap-[7px] py-[3px]">
                          <span className="w-[6px] h-[6px] rounded-full bg-brand-600 mt-[3px] shrink-0" />
                          <div>
                            <div className="text-[10px] text-rmpg-300"><b className="text-rmpg-200">{formatEnumValue(t.kind)}</b> {t.label || t.description || ''}</div>
                            <div className="font-mono text-[8px] text-rmpg-500">{t.date || ''}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div>
                    <button onClick={() => summarizeDossier(name)} disabled={aiBusy}
                      className="w-full text-center font-mono text-[8px] tracking-wide text-purple-400 border border-purple-900/50 rounded-[2px] py-[6px] uppercase disabled:opacity-50">
                      {aiBusy ? 'Summarizing…' : '✨ AI Summary'}
                    </button>
                    {aiSummary && (
                      <div className="mt-[6px] text-[10px] text-rmpg-200 leading-relaxed whitespace-pre-wrap border-l-2 border-purple-900/50 pl-2">
                        {aiSummary}
                      </div>
                    )}
                  </div>

                  {(dossier.associates || []).length > 0 && (
                    <div>
                      <div className="font-mono text-[8px] tracking-widest text-rmpg-500 uppercase mb-[6px]">Associates</div>
                      {(dossier.associates || []).slice(0, 8).map((a) => (
                        <button key={a.person_id}
                          onClick={() => selectEntity('person', a.person_id, a.name)}
                          className="w-full text-left flex items-center gap-2 py-[3px] hover:bg-surface-sunken rounded-[2px] px-1">
                          <span className="w-[6px] h-[6px] rounded-full bg-cyan-400 mt-[1px] shrink-0" />
                          <span className="text-[10px] text-rmpg-200 min-w-0 flex-1 truncate">{a.name}</span>
                          <span className="font-mono text-[8px] text-rmpg-500">{a.shared_events} shared</span>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-[6px] pt-1">
                    <WatchBtn personId={p.id} initialWatched={!!dossier.watched} />
                    <button onClick={() => setPanelMode('graph')} className="flex-1 text-center font-mono text-[8px] tracking-wide text-rmpg-200 border border-border-subtle rounded-[2px] py-[6px] uppercase">Graph</button>
                  </div>
                  <div className="flex gap-[6px]">
                    <Link to={`/intel/person/${p.id}`} className="flex-1 text-center font-mono text-[8px] tracking-wide text-rmpg-200 border border-border-subtle rounded-[2px] py-[6px] uppercase">Full Dossier</Link>
                    <button onClick={() => navigate(`/intel/reports/new?from=person:${p.id}&label=${encodeURIComponent(name)}`)}
                      className="flex-1 text-center font-mono text-[8px] tracking-wide text-cyan-400 border border-cyan-900/50 rounded-[2px] py-[6px] uppercase">+ Report</button>
                  </div>
                </div>
              );
            })()}
            {!loading && !dossier && <div className="text-[10px] text-rmpg-500">No dossier for this entity.</div>}
          </>
        )}
      </div>
    </aside>
  );
}
