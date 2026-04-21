import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Square, Download, CheckCircle2, AlertCircle, Save, History, X } from 'lucide-react';

export type ToolArg = { name: string; label: string; placeholder?: string; required?: boolean };
export type ToolDef = {
  id: string;
  icon: any;
  title: string;
  description: string;
  requiresAuthorization?: string;
  args?: ToolArg[];
  runLabel?: string;
  /** Homebrew package to offer a one-click install for, if the binary is missing */
  installPkg?: string;
  /** Primary binary to check for install status. Defaults to installPkg. */
  checkBinary?: string;
};

// Common exit-code interpretations and stderr patterns → friendly messages
function diagnose(output: Array<{ kind: string; text: string }>, code: number | null): string | null {
  const stderr = output.filter((l) => l.kind === 'stderr').map((l) => l.text).join('');
  const all = output.map((l) => l.text).join('').toLowerCase();

  if (/command not found|no such file or directory|enoent/i.test(stderr)) {
    return 'Tool binary not found in PATH. Click Install to add it.';
  }
  if (/permission denied/i.test(stderr)) {
    return 'Permission denied — this operation requires elevated privileges that cannot be prompted from inside the app. Run the command in Terminal if truly needed.';
  }
  if (/modulenotfounderror|no module named/i.test(stderr)) {
    const m = stderr.match(/no module named ['"]?([a-zA-Z0-9_.-]+)['"]?/i);
    return m ? `Python module "${m[1]}" missing. Try: pip3 install ${m[1]}` : 'Python module missing.';
  }
  if (/connection refused|could not resolve|name or service not known/i.test(all)) {
    return 'Target unreachable — check the URL/host and network connectivity.';
  }
  if (/sslerror|certificate verify failed/i.test(all)) {
    return 'TLS verification failed. Target may have an invalid certificate.';
  }
  if (code === 2) return 'Exit 2 usually means a file path or argument is wrong.';
  if (code === 126) return 'Exit 126: command found but not executable.';
  if (code === 127) return 'Exit 127: command not found.';
  if (code === 130) return 'Stopped (Ctrl+C / SIGINT).';
  if (code === 139) return 'Segmentation fault — the tool crashed.';
  return null;
}

export default function ToolCard({ tool, disabled }: { tool: ToolDef; disabled: boolean }) {
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [output, setOutput] = useState<Array<{ kind: 'stdout' | 'stderr' | 'meta'; text: string }>>([]);
  const [running, setRunning] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [installed, setInstalled] = useState<boolean | null>(null); // null=unknown, true/false=probed
  const [lastExit, setLastExit] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<Array<{ ts: number; args: Record<string, string>; exit: number | null; preview: string }>>(
    () => {
      try { return JSON.parse(localStorage.getItem(`rmpg:recon:history:${tool.id}`) || '[]'); }
      catch { return []; }
    }
  );
  const targetHistory = useMemo(() => {
    const byArg: Record<string, string[]> = {};
    for (const h of history) {
      for (const [name, val] of Object.entries(h.args || {})) {
        if (!val) continue;
        byArg[name] = byArg[name] || [];
        if (!byArg[name].includes(val)) byArg[name].push(val);
      }
    }
    return byArg;
  }, [history]);
  const sessionIdRef = useRef<string | null>(null);
  const outputRef = useRef<HTMLDivElement | null>(null);
  const api = (typeof window !== 'undefined' ? (window as any).electron : null) as any;

  const binaryName = tool.checkBinary || tool.installPkg;

  // Probe install state on mount + cache to localStorage so the badge is
  // instant on revisit. "Unknown" (null) only on the very first load.
  useEffect(() => {
    if (!binaryName || !api?.reconCheckBinary) {
      setInstalled(true); // no binary to check = built-in (curl, dig, etc.)
      return;
    }
    const cacheKey = `rmpg:recon:installed:${binaryName}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached !== null) setInstalled(cached === '1');
    (async () => {
      const res = await api.reconCheckBinary(binaryName);
      const is = Boolean(res?.installed);
      setInstalled(is);
      localStorage.setItem(cacheKey, is ? '1' : '0');
    })();
  }, [binaryName]);

  useEffect(() => {
    if (!api?.onReconToolData) return;
    const unsubData = api.onReconToolData((id: string, kind: 'stdout' | 'stderr', data: string) => {
      if (id !== sessionIdRef.current) return;
      setOutput((prev) => [...prev, { kind, text: data }]);
    });
    const unsubExit = api.onReconToolExit?.((id: string, code: number) => {
      if (id !== sessionIdRef.current) return;
      setLastExit(code);
      setOutput((prev) => {
        const final = [...prev, { kind: 'meta' as const, text: `\n[exited with code ${code}]\n` }];
        // Persist this run to history (keep last 20)
        try {
          const preview = final.map((l) => l.text).join('').slice(0, 500);
          const entry = { ts: Date.now(), args: { ...formValues }, exit: code, preview };
          const existing = JSON.parse(localStorage.getItem(`rmpg:recon:history:${tool.id}`) || '[]');
          const next = [entry, ...existing].slice(0, 20);
          localStorage.setItem(`rmpg:recon:history:${tool.id}`, JSON.stringify(next));
          setHistory(next);
        } catch { /* quota */ }
        return final;
      });
      setRunning(false);
      sessionIdRef.current = null;
      setSessionId(null);
      if (binaryName && api?.reconCheckBinary) {
        api.reconCheckBinary(binaryName).then((r: any) => {
          const is = Boolean(r?.installed);
          setInstalled(is);
          localStorage.setItem(`rmpg:recon:installed:${binaryName}`, is ? '1' : '0');
        });
      }
    });
    return () => { try { unsubData?.(); unsubExit?.(); } catch { /* ignore */ } };
  }, []);

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [output]);

  const run = async () => {
    if (disabled || !api?.reconToolSpawn) return;
    const missing = (tool.args || []).filter((a) => a.required && !formValues[a.name]?.trim());
    if (missing.length) {
      setOutput([{ kind: 'meta', text: `Missing required: ${missing.map((m) => m.label).join(', ')}\n` }]);
      return;
    }
    // Pre-flight: skip the spawn if binary is known-missing
    if (installed === false && tool.installPkg) {
      setOutput([{ kind: 'stderr', text: `${binaryName || 'binary'} is not installed. Click "Install ${tool.installPkg}" below.` }]);
      setLastExit(null);
      return;
    }
    setOutput([]);
    setLastExit(null);
    setRunning(true);
    const res = await api.reconToolSpawn(tool.id, formValues);
    if (!res?.ok) {
      setOutput([{ kind: 'stderr', text: res?.error || 'Failed to start.' }]);
      setRunning(false);
      return;
    }
    sessionIdRef.current = res.sessionId;
    setSessionId(res.sessionId);
  };

  const stop = async () => {
    if (sessionId && api?.reconToolKill) await api.reconToolKill(sessionId);
    setRunning(false);
    sessionIdRef.current = null;
    setSessionId(null);
  };

  const installPkg = async () => {
    if (!tool.installPkg || !api?.reconToolInstall) return;
    setOutput([{ kind: 'meta', text: `Installing ${tool.installPkg} via Homebrew. This takes 1-5 min.\n` }]);
    setRunning(true);
    const res = await api.reconToolInstall(tool.installPkg);
    if (!res?.ok) {
      setOutput((prev) => [...prev, { kind: 'stderr', text: res?.error || 'Install failed.' }]);
      setRunning(false);
      return;
    }
    sessionIdRef.current = res.sessionId;
    setSessionId(res.sessionId);
  };

  // Show Install button whenever:
  //  - preflight found the binary missing, OR
  //  - runtime error says "not installed"
  const needsInstall = useMemo(() => {
    if (installed === false) return true;
    return output.some((line) =>
      line.kind === 'stderr' &&
      (line.text.includes('is not installed') || line.text.includes('Run: brew install') || line.text.includes('command not found'))
    );
  }, [installed, output]);

  const Icon = tool.icon;
  const diagnostic = !running && lastExit !== null && lastExit !== 0 ? diagnose(output, lastExit) : null;
  return (
    <div className="bg-[#141414] border border-[#222] flex flex-col">
      <div className="px-3 py-2 border-b border-[#222] flex items-center gap-2">
        <Icon className="w-4 h-4 text-[#d4a017]" />
        <div className="text-[#d4d4d4] text-xs font-semibold flex-1">{tool.title}</div>
        {binaryName && installed !== null && (
          <div className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 border flex items-center gap-1 ${
            installed ? 'text-[#7fd38a] border-[#2e7d32]' : 'text-[#d4a017] border-[#d4a017]/60'
          }`}>
            {installed ? <CheckCircle2 className="w-2.5 h-2.5" /> : <AlertCircle className="w-2.5 h-2.5" />}
            {installed ? 'INSTALLED' : 'NOT INSTALLED'}
          </div>
        )}
        <div className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 border ${
          running ? 'text-[#7fd38a] border-[#2e7d32]' : 'text-[#888] border-[#2e2e2e]'
        }`}>
          {running ? 'RUNNING' : 'IDLE'}
        </div>
      </div>
      <div className="p-3 space-y-2">
        <div className="text-[#888] text-[11px] leading-snug">{tool.description}</div>
        {tool.requiresAuthorization && (
          <div className="text-[#d4a017] text-[10px] border border-[#d4a017]/40 bg-[#d4a017]/5 px-2 py-1">
            ⚠ {tool.requiresAuthorization}
          </div>
        )}
        {tool.args?.map((arg) => {
          const listId = `rc-${tool.id}-${arg.name}-history`;
          const suggestions = targetHistory[arg.name] || [];
          return (
            <div key={arg.name} className="flex flex-col gap-1">
              <label className="text-[9px] text-[#888] uppercase tracking-wider">{arg.label}{arg.required && ' *'}</label>
              <input
                type="text"
                placeholder={arg.placeholder}
                list={suggestions.length > 0 ? listId : undefined}
                value={formValues[arg.name] || ''}
                onChange={(e) => setFormValues((f) => ({ ...f, [arg.name]: e.target.value }))}
                disabled={running}
                className="bg-[#050505] border border-[#2e2e2e] text-[#d4d4d4] text-[11px] font-mono px-2 py-1 focus:border-[#d4a017] outline-none disabled:opacity-50"
              />
              {suggestions.length > 0 && (
                <datalist id={listId}>
                  {suggestions.map((s) => <option key={s} value={s} />)}
                </datalist>
              )}
            </div>
          );
        })}
        <div className="flex gap-2">
          <button
            onClick={run}
            disabled={disabled || running}
            className="px-3 py-1.5 bg-[#d4a017] text-black text-xs font-semibold hover:bg-[#e5b128] disabled:opacity-40 flex items-center gap-1.5"
          >
            <Play className="w-3.5 h-3.5" /> {tool.runLabel || 'Run'}
          </button>
          <button
            onClick={stop}
            disabled={!running}
            className="px-3 py-1.5 bg-[#1a1a1a] border border-[#b33] text-[#ff8888] text-xs hover:bg-[#2a1414] disabled:opacity-40 flex items-center gap-1.5"
          >
            <Square className="w-3.5 h-3.5" /> Stop
          </button>
          {needsInstall && tool.installPkg && (
            <button
              onClick={installPkg}
              disabled={running}
              className="px-3 py-1.5 bg-[#1a1a1a] border border-[#d4a017] text-[#d4a017] text-xs hover:bg-[#242424] disabled:opacity-40 flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" /> Install {tool.installPkg}
            </button>
          )}
          {history.length > 0 && (
            <button
              onClick={() => setHistoryOpen((o) => !o)}
              className={`ml-auto px-2 py-1.5 text-[10px] flex items-center gap-1 ${historyOpen ? 'text-[#d4a017]' : 'text-[#888] hover:text-[#d4a017]'}`}
              title={`${history.length} past runs`}
            >
              <History className="w-3 h-3" /> History ({history.length})
            </button>
          )}
          {output.length > 0 && !running && (
            <button
              onClick={() => {
                const text = output.map((l) => l.text).join('');
                const argsSuffix = Object.values(formValues).filter(Boolean).join('_').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 40);
                const fname = `${tool.id}${argsSuffix ? '-' + argsSuffix : ''}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.txt`;
                const blob = new Blob([text], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = fname; a.click();
                setTimeout(() => URL.revokeObjectURL(url), 2000);
              }}
              className="px-2 py-1.5 text-[#888] text-[10px] hover:text-[#d4a017] flex items-center gap-1"
              title="Save output as .txt"
            >
              <Save className="w-3 h-3" /> Save
            </button>
          )}
          {output.length > 0 && (
            <button
              onClick={() => { setOutput([]); setLastExit(null); }}
              disabled={running}
              className="px-2 py-1.5 text-[#888] text-[10px] hover:text-[#d4a017] disabled:opacity-40"
            >
              Clear
            </button>
          )}
        </div>
        {historyOpen && (
          <div className="border border-[#2e2e2e] bg-[#0a0a0a] divide-y divide-[#1a1a1a] max-h-48 overflow-auto">
            {history.map((h, i) => (
              <div key={i} className="px-2 py-1.5 flex items-start gap-2 text-[10px]">
                <button
                  onClick={() => { setFormValues(h.args); setOutput([{ kind: 'stdout', text: h.preview }]); setHistoryOpen(false); }}
                  className="flex-1 text-left hover:text-[#d4a017] font-mono"
                >
                  <span className={h.exit === 0 ? 'text-[#7fd38a]' : 'text-[#ff8888]'}>
                    {h.exit === 0 ? '✓' : '✗'}
                  </span>
                  {' '}
                  <span className="text-[#888]">{new Date(h.ts).toLocaleString()}</span>
                  {Object.entries(h.args).filter(([, v]) => v).map(([k, v]) => (
                    <span key={k} className="text-[#d4d4d4] ml-2">{k}={v}</span>
                  ))}
                </button>
                <button
                  onClick={() => {
                    const next = history.filter((_, idx) => idx !== i);
                    localStorage.setItem(`rmpg:recon:history:${tool.id}`, JSON.stringify(next));
                    setHistory(next);
                  }}
                  className="text-[#555] hover:text-[#ff8888]"
                  title="Remove entry"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        {diagnostic && (
          <div className="border border-[#d4a017]/60 bg-[#d4a017]/10 text-[#d4a017] text-[11px] px-2 py-1.5 flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{diagnostic}</span>
          </div>
        )}
        <div
          ref={outputRef}
          className="bg-[#050505] border border-[#1a1a1a] h-56 overflow-auto p-2 font-mono text-[11px] text-[#d4d4d4] whitespace-pre-wrap"
        >
          {output.length === 0 ? (
            <span className="text-[#555]">(no output yet)</span>
          ) : (
            output.map((line, i) => (
              <span key={i} className={
                line.kind === 'stderr' ? 'text-[#ff8888]' :
                line.kind === 'meta'   ? 'text-[#d4a017]' :
                                         'text-[#d4d4d4]'
              }>{line.text}</span>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
