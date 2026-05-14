import { useState, useEffect, useCallback } from 'react';
import { Loader2, Save } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';

interface BehaviorConfig {
  responseStyle: 'concise' | 'balanced' | 'detailed';
  tone: 'professional' | 'casual' | 'technical';
  safetyFilter: 'strict' | 'moderate' | 'off';
  rateLimit: number;
  maxConcurrent: number;
  requestTimeout: number;
  autoRetry: boolean;
  retryCount: number;
}

const DEFAULTS: BehaviorConfig = {
  responseStyle: 'balanced',
  tone: 'professional',
  safetyFilter: 'moderate',
  rateLimit: 25,
  maxConcurrent: 3,
  requestTimeout: 120,
  autoRetry: true,
  retryCount: 2,
};

export default function AIBehaviorPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<BehaviorConfig>(DEFAULTS);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      const data = await apiFetch<BehaviorConfig>('/ai/behavior');
      setConfig({ ...DEFAULTS, ...data });
    } catch (err: any) {
      setError(err?.message || 'Failed to load behavior config');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiFetch('/ai/behavior', {
        method: 'PUT',
        body: JSON.stringify(config),
      });
    } catch (err: any) {
      setError(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const update = <K extends keyof BehaviorConfig>(key: K, value: BehaviorConfig[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-xs">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column — AI Personality */}
        <div className="space-y-5">
          {/* Response Style */}
          <div className="bg-[#141414] border border-[#303030] rounded p-4 space-y-3">
            <h3 className="text-sm font-semibold text-white">Response Style</h3>
            <div className="space-y-2">
              <RadioOption
                name="responseStyle"
                value="concise"
                selected={config.responseStyle}
                label="Concise"
                description="Brief, bullet-pointed responses"
                onChange={() => update('responseStyle', 'concise')}
              />
              <RadioOption
                name="responseStyle"
                value="balanced"
                selected={config.responseStyle}
                label="Balanced"
                description="Standard response length"
                onChange={() => update('responseStyle', 'balanced')}
              />
              <RadioOption
                name="responseStyle"
                value="detailed"
                selected={config.responseStyle}
                label="Detailed"
                description="Thorough explanations with examples"
                onChange={() => update('responseStyle', 'detailed')}
              />
            </div>
          </div>

          {/* Tone */}
          <div className="bg-[#141414] border border-[#303030] rounded p-4 space-y-3">
            <h3 className="text-sm font-semibold text-white">Tone</h3>
            <div className="space-y-2">
              <RadioOption
                name="tone"
                value="professional"
                selected={config.tone}
                label="Professional"
                description="Formal law enforcement tone"
                onChange={() => update('tone', 'professional')}
              />
              <RadioOption
                name="tone"
                value="casual"
                selected={config.tone}
                label="Casual"
                description="Conversational and friendly"
                onChange={() => update('tone', 'casual')}
              />
              <RadioOption
                name="tone"
                value="technical"
                selected={config.tone}
                label="Technical"
                description="Precise technical language"
                onChange={() => update('tone', 'technical')}
              />
            </div>
          </div>

          {/* Safety Filter */}
          <div className="bg-[#141414] border border-[#303030] rounded p-4 space-y-3">
            <h3 className="text-sm font-semibold text-white">Safety Filter</h3>
            <div className="space-y-2">
              <RadioOption
                name="safetyFilter"
                value="strict"
                selected={config.safetyFilter}
                label="Strict"
                description="Maximum content filtering"
                onChange={() => update('safetyFilter', 'strict')}
              />
              <RadioOption
                name="safetyFilter"
                value="moderate"
                selected={config.safetyFilter}
                label="Moderate"
                description="Standard filtering"
                onChange={() => update('safetyFilter', 'moderate')}
              />
              <RadioOption
                name="safetyFilter"
                value="off"
                selected={config.safetyFilter}
                label="Off"
                description="No content restrictions"
                onChange={() => update('safetyFilter', 'off')}
              />
            </div>
          </div>
        </div>

        {/* Right Column — Performance */}
        <div className="space-y-5">
          <div className="bg-[#141414] border border-[#303030] rounded p-4 space-y-4">
            <h3 className="text-sm font-semibold text-white">Performance</h3>

            {/* Rate Limit */}
            <div className="space-y-1">
              <label className="text-xs text-gray-300">Rate Limit (req/min)</label>
              <input
                type="number" min={1} max={100}
                value={config.rateLimit}
                onChange={e => update('rateLimit', Math.min(100, Math.max(1, parseInt(e.target.value) || 1)))}
                className="w-full px-3 py-1.5 bg-[#0c0c0c] border border-[#303030] rounded text-white text-xs focus:outline-none focus:border-gray-500"
              />
              <p className="text-[10px] text-gray-600">Maximum requests per minute (1-100)</p>
            </div>

            {/* Max Concurrent */}
            <div className="space-y-1">
              <label className="text-xs text-gray-300">Max Concurrent Requests</label>
              <input
                type="number" min={1} max={10}
                value={config.maxConcurrent}
                onChange={e => update('maxConcurrent', Math.min(10, Math.max(1, parseInt(e.target.value) || 1)))}
                className="w-full px-3 py-1.5 bg-[#0c0c0c] border border-[#303030] rounded text-white text-xs focus:outline-none focus:border-gray-500"
              />
              <p className="text-[10px] text-gray-600">Maximum simultaneous AI requests (1-10)</p>
            </div>

            {/* Request Timeout */}
            <div className="space-y-1">
              <label className="text-xs text-gray-300">Request Timeout (seconds)</label>
              <input
                type="number" min={10} max={300}
                value={config.requestTimeout}
                onChange={e => update('requestTimeout', Math.min(300, Math.max(10, parseInt(e.target.value) || 10)))}
                className="w-full px-3 py-1.5 bg-[#0c0c0c] border border-[#303030] rounded text-white text-xs focus:outline-none focus:border-gray-500"
              />
              <p className="text-[10px] text-gray-600">Time before request is aborted (10-300s)</p>
            </div>

            {/* Auto Retry */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs text-gray-300">Auto Retry</label>
                  <p className="text-[10px] text-gray-600">Automatically retry failed requests</p>
                </div>
                <button
                  onClick={() => update('autoRetry', !config.autoRetry)}
                  className={`relative w-10 h-5 rounded-full transition-colors ${
                    config.autoRetry ? 'bg-gray-600' : 'bg-[#303030]'
                  }`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                    config.autoRetry ? 'left-[22px]' : 'left-0.5'
                  }`} />
                </button>
              </div>

              {config.autoRetry && (
                <div className="space-y-1 pl-4 border-l-2 border-[#303030]">
                  <label className="text-xs text-gray-300">Retry Count</label>
                  <input
                    type="number" min={1} max={5}
                    value={config.retryCount}
                    onChange={e => update('retryCount', Math.min(5, Math.max(1, parseInt(e.target.value) || 1)))}
                    className="w-full px-3 py-1.5 bg-[#0c0c0c] border border-[#303030] rounded text-white text-xs focus:outline-none focus:border-gray-500"
                  />
                  <p className="text-[10px] text-gray-600">Number of retry attempts (1-5)</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white text-sm rounded hover:bg-gray-700 disabled:opacity-50 transition-colors"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Behavior Settings
        </button>
      </div>
    </div>
  );
}

function RadioOption({ name, value, selected, label, description, onChange }: {
  name: string; value: string; selected: string; label: string; description: string;
  onChange: () => void;
}) {
  return (
    <label className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition-colors ${
      selected === value ? 'border-gray-500 bg-gray-500/10' : 'border-[#303030] hover:border-[#404040]'
    }`}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={selected === value}
        onChange={onChange}
        className="mt-1 accent-gray-500"
      />
      <div>
        <p className="text-sm text-white font-medium">{label}</p>
        <p className="text-xs text-gray-500">{description}</p>
      </div>
    </label>
  );
}
