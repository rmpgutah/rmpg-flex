import { useEffect, useState } from 'react';
import { CheckCircle2, Package, Clock } from 'lucide-react';

// Common binaries across all native tool cards — probe once on mount
const TRACKED_BINARIES = [
  'nmap', 'nikto', 'searchsploit', 'httpx', 'sqlmap', 'gobuster',
  'sslscan', 'testssl', 'wpscan', 'wafw00f', 'subfinder', 'nuclei',
  'ffuf', 'masscan', 'naabu',
  'sherlock', 'theHarvester', 'holehe',
  'hashid', 'john', 'crunch', 'cewl',
  'exiftool', 'binwalk', 'radare2', 'apktool',
  'aws', 'trivy',
];

export default function InstallDashboard() {
  const api = (typeof window !== 'undefined' ? (window as any).electron : null) as any;
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const [recent, setRecent] = useState<Array<{ toolId: string; ts: number; args: Record<string, string>; exit: number | null }>>([]);

  useEffect(() => {
    if (!api?.reconCheckBinary) return;
    (async () => {
      const result: Record<string, boolean> = {};
      await Promise.all(TRACKED_BINARIES.map(async (b) => {
        try {
          const r = await api.reconCheckBinary(b);
          result[b] = Boolean(r?.installed);
          localStorage.setItem(`rmpg:recon:installed:${b}`, r?.installed ? '1' : '0');
        } catch { result[b] = false; }
      }));
      setInstalled(result);
    })();
  }, []);

  useEffect(() => {
    // Scan localStorage for recon history entries, take the 5 most recent across all tools
    const all: Array<{ toolId: string; ts: number; args: Record<string, string>; exit: number | null }> = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('rmpg:recon:history:')) continue;
      const toolId = key.slice('rmpg:recon:history:'.length);
      try {
        const entries = JSON.parse(localStorage.getItem(key) || '[]');
        for (const e of entries) all.push({ toolId, ...e });
      } catch { /* corrupt entry */ }
    }
    all.sort((a, b) => b.ts - a.ts);
    setRecent(all.slice(0, 5));
  }, []);

  const count = Object.values(installed).filter(Boolean).length;
  const total = TRACKED_BINARIES.length;
  const pct = total ? Math.round((count / total) * 100) : 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div className="bg-[#141414] border border-[#222]">
        <div className="px-3 py-2 border-b border-[#222] flex items-center gap-2">
          <Package className="w-3.5 h-3.5 text-[#d4a017]" />
          <div className="text-[9px] text-[#d4a017] uppercase tracking-wider font-semibold flex-1">
            Installed Tools
          </div>
          <div className="text-[#888] text-[10px] font-mono">{count} / {total}</div>
        </div>
        <div className="p-3 space-y-2">
          <div className="h-1 bg-[#050505] overflow-hidden">
            <div className="h-full bg-[#d4a017] transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex flex-wrap gap-1">
            {TRACKED_BINARIES.map((b) => (
              <span
                key={b}
                className={`text-[9px] font-mono px-1.5 py-0.5 border ${
                  installed[b] ? 'text-[#7fd38a] border-[#2e7d32]/50' : 'text-[#555] border-[#2e2e2e]'
                }`}
                title={installed[b] ? 'Installed' : 'Not installed'}
              >
                {installed[b] && <CheckCircle2 className="w-2 h-2 inline mr-0.5" />}
                {b}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-[#141414] border border-[#222]">
        <div className="px-3 py-2 border-b border-[#222] flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-[#d4a017]" />
          <div className="text-[9px] text-[#d4a017] uppercase tracking-wider font-semibold">
            Recent Runs
          </div>
        </div>
        <div className="p-2 divide-y divide-[#1a1a1a]">
          {recent.length === 0 ? (
            <div className="text-[#555] text-[11px] px-2 py-2">No runs yet — click a tool to get started.</div>
          ) : (
            recent.map((r, i) => (
              <div key={i} className="px-2 py-1.5 text-[10px] font-mono flex items-baseline gap-2">
                <span className={r.exit === 0 ? 'text-[#7fd38a]' : 'text-[#ff8888]'}>
                  {r.exit === 0 ? '✓' : '✗'}
                </span>
                <span className="text-[#d4a017]">{r.toolId}</span>
                {Object.values(r.args).filter(Boolean).slice(0, 1).map((v, j) => (
                  <span key={j} className="text-[#d4d4d4] truncate flex-1">{v}</span>
                ))}
                <span className="text-[#888] shrink-0">{timeAgo(r.ts)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
