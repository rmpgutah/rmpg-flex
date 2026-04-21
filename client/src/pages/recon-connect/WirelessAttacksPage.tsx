import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Wifi, Bluetooth, Network, Radio, ShieldAlert } from 'lucide-react';
import PanelTitleBar from '../../components/PanelTitleBar';
import { useAuth } from '../../context/AuthContext';
import ToolCard, { type ToolDef } from './ToolCard';
import FullCatalog from './FullCatalog';

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

      <FullCatalog categorySlug="wireless-attacks" />
    </div>
  );
}
