import { useEffect, useMemo, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Terminal, Copy, CheckCircle2, ExternalLink, ShieldAlert, Search, Globe, Radio, Server, Cloud, Smartphone, Lock, Eye, Database, Wifi, Bug, FileSearch, Users, Zap, GitBranch, KeyRound, Play, Square, Download } from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import { useAuth } from '../context/AuthContext';

type Platform = 'linux' | 'macos' | 'windows' | 'unknown';
type UserRole = 'admin' | 'manager' | 'supervisor' | 'officer' | 'dispatcher' | 'contract_manager' | 'client_viewer' | 'human_resources' | 'investigator';

const CATEGORIES: Array<{ icon: any; name: string; count: number; desc: string }> = [
  { icon: Search,     name: 'OSINT',                count: 18, desc: 'Open-source intel: usernames, emails, phone, social' },
  { icon: Globe,      name: 'Web Recon',            count: 14, desc: 'Subdomain enum, WHOIS, directory brute, tech fingerprint' },
  { icon: Wifi,       name: 'Network Scanning',     count: 12, desc: 'Nmap, masscan, service enumeration' },
  { icon: Lock,       name: 'Password Tools',       count: 9,  desc: 'Hash crackers, wordlist generators' },
  { icon: Eye,        name: 'Wireless Attacks',     count: 8,  desc: 'WiFi recon, WPA/WPS, bluetooth' },
  { icon: Bug,        name: 'Exploitation',         count: 15, desc: 'Metasploit, exploit search (pentest scope only)' },
  { icon: Server,     name: 'Active Directory',     count: 11, desc: 'BloodHound, Kerberoasting, enum' },
  { icon: Cloud,      name: 'Cloud Security',       count: 10, desc: 'AWS/GCP/Azure recon & misconfig checks' },
  { icon: Smartphone, name: 'Mobile Security',      count: 9,  desc: 'APK analysis, iOS triage' },
  { icon: FileSearch, name: 'Forensics',            count: 12, desc: 'Disk, memory, log analysis' },
  { icon: Radio,      name: 'Anonymity',            count: 7,  desc: 'Tor, proxychains, VPN chains' },
  { icon: KeyRound,   name: 'Reverse Engineering',  count: 10, desc: 'Ghidra, Radare2, decompilers' },
  { icon: Database,   name: 'SQL Injection',        count: 6,  desc: 'SQLMap and variants' },
  { icon: Users,      name: 'Social Engineering',   count: 8,  desc: 'Phishing simulation (authorized testing)' },
  { icon: Zap,        name: 'DDoS (defensive use)', count: 5,  desc: 'Stress testing — authorized scope only' },
  { icon: GitBranch,  name: 'Post-Exploitation',    count: 9,  desc: 'Persistence, lateral movement (labs only)' },
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

const LAUNCH_COMMANDS: Record<Platform, string> = {
  linux:   'hackingtool',
  macos:   'cd ~/recon-connect && source venv/bin/activate && python3 "recon connect.py"',
  windows: 'cd %USERPROFILE%\\recon-connect && venv\\Scripts\\activate && python "recon connect.py"',
  unknown: '',
};

// Who is allowed to see / launch Recon Connect from inside Flex.
// TODO: you own this policy decision — see ReconConnectPage prompt below.
const ALLOWED_ROLES: UserRole[] = ['admin', 'manager', 'supervisor', 'investigator', 'dispatcher', 'officer'];

function canAccessReconConnect(role: string | undefined): boolean {
  if (!role) return false;
  return ALLOWED_ROLES.includes(role as UserRole);
}

export default function ReconConnectPage() {
  const { user } = useAuth();
  const platform = useMemo(detectPlatform, []);
  const isElectron = typeof window !== 'undefined' && Boolean((window as any).electron?.isElectron);
  const [copied, setCopied] = useState<string | null>(null);
  const [launchMsg, setLaunchMsg] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const [termState, setTermState] = useState<'idle' | 'running'>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const termHostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const api = (typeof window !== 'undefined' ? (window as any).electron : null) as any;
  const hasTerminalApi = Boolean(api?.reconSpawn);

  if (!canAccessReconConnect(user?.role)) {
    return (
      <div className="p-6">
        <div className="bg-[#141414] border border-[#2e2e2e] p-4 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-[#d4a017] shrink-0 mt-0.5" />
          <div>
            <div className="text-[#d4a017] font-semibold text-sm">ACCESS RESTRICTED</div>
            <div className="text-[#888] text-xs mt-1">Recon Connect is restricted to authorized roles. Contact your administrator.</div>
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
    } catch { /* clipboard denied */ }
  };

  const ensureTerminal = () => {
    if (termRef.current || !termHostRef.current) return termRef.current;
    const term = new XTerm({
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 12,
      theme: { background: '#050505', foreground: '#d4d4d4', cursor: '#d4a017' },
      cursorBlink: true,
      convertEol: true,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(termHostRef.current);
    try { fit.fit(); } catch { /* host not measured yet */ }
    term.onData((data) => {
      const id = sessionIdRef.current;
      if (id && api?.reconInput) api.reconInput(id, data);
    });
    termRef.current = term;
    fitRef.current = fit;
    return term;
  };

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
    const unsubExit = api.onReconExit?.((id: string, code: number) => {
      if (id !== sessionId) return;
      termRef.current?.writeln(`\r\n\x1b[33m[process exited with code ${code}]\x1b[0m`);
      sessionIdRef.current = null;
      setTermState('idle');
      setSessionId(null);
    });
    return () => { try { unsubData?.(); unsubExit?.(); } catch { /* ignore */ } };
  }, [sessionId]);

  const runRecon = async (mode: 'install' | 'launch') => {
    if (!hasTerminalApi) {
      setLaunchMsg({ kind: 'info', text: 'This desktop app predates the in-app terminal. Download the latest installer from /download and reinstall.' });
      setTimeout(() => setLaunchMsg(null), 8000);
      return;
    }
    const term = ensureTerminal();
    if (!term) return;
    term.clear();
    const res = await api.reconSpawn({ mode });
    if (!res?.ok) {
      term.writeln(`\x1b[31m${res?.error || 'Failed to start process.'}\x1b[0m`);
      return;
    }
    sessionIdRef.current = res.sessionId;
    setSessionId(res.sessionId);
    setTermState('running');
    term.focus();
    setTimeout(() => { try { fitRef.current?.fit(); if (api?.reconResize) api.reconResize(res.sessionId, term.cols, term.rows); } catch { /* ignore */ } }, 50);
  };

  const stopRecon = async () => {
    if (sessionId && api?.reconKill) {
      await api.reconKill(sessionId);
    }
    sessionIdRef.current = null;
    setTermState('idle');
    setSessionId(null);
  };

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="RECON CONNECT — INVESTIGATIVE TOOLKIT" icon={Terminal} />

      <div className="bg-[#141414] border border-[#222] p-4 flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-[#d4a017] shrink-0 mt-0.5" />
        <div className="text-xs text-[#bbb] leading-relaxed">
          <div className="text-[#d4a017] font-semibold mb-1">AUTHORIZED USE ONLY</div>
          Recon Connect bundles offensive-security tooling. Use only within the scope of
          lawful investigations, authorized pentesting engagements, or defensive research.
          All local usage is subject to RMPG policy and applicable law.
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-[#141414] border border-[#222] p-3">
          <div className="text-[9px] text-[#888] uppercase tracking-wider">Detected Platform</div>
          <div className="text-[#d4a017] font-mono text-sm mt-1">{platform.toUpperCase()}</div>
        </div>
        <div className="bg-[#141414] border border-[#222] p-3">
          <div className="text-[9px] text-[#888] uppercase tracking-wider">Flex Client</div>
          <div className="text-[#d4a017] font-mono text-sm mt-1">{isElectron ? 'DESKTOP (ELECTRON)' : 'WEB BROWSER'}</div>
        </div>
        <div className="bg-[#141414] border border-[#222] p-3">
          <div className="text-[9px] text-[#888] uppercase tracking-wider">Signed In As</div>
          <div className="text-[#d4a017] font-mono text-sm mt-1">{user?.role?.toUpperCase() ?? 'UNKNOWN'}</div>
        </div>
      </div>

      <div className="bg-[#141414] border border-[#222]">
        <div className="px-3 py-2 border-b border-[#222] text-[9px] text-[#d4a017] uppercase tracking-wider font-semibold">
          Install on this workstation
        </div>
        <div className="p-3 space-y-2">
          <code className="block bg-[#050505] border border-[#1a1a1a] p-2 text-[11px] font-mono text-[#d4d4d4] overflow-x-auto">
            {INSTALL_COMMANDS[platform]}
          </code>
          <div className="flex gap-2">
            <button
              onClick={() => copy('install', INSTALL_COMMANDS[platform])}
              className="px-3 py-1.5 bg-[#1a1a1a] border border-[#2e2e2e] text-[#d4a017] text-xs hover:bg-[#242424] flex items-center gap-1.5"
            >
              {copied === 'install' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied === 'install' ? 'Copied' : 'Copy Install Command'}
            </button>
            <a
              href="https://github.com/Z4nzu/hackingtool#installation"
              target="_blank" rel="noreferrer"
              className="px-3 py-1.5 bg-[#1a1a1a] border border-[#2e2e2e] text-[#888] text-xs hover:bg-[#242424] flex items-center gap-1.5"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Full install guide
            </a>
          </div>
        </div>
      </div>

      <div className="bg-[#141414] border border-[#222]">
        <div className="px-3 py-2 border-b border-[#222] text-[9px] text-[#d4a017] uppercase tracking-wider font-semibold flex items-center justify-between">
          <span>Recon Connect Terminal</span>
          <span className="text-[#888] normal-case tracking-normal">
            {termState === 'running' ? 'RUNNING' : 'IDLE'}
          </span>
        </div>
        <div className="p-3 space-y-2">
          <div className="flex gap-2">
            <button
              onClick={() => runRecon('install')}
              disabled={!isElectron || termState === 'running'}
              className="px-3 py-1.5 bg-[#1a1a1a] border border-[#2e2e2e] text-[#d4a017] text-xs hover:bg-[#242424] disabled:opacity-40 flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              Install
            </button>
            <button
              onClick={() => runRecon('launch')}
              disabled={!isElectron || termState === 'running'}
              className="px-3 py-1.5 bg-[#d4a017] text-black text-xs font-semibold hover:bg-[#e5b128] disabled:opacity-40 flex items-center gap-1.5"
            >
              <Play className="w-3.5 h-3.5" />
              Run Recon Connect
            </button>
            <button
              onClick={stopRecon}
              disabled={termState !== 'running'}
              className="px-3 py-1.5 bg-[#1a1a1a] border border-[#b33] text-[#ff8888] text-xs hover:bg-[#2a1414] disabled:opacity-40 flex items-center gap-1.5"
            >
              <Square className="w-3.5 h-3.5" />
              Stop
            </button>
            <button
              onClick={() => copy('install', INSTALL_COMMANDS[platform])}
              className="ml-auto px-3 py-1.5 bg-[#1a1a1a] border border-[#2e2e2e] text-[#888] text-xs hover:bg-[#242424] flex items-center gap-1.5"
              title="Copy the install command if you'd rather run it yourself"
            >
              {copied === 'install' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied === 'install' ? 'Copied' : 'Copy Install Command'}
            </button>
          </div>
          {!isElectron && (
            <div className="px-2 py-1.5 border border-[#2e2e2e] bg-[#1a1a1a] text-[#d4a017] text-[11px]">
              Open Flex in the desktop app — the in-app terminal only works in Electron.
            </div>
          )}
          <div
            ref={termHostRef}
            className="bg-[#050505] border border-[#1a1a1a] h-[420px] overflow-hidden"
          />
          {launchMsg && (
            <div className={`px-2 py-1.5 border text-[11px] ${
              launchMsg.kind === 'ok'  ? 'border-[#2e7d32] bg-[#0f1f10] text-[#7fd38a]' :
              launchMsg.kind === 'err' ? 'border-[#b33] bg-[#1f0a0a] text-[#ff8888]' :
                                         'border-[#2e2e2e] bg-[#1a1a1a] text-[#d4a017]'
            }`}>
              {launchMsg.text}
            </div>
          )}
        </div>
      </div>

      <div>
        <div className="text-[9px] text-[#d4a017] uppercase tracking-wider font-semibold mb-2">
          Tool Categories ({CATEGORIES.reduce((s, c) => s + c.count, 0)}+ tools across {CATEGORIES.length} categories)
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {CATEGORIES.map(({ icon: Icon, name, count, desc }) => (
            <div key={name} className="bg-[#141414] border border-[#222] p-3 flex items-start gap-3">
              <Icon className="w-4 h-4 text-[#d4a017] shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <div className="text-[#d4d4d4] text-xs font-semibold">{name}</div>
                  <div className="text-[#888] text-[10px] font-mono">{count} tools</div>
                </div>
                <div className="text-[#888] text-[10px] leading-snug mt-0.5">{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
