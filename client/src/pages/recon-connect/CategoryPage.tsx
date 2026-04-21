import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import PanelTitleBar from '../../components/PanelTitleBar';
import { useAuth } from '../../context/AuthContext';
import ToolCard, { type ToolDef } from './ToolCard';

type UserRole = 'admin' | 'manager' | 'supervisor' | 'officer' | 'dispatcher' | 'contract_manager' | 'client_viewer' | 'human_resources' | 'investigator';
const ALLOWED_ROLES: UserRole[] = ['admin', 'manager', 'supervisor', 'investigator', 'dispatcher', 'officer'];

export interface CategoryPageProps {
  title: string;
  icon: any;
  authorizationBanner?: { kind: 'standard' | 'critical'; text: string };
  tools: ToolDef[];
}

export default function CategoryPage({ title, icon, authorizationBanner, tools }: CategoryPageProps) {
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

  const banner = authorizationBanner ?? {
    kind: 'standard' as const,
    text: 'AUTHORIZED USE ONLY — only run these tools against systems you own or have explicit written authorization to test. Unauthorized use may violate federal and state computer-fraud laws.',
  };

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

      <PanelTitleBar title={title.toUpperCase()} icon={icon} />

      <div className={`bg-[#141414] border p-3 flex items-start gap-3 ${
        banner.kind === 'critical' ? 'border-[#b33]/40' : 'border-[#222]'
      }`}>
        <ShieldAlert className={`w-4 h-4 shrink-0 mt-0.5 ${banner.kind === 'critical' ? 'text-[#ff8888]' : 'text-[#d4a017]'}`} />
        <div className="text-[11px] text-[#bbb] leading-relaxed">{banner.text}</div>
      </div>

      {!isElectron && (
        <div className="bg-[#141414] border border-[#2e2e2e] text-[#d4a017] text-[11px] p-3">
          These tools execute on the local workstation — open Flex in the desktop app to use them.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {tools.map((tool) => (
          <ToolCard key={tool.id} tool={tool} disabled={!isElectron} />
        ))}
      </div>
    </div>
  );
}
