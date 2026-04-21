import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Play, Square, ExternalLink, ChevronDown, ChevronRight, Search } from 'lucide-react';
import catalogData from './originalCatalog.json';

type CatalogEntry = {
  className: string;
  title: string;
  description: string;
  install: string[];
  run: string[];
  projectUrl?: string;
};

const CATALOG = catalogData as Record<string, CatalogEntry[]>;

export default function FullCatalog({ categorySlug }: { categorySlug: string }) {
  const tools = CATALOG[categorySlug] || [];
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [output, setOutput] = useState<Record<string, Array<{ kind: 'stdout' | 'stderr' | 'meta'; text: string }>>>({});
  const [running, setRunning] = useState<string | null>(null); // className of currently-running tool
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const runningRef = useRef<string | null>(null);
  const outputRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const api = (typeof window !== 'undefined' ? (window as any).electron : null) as any;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tools;
    return tools.filter((t) =>
      t.title.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.className.toLowerCase().includes(q)
    );
  }, [tools, query]);

  useEffect(() => {
    if (!api?.onReconToolData) return;
    const unsubData = api.onReconToolData((id: string, kind: 'stdout' | 'stderr', data: string) => {
      if (id !== sessionIdRef.current || !runningRef.current) return;
      const cn = runningRef.current;
      setOutput((prev) => ({ ...prev, [cn]: [...(prev[cn] || []), { kind, text: data }] }));
    });
    const unsubExit = api.onReconToolExit?.((id: string, code: number) => {
      if (id !== sessionIdRef.current || !runningRef.current) return;
      const cn = runningRef.current;
      setOutput((prev) => ({ ...prev, [cn]: [...(prev[cn] || []), { kind: 'meta', text: `\n[exited with code ${code}]\n` }] }));
      setRunning(null);
      runningRef.current = null;
      sessionIdRef.current = null;
      setSessionId(null);
    });
    return () => { try { unsubData?.(); unsubExit?.(); } catch { /* ignore */ } };
  }, []);

  useEffect(() => {
    if (!running) return;
    const el = outputRefs.current[running];
    if (el) el.scrollTop = el.scrollHeight;
  }, [output, running]);

  const run = async (tool: CatalogEntry, kind: 'install' | 'run', index: number) => {
    if (!api?.reconCatalogRun) return;
    if (running) return; // one at a time
    setExpanded(tool.className);
    setOutput((prev) => ({ ...prev, [tool.className]: [] }));
    setRunning(tool.className);
    runningRef.current = tool.className;
    const res = await api.reconCatalogRun({ category: categorySlug, className: tool.className, kind, index });
    if (!res?.ok) {
      setOutput((prev) => ({ ...prev, [tool.className]: [{ kind: 'stderr', text: res?.error || 'Failed to start.' }] }));
      setRunning(null);
      runningRef.current = null;
      return;
    }
    sessionIdRef.current = res.sessionId;
    setSessionId(res.sessionId);
  };

  const stop = async () => {
    if (sessionId && api?.reconToolKill) await api.reconToolKill(sessionId);
    setRunning(null);
    runningRef.current = null;
    sessionIdRef.current = null;
    setSessionId(null);
  };

  if (tools.length === 0) return null;

  return (
    <div className="bg-[#141414] border border-[#222]">
      <div className="px-3 py-2 border-b border-[#222] flex items-center gap-2">
        <Search className="w-3.5 h-3.5 text-[#d4a017]" />
        <div className="text-[9px] text-[#d4a017] uppercase tracking-wider font-semibold">
          Full Catalog — {tools.length} upstream tools
        </div>
        <input
          type="text"
          placeholder="Filter by name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="ml-auto bg-[#050505] border border-[#2e2e2e] text-[#d4d4d4] text-[11px] px-2 py-0.5 w-48 focus:border-[#d4a017] outline-none"
        />
      </div>
      <div className="divide-y divide-[#1a1a1a]">
        {filtered.map((tool) => {
          const isOpen = expanded === tool.className;
          const lines = output[tool.className] || [];
          const isRunning = running === tool.className;
          return (
            <div key={tool.className} className="px-3 py-2">
              <button
                onClick={() => setExpanded(isOpen ? null : tool.className)}
                className="w-full flex items-start gap-2 text-left hover:bg-[#1a1a1a] py-1 -mx-1 px-1"
              >
                {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-[#888] shrink-0 mt-0.5" /> : <ChevronRight className="w-3.5 h-3.5 text-[#888] shrink-0 mt-0.5" />}
                <div className="flex-1 min-w-0">
                  <div className="text-[#d4d4d4] text-xs font-semibold">{tool.title}</div>
                  <div className="text-[#888] text-[10px] leading-snug line-clamp-2">{tool.description}</div>
                </div>
                {isRunning && <span className="text-[9px] font-mono text-[#7fd38a] uppercase tracking-wider border border-[#2e7d32] px-1.5 py-0.5">RUNNING</span>}
              </button>
              {isOpen && (
                <div className="mt-2 space-y-2 pl-5">
                  <div className="flex flex-wrap gap-1.5">
                    {tool.install.map((cmd, i) => (
                      <button
                        key={`i${i}`}
                        onClick={() => run(tool, 'install', i)}
                        disabled={Boolean(running)}
                        title={cmd}
                        className="px-2 py-1 bg-[#1a1a1a] border border-[#2e2e2e] text-[#d4a017] text-[10px] hover:bg-[#242424] disabled:opacity-40 flex items-center gap-1 font-mono max-w-full truncate"
                      >
                        <Download className="w-3 h-3 shrink-0" /> Install {tool.install.length > 1 ? `[${i + 1}]` : ''}
                      </button>
                    ))}
                    {tool.run.map((cmd, i) => (
                      <button
                        key={`r${i}`}
                        onClick={() => run(tool, 'run', i)}
                        disabled={Boolean(running)}
                        title={cmd}
                        className="px-2 py-1 bg-[#d4a017] text-black text-[10px] font-semibold hover:bg-[#e5b128] disabled:opacity-40 flex items-center gap-1"
                      >
                        <Play className="w-3 h-3" /> Run {tool.run.length > 1 ? `[${i + 1}]` : ''}
                      </button>
                    ))}
                    {isRunning && (
                      <button
                        onClick={stop}
                        className="px-2 py-1 bg-[#1a1a1a] border border-[#b33] text-[#ff8888] text-[10px] hover:bg-[#2a1414] flex items-center gap-1"
                      >
                        <Square className="w-3 h-3" /> Stop
                      </button>
                    )}
                    {tool.projectUrl && (
                      <a
                        href={tool.projectUrl}
                        target="_blank" rel="noreferrer"
                        className="px-2 py-1 text-[#888] text-[10px] hover:text-[#d4a017] flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" /> Project
                      </a>
                    )}
                  </div>
                  {(lines.length > 0 || isRunning) && (
                    <div
                      ref={(el) => { outputRefs.current[tool.className] = el; }}
                      className="bg-[#050505] border border-[#1a1a1a] max-h-64 overflow-auto p-2 font-mono text-[10px] text-[#d4d4d4] whitespace-pre-wrap"
                    >
                      {lines.map((line, i) => (
                        <span key={i} className={
                          line.kind === 'stderr' ? 'text-[#ff8888]' :
                          line.kind === 'meta'   ? 'text-[#d4a017]' :
                                                   'text-[#d4d4d4]'
                        }>{line.text}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
