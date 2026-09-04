import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Terminal, Copy, CheckCircle2, ExternalLink, ShieldAlert, Search, Globe, Radio, Server, Cloud, Smartphone, Lock, Eye, Database, Wifi, Bug, FileSearch, Users, Zap, GitBranch, KeyRound, Play, Square, Download } from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import ConfirmDialog from '../components/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import GlobalCatalogSearch from './recon-connect/GlobalCatalogSearch';
import InstallDashboard from './recon-connect/InstallDashboard';

type Platform = 'linux' | 'macos' | 'windows' | 'unknown';
type UserRole = 'admin' | 'manager' | 'supervisor' | 'officer' | 'dispatcher' | 'contract_manager' | 'client_viewer' | 'human_resources' | 'investigator';

// `query` is typed into hackingtool's `/` search to filter to that category's
// tools. The upstream tool's tag keywords are the most reliable handle — see
// https://github.com/Z4nzu/hackingtool#tags
const CATEGORIES: Array<{ icon: React.ElementType; name: string; count: number; desc: string; query: string; route?: string }> = [
  { icon: Search,     name: 'OSINT',                count: 5, desc: 'WHOIS, DNS, sherlock, theHarvester, holehe',                query: 'osint',     route: '/recon-connect/c/osint' },
  { icon: Globe,      name: 'Web Recon',            count: 5, desc: 'Subfinder, HTTPX, nuclei, WAF detect, ffuf',                 query: 'web',       route: '/recon-connect/c/web-recon' },
  { icon: Wifi,       name: 'Network Scanning',     count: 5, desc: 'nmap quick/full, masscan, naabu, ARP',                       query: 'network',   route: '/recon-connect/c/network-scanning' },
  { icon: Lock,       name: 'Password Tools',       count: 4, desc: 'hashid, john, crunch, CeWL',                                 query: 'password',  route: '/recon-connect/c/password-tools' },
  { icon: Eye,        name: 'Wireless Attacks',     count: 5, desc: 'WiFi, Bluetooth, local net, port scan',                      query: 'wireless',  route: '/recon-connect/wireless' },
  { icon: Bug,        name: 'Exploitation',         count: 10, desc: 'CVE, searchsploit, nmap vuln, nikto, sqlmap, wpscan…',      query: 'exploit',   route: '/recon-connect/exploits' },
  { icon: Server,     name: 'Active Directory',     count: 3, desc: 'LDAP anon bind, SMB enum, DC SRV lookup',                    query: 'ad',        route: '/recon-connect/c/active-directory' },
  { icon: Cloud,      name: 'Cloud Security',       count: 2, desc: 'AWS identity, Trivy config scan',                            query: 'cloud',     route: '/recon-connect/c/cloud-security' },
  { icon: Smartphone, name: 'Mobile Security',      count: 2, desc: 'apktool decode, strings on APK',                             query: 'mobile',    route: '/recon-connect/c/mobile-security' },
  { icon: FileSearch, name: 'Forensics',            count: 4, desc: 'exiftool, binwalk, file, hexdump',                           query: 'forensics', route: '/recon-connect/c/forensics' },
  { icon: Radio,      name: 'Anonymity',            count: 2, desc: 'Public IP, Tor status',                                      query: 'anonymity', route: '/recon-connect/c/anonymity' },
  { icon: KeyRound,   name: 'Reverse Engineering',  count: 4, desc: 'objdump, radare2, strings, hexdump',                         query: 'reverse',   route: '/recon-connect/c/reverse-engineering' },
  { icon: Database,   name: 'SQL Injection',        count: 1, desc: 'SQLMap (non-intrusive probe)',                               query: 'sqli',      route: '/recon-connect/c/sql-injection' },
  { icon: Users,      name: 'Social Engineering',   count: 3, desc: 'MX, SPF/DMARC, WHOIS — defensive only',                      query: 'social',    route: '/recon-connect/c/social-engineering' },
  { icon: Zap,        name: 'DDoS / Stress',        count: 1, desc: 'Defensive uptime probe only — no attack tooling',            query: 'ddos',      route: '/recon-connect/c/ddos' },
  { icon: GitBranch,  name: 'Post-Exploitation',    count: 3, desc: 'Local-host audit only — no lateral movement tools',          query: 'post',      route: '/recon-connect/c/post-exploitation' },
];

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac')) return 'macos';
  if (ua.includes('win')) return 'windows';
  if (ua.includes('linux')) return 'linux';
  return 'unknown';
}

const INSTALL_COMMANDS: Record<Platform, string> = {
  linux:   'curl -sSL https://raw.githubusercontent.com/Z4nzu/hackingtool/master/install.sh | sudo bash',
  macos:   'brew install python git && git clone https://github.com/Z4nzu/hackingtool.git ~/recon-connect && cd ~/recon-connect && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt',
  windows: 'git clone https://github.com/Z4nzu/hackingtool.git %USERPROFILE%\\recon-connect && cd %USERPROFILE%\\recon-connect && python -m venv venv && venv\\Scripts\\activate && pip install -r requirements.txt',
  unknown: '# Unsupported platform — see README at https://github.com/Z4nzu/hackingtool',
};

// Who is allowed to see / launch Recon Connect from inside Flex.
const ALLOWED_ROLES: UserRole[] = ['admin', 'manager', 'supervisor', 'investigator', 'dispatcher', 'officer'];

function canAccessReconConnect(role: string | undefined): boolean {
  if (!role) return false;
  return ALLOWED_ROLES.includes(role as UserRole);
}

function canManage(role: string | undefined): boolean {
  return role === 'admin' || role === 'manager';
}

export default function ReconConnectPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const platform = useMemo(detectPlatform, []);
  const isElectron = typeof window !== 'undefined' && Boolean((window as any).electron?.isElectron);
  const [copied, setCopied] = useState<string | null>(null);
  const [launchMsg, setLaunchMsg] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const [termState, setTermState] = useState<'idle' | 'running'>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const termHostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const catalogSearchRef = useRef<HTMLInputElement | null>(null);
  const api = (typeof window !== 'undefined' ? (window as any).electron : null) as any;
  const hasTerminalApi = Boolean(api?.reconSpawn);

  // ── Deep-link: ?category=<slug> ─────────────────────────────────────────
  useEffect(() => {
    const cat = searchParams.get('category');
    if (!cat) return;
    const match = CATEGORIES.find(
      (c) => c.route && (c.query === cat || c.name.toLowerCase().replace(/\s+/g, '-') === cat),
    );
    setSearchParams({}, { replace: true });
    if (match?.route) navigate(match.route);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;

      // N — focus the global catalog search field
      if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && !isInput) {
        e.preventDefault();
        catalogSearchRef.current?.focus();
        return;
      }

      // Esc cascade: stop-confirm → launchMsg → (fall through)
      if (e.key === 'Escape') {
        if (confirmStop) { e.stopPropagation(); setConfirmStop(false); return; }
        if (launchMsg)   { e.stopPropagation(); setLaunchMsg(null); return; }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmStop, launchMsg]);

  useEffect(() => {
    const onResize = () => { try { fitRef.current?.fit(); } catch { /* ignore */ } };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!api?.onReconData) return;
    const unsubData = api.onReconData((id: string, chunk: string) => {
      if (id === sessionId) termRef.current?.write(chunk);
    });
    const exitHandler = (id: string, code: number) => {
      if (id !== sessionId) return;
      termRef.current?.writeln(`\r\n\x1b[33m[process exited with code ${code}]\x1b[0m`);
      sessionIdRef.current = null;
      setTermState('idle');
      setSessionId(null);
    };
    const unsubExit = api.onReconExit ? api.onReconExit(exitHandler) : undefined;
    return () => { try { unsubData?.(); unsubExit?.(); } catch { /* ignore */ } };
  }, [sessionId]);

  if (!canAccessReconConnect(user?.role)) {
    return (
      <div className="p-6">
        <div className="bg-surface-base border border-rmpg-700 p-4 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-brand-400 shrink-0 mt-0.5" />
          <div>
            <div className="text-brand-400 font-semibold text-sm">ACCESS RESTRICTED</div>
            <div className="text-rmpg-400 text-xs mt-1">Recon Connect is restricted to authorized roles. Contact your administrator.</div>
          </div>
        </div>
      </div>
    );
  }

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    } catch (err: unknown) {
      console.error('Clipboard write denied:', err);
      setLaunchMsg({ kind: 'info', text: 'Could not copy to clipboard — browser denied access.' });
      setTimeout(() => setLaunchMsg(null), 4000);
    }
  };

  const ensureTerminal = () => {
    if (termRef.current || !termHostRef.current) return termRef.current;
    const term = new XTerm({
      fontFamily: 'Arial, sans-serif',
      fontSize: 12,
      theme: { background: 'var(--surface-overlay)', foreground: 'var(--text-secondary)', cursor: 'var(--field-label-color)' },
      cursorBlink: true,
      convertEol: true,
      scrollback: 5000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(termHostRef.current);
    try { fit.fit(); } catch { /* host not measured yet */ }
    term.onData((data) => {
      const id = sessionIdRef.current;
      if (id && api?.reconInput) api.reconInput(id, data);
    });
    // xterm's input goes through a hidden textarea; clicking anywhere on the
    // host should hand focus to that textarea so keystrokes reach onData.
    termHostRef.current.addEventListener('mousedown', () => {
      setTimeout(() => term.focus(), 0);
    });
    term.focus();
    termRef.current = term;
    fitRef.current = fit;
    return term;
  };

  const runRecon = async (mode: 'install' | 'launch') => {
    if (!hasTerminalApi) {
      setLaunchMsg({ kind: 'info', text: 'This desktop app predates the in-app terminal. Download the latest installer from /download and reinstall.' });
      setTimeout(() => setLaunchMsg(null), 8000);
      return;
    }
    const term = ensureTerminal();
    if (!term) return;
    term.clear();
    let res: { ok: boolean; sessionId: string; error?: string } | null = null;
    try {
      res = await api.reconSpawn({ mode });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'IPC error starting process.';
      term.writeln(`\x1b[31m${msg}\x1b[0m`);
      return;
    }
    if (!res?.ok) {
      term.writeln(`\x1b[31m${res?.error || 'Failed to start process.'}\x1b[0m`);
      return;
    }
    sessionIdRef.current = res.sessionId;
    setSessionId(res.sessionId);
    setTermState('running');
    term.focus();
    setTimeout(() => { try { fitRef.current?.fit(); if (api?.reconResize) api.reconResize(res!.sessionId, term.cols, term.rows); } catch { /* ignore */ } }, 50);
  };

  const openCategory = async (query: string, label: string) => {
    if (!hasTerminalApi) {
      setLaunchMsg({ kind: 'info', text: 'Open Flex in the desktop app to drive the terminal from here.' });
      setTimeout(() => setLaunchMsg(null), 6000);
      return;
    }
    if (termState !== 'running') {
      await runRecon('launch');
      // wait for hackingtool's banner to render so `/` reaches the search prompt
      await new Promise((r) => setTimeout(r, 1400));
    }
    termHostRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    termRef.current?.focus();
    if (sessionIdRef.current && api?.reconInput) {
      api.reconInput(sessionIdRef.current, `/${query}\n`);
      setLaunchMsg({ kind: 'ok', text: `Filtering hackingtool by "${label}" (${query}). Press Esc in the terminal to clear.` });
      setTimeout(() => setLaunchMsg(null), 6000);
    }
  };

  const stopRecon = async () => {
    if (sessionId && api?.reconKill) {
      try {
        await api.reconKill(sessionId);
      } catch (err: unknown) {
        console.error('Failed to kill recon session:', err);
      }
    }
    sessionIdRef.current = null;
    setTermState('idle');
    setSessionId(null);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="RECON CONNECT — INVESTIGATIVE TOOLKIT" icon={Terminal} />

      {/* ConfirmDialog — stop running session (admin/manager only) */}
      <ConfirmDialog
        isOpen={confirmStop}
        onClose={() => setConfirmStop(false)}
        onConfirm={() => { setConfirmStop(false); stopRecon(); }}
        title="Stop Recon Session"
        message="Kill the running session? Any unsaved output will be lost."
        confirmLabel="Stop Session"
        cancelLabel="Keep Running"
        confirmVariant="danger"
      />

      <div className="bg-surface-base border border-border-default p-4 flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-brand-400 shrink-0 mt-0.5" />
        <div className="text-xs text-rmpg-300 leading-relaxed">
          <div className="text-brand-400 font-semibold mb-1">AUTHORIZED USE ONLY</div>
          Recon Connect bundles offensive-security tooling. Use only within the scope of
          lawful investigations, authorized pentesting engagements, or defensive research.
          All local usage is subject to RMPG policy and applicable law.
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-surface-base border border-border-default p-3">
          <div className="text-[9px] text-rmpg-400 uppercase tracking-wider">Detected Platform</div>
          <div className="text-brand-400 font-mono text-sm mt-1">{platform.toUpperCase()}</div>
        </div>
        <div className="bg-surface-base border border-border-default p-3">
          <div className="text-[9px] text-rmpg-400 uppercase tracking-wider">Flex Client</div>
          <div className="text-brand-400 font-mono text-sm mt-1">{isElectron ? 'DESKTOP (ELECTRON)' : 'WEB BROWSER'}</div>
        </div>
        <div className="bg-surface-base border border-border-default p-3">
          <div className="text-[9px] text-rmpg-400 uppercase tracking-wider">Signed In As</div>
          <div className="text-brand-400 font-mono text-sm mt-1">{user?.role?.toUpperCase() ?? 'UNKNOWN'}</div>
        </div>
      </div>

      <div className="bg-surface-base border border-border-default">
        <div className="px-3 py-2 border-b border-border-default text-[9px] text-brand-400 uppercase tracking-wider font-semibold">
          Install on this workstation
        </div>
        <div className="p-3 space-y-2">
          {platform === 'unknown' ? (
            <div className="bg-surface-overlay border border-border-default p-3 text-rmpg-400 text-[11px]">
              Platform not detected. Select your OS above or visit the full install guide.
            </div>
          ) : (
            <code className="block bg-surface-overlay border border-border-default p-2 text-[11px] font-mono text-rmpg-200 overflow-x-auto">
              {INSTALL_COMMANDS[platform]}
            </code>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => copy('install', INSTALL_COMMANDS[platform])}
              disabled={platform === 'unknown'}
              className="px-3 py-1.5 bg-surface-raised border border-rmpg-700 text-brand-400 text-xs hover:bg-surface-raised flex items-center gap-1.5 disabled:opacity-40"
            >
              {copied === 'install' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied === 'install' ? 'Copied' : 'Copy Install Command'}
            </button>
            <a
              href="https://github.com/Z4nzu/hackingtool#installation"
              target="_blank" rel="noreferrer"
              className="px-3 py-1.5 bg-surface-raised border border-rmpg-700 text-rmpg-400 text-xs hover:bg-surface-raised flex items-center gap-1.5"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Full install guide
            </a>
          </div>
        </div>
      </div>

      <div className="bg-surface-base border border-border-default">
        <div className="px-3 py-2 border-b border-border-default text-[9px] text-brand-400 uppercase tracking-wider font-semibold flex items-center justify-between">
          <span>Recon Connect Terminal</span>
          <span className="text-rmpg-400 normal-case tracking-normal">
            {termState === 'running' ? 'RUNNING' : 'IDLE'}
          </span>
        </div>
        <div className="p-3 space-y-2">
          <div className="flex gap-2">
            <button
              onClick={() => runRecon('install')}
              disabled={!isElectron || termState === 'running'}
              className="px-3 py-1.5 bg-surface-raised border border-rmpg-700 text-brand-400 text-xs hover:bg-surface-raised disabled:opacity-40 flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              Install
            </button>
            <button
              onClick={() => runRecon('launch')}
              disabled={!isElectron || termState === 'running'}
              className="px-3 py-1.5 bg-brand-400 text-black text-xs font-semibold hover:bg-brand-300 disabled:opacity-40 flex items-center gap-1.5"
            >
              <Play className="w-3.5 h-3.5" />
              Run Recon Connect
            </button>
            {canManage(user?.role) ? (
              <button
                onClick={() => termState === 'running' && setConfirmStop(true)}
                disabled={termState !== 'running'}
                className="px-3 py-1.5 bg-surface-raised border border-red-700 text-red-400 text-xs hover:bg-surface-sunken disabled:opacity-40 flex items-center gap-1.5"
              >
                <Square className="w-3.5 h-3.5" />
                Stop
              </button>
            ) : (
              <button
                disabled
                title="Admin or manager required to stop a session"
                className="px-3 py-1.5 bg-surface-raised border border-rmpg-700 text-rmpg-500 text-xs opacity-40 flex items-center gap-1.5 cursor-not-allowed"
              >
                <Square className="w-3.5 h-3.5" />
                Stop
              </button>
            )}
            <button
              onClick={() => copy('install', INSTALL_COMMANDS[platform])}
              disabled={platform === 'unknown'}
              className="ml-auto px-3 py-1.5 bg-surface-raised border border-rmpg-700 text-rmpg-400 text-xs hover:bg-surface-raised flex items-center gap-1.5 disabled:opacity-40"
              title="Copy the install command if you'd rather run it yourself"
            >
              {copied === 'install' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied === 'install' ? 'Copied' : 'Copy Install Command'}
            </button>
          </div>
          {!isElectron && (
            <div className="px-2 py-1.5 border border-rmpg-700 bg-surface-raised text-brand-400 text-[11px]">
              Open Flex in the desktop app — the in-app terminal only works in Electron.
            </div>
          )}
          {/* Empty / idle state before terminal is initialized */}
          {isElectron && termState === 'idle' && !termRef.current && (
            <div className="bg-surface-overlay border border-border-default h-[420px] flex items-center justify-center">
              <span className="text-rmpg-500 text-[11px]">
                Terminal idle — click <span className="text-brand-400 font-mono">Run Recon Connect</span> to start a session.
              </span>
            </div>
          )}
          <div
            ref={termHostRef}
            tabIndex={0}
            onClick={() => termRef.current?.focus()}
            className={`bg-surface-overlay border border-border-default h-[420px] overflow-hidden focus-within:border-brand-400 cursor-text${isElectron && termState === 'idle' && !termRef.current ? ' hidden' : ''}`}
          />
          {launchMsg && (
            <div className={`px-2 py-1.5 border text-[11px] ${
              launchMsg.kind === 'ok'  ? 'border-green-700 bg-surface-sunken text-green-400' :
              launchMsg.kind === 'err' ? 'border-red-700 bg-surface-sunken text-red-400' :
                                         'border-rmpg-700 bg-surface-raised text-brand-400'
            }`}>
              {launchMsg.text}
            </div>
          )}
        </div>
      </div>

      <GlobalCatalogSearch onNavigate={navigate} searchRef={catalogSearchRef} />

      {isElectron && <InstallDashboard />}

      <div>
        {CATEGORIES.length === 0 ? (
          <div className="text-rmpg-500 text-[11px] p-4 border border-border-default bg-surface-base">
            No tool categories available.
          </div>
        ) : (
          <>
            <div className="text-[9px] text-brand-400 uppercase tracking-wider font-semibold mb-2">
              Tool Categories ({CATEGORIES.reduce((s, c) => s + c.count, 0)}+ tools across {CATEGORIES.length} categories)
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {CATEGORIES.map(({ icon: Icon, name, count, desc, query, route }) => {
                const isNative = Boolean(route);
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => route ? navigate(route) : openCategory(query, name)}
                    disabled={!route && !isElectron}
                    title={route ? `Open native ${name} workspace` : isElectron ? `Filter hackingtool to ${name}` : 'Requires the desktop app'}
                    className="group text-left bg-surface-base border border-border-default p-3 flex items-start gap-3 hover:bg-surface-raised hover:border-brand-400 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                  >
                    <Icon className="w-4 h-4 text-brand-400 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <div className="text-rmpg-200 text-xs font-semibold group-hover:text-brand-400">{name}</div>
                        <div className="text-rmpg-400 text-[10px] font-mono">{count} tools</div>
                        {isNative && (
                          <span className="text-[8px] font-mono uppercase tracking-wider text-brand-400 border border-brand-400/40 px-1 py-[1px]">NATIVE</span>
                        )}
                      </div>
                      <div className="text-rmpg-400 text-[10px] leading-snug mt-0.5">{desc}</div>
                      <div className="text-rmpg-500 text-[9px] font-mono mt-1 group-hover:text-brand-400">{isNative ? 'Open workspace →' : `/${query} ↵`}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
