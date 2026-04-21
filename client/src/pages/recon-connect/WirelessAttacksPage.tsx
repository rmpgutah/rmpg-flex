import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Wifi, Bluetooth, Network, Radio, Play, Square, ShieldAlert } from 'lucide-react';
import PanelTitleBar from '../../components/PanelTitleBar';
import { useAuth } from '../../context/AuthContext';

type ToolArg = { name: string; label: string; placeholder?: string; required?: boolean };
type ToolDef = {
  id: string;
  icon: any;
  title: string;
  description: string;
  requiresAuthorization?: string;
  args?: ToolArg[];
  runLabel?: string;
};

const TOOLS: ToolDef[] = [
  {
    id: 'wifi-scan',
    icon: Wifi,
    title: 'WiFi Scan',
    description: 'List all WiFi networks broadcasting in range. Uses Apple\'s built-in airport utility — no monitor mode required.',
  },
  {
    id: 'wifi-info',
    icon: Radio,
    title: 'Current WiFi Info',
    description: 'Show the SSID, BSSID, and signal strength of the network this workstation is connected to.',
  },
  {
    id: 'bluetooth-scan',
    icon: Bluetooth,
    title: 'Bluetooth Inventory',
    description: 'List paired, connected, and discoverable Bluetooth devices via system_profiler.',
  },
  {
    id: 'local-network',
    icon: Network,
    title: 'Local Network Hosts (ARP)',
    description: 'Dump the ARP cache to see every device this workstation has recently talked to on the local subnet.',
  },
  {
    id: 'port-scan',
    icon: Network,
    title: 'Port Scan (nmap)',
    description: 'Scan the top-100 TCP ports on a target host or CIDR block. Requires nmap (brew install nmap).',
    requiresAuthorization: 'Only scan hosts you own or have explicit written authorization to test.',
    args: [
      { name: 'target', label: 'Target host or CIDR', placeholder: '192.168.1.0/24 or example.local', required: true },
    ],
    runLabel: 'Run nmap',
  },
];

type UserRole = 'admin' | 'manager' | 'supervisor' | 'officer' | 'dispatcher' | 'contract_manager' | 'client_viewer' | 'human_resources' | 'investigator';
const ALLOWED_ROLES: UserRole[] = ['admin', 'manager', 'supervisor', 'investigator', 'dispatcher', 'officer'];

export default function WirelessAttacksPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isElectron = typeof window !== 'undefined' && Boolean((window as any).electron?.isElectron);

  if (!user?.role || !ALLOWED_ROLES.includes(user.role as UserRole)) {
    return (
      <div className="p-6">
        <div className="bg-[#141414] border border-[#2e2e2e] p-4 text-[#888] text-xs">ACCESS RESTRICTED</div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/recon-connect')}
          className="px-3 py-1.5 bg-[#1a1a1a] border border-[#2e2e2e] text-[#888] text-xs hover:bg-[#242424] flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Recon Connect
        </button>
      </div>

      <PanelTitleBar title="WIRELESS ATTACKS — NATIVE TOOLS" icon={Wifi} />

      <div className="bg-[#141414] border border-[#222] p-3 flex items-start gap-3">
        <ShieldAlert className="w-4 h-4 text-[#d4a017] shrink-0 mt-0.5" />
        <div className="text-[11px] text-[#bbb] leading-relaxed">
          <span className="text-[#d4a017] font-semibold">AUTHORIZED USE ONLY</span> — Wireless reconnaissance
          is legal on networks you own or have explicit written authorization to test. Scanning or
          attacking third-party networks without consent violates federal and state law.
        </div>
      </div>

      {!isElectron && (
        <div className="bg-[#141414] border border-[#2e2e2e] text-[#d4a017] text-[11px] p-3">
          These tools execute on the local workstation — open Flex in the desktop app to use them.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {TOOLS.map((tool) => (
          <ToolCard key={tool.id} tool={tool} disabled={!isElectron} />
        ))}
      </div>
    </div>
  );
}

function ToolCard({ tool, disabled }: { tool: ToolDef; disabled: boolean }) {
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [output, setOutput] = useState<Array<{ kind: 'stdout' | 'stderr' | 'meta'; text: string }>>([]);
  const [running, setRunning] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const outputRef = useRef<HTMLDivElement | null>(null);
  const api = (typeof window !== 'undefined' ? (window as any).electron : null) as any;

  useEffect(() => {
    if (!api?.onReconToolData) return;
    const unsubData = api.onReconToolData((id: string, kind: 'stdout' | 'stderr', data: string) => {
      if (id !== sessionIdRef.current) return;
      setOutput((prev) => [...prev, { kind, text: data }]);
    });
    const unsubExit = api.onReconToolExit?.((id: string, code: number) => {
      if (id !== sessionIdRef.current) return;
      setOutput((prev) => [...prev, { kind: 'meta', text: `\n[exited with code ${code}]\n` }]);
      setRunning(false);
      sessionIdRef.current = null;
      setSessionId(null);
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
    setOutput([]);
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

  const Icon = tool.icon;
  return (
    <div className="bg-[#141414] border border-[#222] flex flex-col">
      <div className="px-3 py-2 border-b border-[#222] flex items-center gap-2">
        <Icon className="w-4 h-4 text-[#d4a017]" />
        <div className="text-[#d4d4d4] text-xs font-semibold flex-1">{tool.title}</div>
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
        {tool.args?.map((arg) => (
          <div key={arg.name} className="flex flex-col gap-1">
            <label className="text-[9px] text-[#888] uppercase tracking-wider">{arg.label}{arg.required && ' *'}</label>
            <input
              type="text"
              placeholder={arg.placeholder}
              value={formValues[arg.name] || ''}
              onChange={(e) => setFormValues((f) => ({ ...f, [arg.name]: e.target.value }))}
              disabled={running}
              className="bg-[#050505] border border-[#2e2e2e] text-[#d4d4d4] text-[11px] font-mono px-2 py-1 focus:border-[#d4a017] outline-none disabled:opacity-50"
            />
          </div>
        ))}
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
          {output.length > 0 && (
            <button
              onClick={() => setOutput([])}
              disabled={running}
              className="ml-auto px-2 py-1.5 text-[#888] text-[10px] hover:text-[#d4a017] disabled:opacity-40"
            >
              Clear
            </button>
          )}
        </div>
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
