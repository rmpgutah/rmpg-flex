import { useState, useEffect } from 'react';
import { Save, Loader2, Brain, RotateCcw } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';

import RichTextArea from '../../../components/RichTextArea';
interface MasterConfig {
  masterPrompt: string;
  chainMode: boolean;
  routingRules: Record<string, { provider: string }>;
  providerPriority: string[];
}

const DEFAULT_MASTER_PROMPT = `You are an AI assistant for RMPG Flex, a police CAD/RMS system for Rocky Mountain Protective Group. You help with dispatch operations, call analysis, unit management, and report generation. Be concise, professional, and safety-focused.`;

const TASK_TYPES = [
  { key: 'callAnalysis', label: 'Call Analysis' },
  { key: 'narrativeAssist', label: 'Narrative Assist' },
  { key: 'unitSuggestions', label: 'Unit Suggestions' },
  { key: 'safetyBriefings', label: 'Safety Briefings' },
  { key: 'dataCleanup', label: 'Data Cleanup' },
  { key: 'systemMonitoring', label: 'System Monitoring' },
  { key: 'healthCheck', label: 'Health Check' },
  { key: 'general', label: 'General' },
];

interface Props {
  setError: (e: string | null) => void;
}

export default function AIMasterConfigPanel({ setError }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [masterPrompt, setMasterPrompt] = useState('');
  const [chainMode, setChainMode] = useState(false);
  const [routingRules, setRoutingRules] = useState<Record<string, { provider: string }>>({});

  useEffect(() => {
    apiFetch<MasterConfig>('/ai/master-config').then(mc => {
      setMasterPrompt(mc.masterPrompt || '');
      setChainMode(mc.chainMode ?? false);
      setRoutingRules(mc.routingRules || {});
    }).catch(err => {
      setError(err?.message || 'Failed to load master config');
    }).finally(() => {
      setLoading(false);
    });
  }, [setError]);

  const updateRouting = (key: string, provider: string) => {
    setRoutingRules(prev => ({
      ...prev,
      [key]: { ...prev[key], provider },
    }));
    setDirty(true);
  };

  const resetDefaults = () => {
    setMasterPrompt(DEFAULT_MASTER_PROMPT);
    setChainMode(false);
    const defaultRouting: Record<string, { provider: string }> = {};
    TASK_TYPES.forEach(t => { defaultRouting[t.key] = { provider: 'auto' }; });
    setRoutingRules(defaultRouting);
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiFetch('/ai/master-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ masterPrompt, chainMode, routingRules }),
      });
      setDirty(false);
    } catch (err: any) {
      setError(err?.message || 'Failed to save master config');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-rmpg-500" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* System Prompt */}
      <div>
        <h3 className="text-xs font-semibold text-white uppercase tracking-wide mb-2 flex items-center gap-2">
          <Brain className="w-3.5 h-3.5 text-brand-400" />
          System Prompt
        </h3>
        <RichTextArea
          value={masterPrompt}
          onChange={e => { setMasterPrompt(e.target.value); setDirty(true); }}
          rows={6}
          className="w-full bg-[#0b0b0b] border border-[#1c1c1c] text-white text-xs rounded px-3 py-2 focus:border-brand-500 focus:outline-none placeholder:text-rmpg-600 font-mono leading-relaxed resize-y"
          placeholder="Enter the master system prompt for all AI operations..."
        />
        <p className="text-[10px] text-rmpg-600 mt-1">
          This prompt is prepended to every AI request as the system context.
        </p>
      </div>

      {/* Chain Mode */}
      <div className="bg-[#121212] border border-[#1c1c1c] rounded p-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setChainMode(!chainMode); setDirty(true); }}
            className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
              chainMode ? 'bg-brand-600' : 'bg-[#1c1c1c]'
            }`}
            aria-label="Toggle chain mode"
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                chainMode ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
          <div>
            <div className="text-xs text-white font-medium">Chain Mode</div>
            <p className="text-[10px] text-rmpg-500 mt-0.5">
              Two-step reasoning: fast classification then detailed analysis. Uses a lightweight model
              to classify the task first, then routes to the best provider for the detailed response.
            </p>
          </div>
        </div>
      </div>

      {/* Routing Rules */}
      <div>
        <h3 className="text-xs font-semibold text-white uppercase tracking-wide mb-2">
          Task Routing Rules
        </h3>
        <div className="bg-[#121212] border border-[#1c1c1c] rounded divide-y divide-[#1c1c1c]">
          {TASK_TYPES.map(task => {
            const current = routingRules[task.key]?.provider || 'auto';
            return (
              <div key={task.key} className="flex items-center gap-3 px-4 py-2.5">
                <span className="text-xs text-white flex-1">{task.label}</span>
                <select
                  value={current}
                  onChange={e => updateRouting(task.key, e.target.value)}
                  className="bg-[#0b0b0b] border border-[#1c1c1c] text-white text-xs rounded px-2 py-1.5 focus:border-brand-500 focus:outline-none"
                >
                  <option value="auto">Auto</option>
                  <option value="groq">Groq</option>
                  <option value="gemini">Gemini</option>
                  <option value="openai">OpenAI</option>
                  <option value="ollama">Ollama</option>
                </select>
              </div>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <button
          onClick={resetDefaults}
          className="flex items-center gap-1.5 px-3 py-1.5 text-rmpg-400 hover:text-white text-xs font-medium rounded border border-[#1c1c1c] hover:border-rmpg-500 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset to Defaults
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-xs font-medium rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Save Master Config
        </button>
      </div>
    </div>
  );
}
