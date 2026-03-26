import React, { useState, useEffect, useCallback } from 'react';
import {
  Brain, Loader2, Server, Zap, Activity, Shield, LayoutDashboard, MessageSquareCode,
  SlidersHorizontal, FlaskConical, Settings2,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import type { AIConfig, ProviderInfo, UsageStats } from './ai/AISharedComponents';
import AICommandCenterPanel from './ai/AICommandCenterPanel';
import AIProvidersPanel from './ai/AIProvidersPanel';
import AICapabilitiesPanel from './ai/AICapabilitiesPanel';
import AIActivityPanel from './ai/AIActivityPanel';
import AIIntelligencePanel from './ai/AIIntelligencePanel';
import AIMasterConfigPanel from './ai/AIMasterConfigPanel';
import AIDevChatPanel from './ai/AIDevChatPanel';
import AIModelTuningPanel from './ai/AIModelTuningPanel';
import AIPromptWorkshopPanel from './ai/AIPromptWorkshopPanel';
import AIBehaviorPanel from './ai/AIBehaviorPanel';

interface Props {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

type AISection = 'command_center' | 'providers' | 'capabilities' | 'model_tuning' | 'prompt_workshop' | 'activity' | 'behavior' | 'intelligence' | 'master_config' | 'dev_chat';

const SECTIONS: Array<{ id: AISection; label: string; icon: React.FC<{ className?: string }> }> = [
  { id: 'command_center', label: 'Command Center', icon: LayoutDashboard },
  { id: 'providers', label: 'Providers', icon: Server },
  { id: 'capabilities', label: 'Capabilities', icon: Zap },
  { id: 'model_tuning', label: 'Model Tuning', icon: SlidersHorizontal },
  { id: 'prompt_workshop', label: 'Prompt Workshop', icon: FlaskConical },
  { id: 'activity', label: 'Activity Log', icon: Activity },
  { id: 'behavior', label: 'AI Behavior', icon: Settings2 },
  { id: 'intelligence', label: 'System Intelligence', icon: Shield },
  { id: 'master_config', label: 'Master AI', icon: Brain },
  { id: 'dev_chat', label: 'Dev Assistant', icon: MessageSquareCode },
];

export default function AdminAISettingsTab({ LoadingSpinner, error, setError }: Props) {
  const [section, setSection] = useState<AISection>(() => {
    return (localStorage.getItem('rmpg_admin_ai_section') as AISection) || 'command_center';
  });

  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<AIConfig | null>(null);
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [providerStatus, setProviderStatus] = useState<ProviderInfo[]>([]);

  const fetchAll = useCallback(async () => {
    try {
      const [cfg, st, status] = await Promise.all([
        apiFetch<AIConfig>('/ai/config'),
        apiFetch<UsageStats>('/ai/stats'),
        apiFetch<{ provider: string; available: boolean; model: string; providers: ProviderInfo[] }>('/ai/status'),
      ]);
      setConfig(cfg);
      setStats(st);
      setProviderStatus(status.providers);
    } catch (err: any) {
      setError(err?.message || 'Failed to load AI configuration');
    } finally {
      setLoading(false);
    }
  }, [setError]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleSectionChange = (s: AISection) => {
    setSection(s);
    localStorage.setItem('rmpg_admin_ai_section', s);
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      {/* Horizontal tab strip */}
      <div className="flex gap-1 border-b border-[#1a3550] pb-2 overflow-x-auto">
        {SECTIONS.map(s => {
          const Icon = s.icon;
          return (
            <button
              key={s.id}
              onClick={() => handleSectionChange(s.id)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap transition-colors ${
                section === s.id
                  ? 'bg-[#1a3550] text-white'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-[#111827]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {s.label}
            </button>
          );
        })}
      </div>

      {/* Panel content */}
      {section === 'command_center' && (
        <AICommandCenterPanel
          providerStatus={providerStatus}
          activeProvider={config?.provider || 'groq'}
          stats={stats}
          setError={setError}
        />
      )}

      {section === 'providers' && config && (
        <AIProvidersPanel
          config={config}
          providerStatus={providerStatus}
          setConfig={setConfig}
          onSaved={fetchAll}
          setError={setError}
        />
      )}

      {section === 'capabilities' && config && (
        <AICapabilitiesPanel
          config={config}
          setConfig={setConfig}
          onSaved={fetchAll}
          setError={setError}
        />
      )}

      {section === 'model_tuning' && <AIModelTuningPanel />}

      {section === 'prompt_workshop' && <AIPromptWorkshopPanel />}

      {section === 'activity' && <AIActivityPanel />}

      {section === 'behavior' && <AIBehaviorPanel />}

      {section === 'intelligence' && <AIIntelligencePanel setError={setError} />}

      {section === 'master_config' && <AIMasterConfigPanel setError={setError} />}

      {section === 'dev_chat' && <AIDevChatPanel />}
    </div>
  );
}
