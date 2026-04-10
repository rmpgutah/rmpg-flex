import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Save, Trash2, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';

interface ModelParams {
  temperature: number;
  maxTokens: number;
  topP: number;
  repeatPenalty: number;
}

interface FeatureOverride {
  temperature?: number | null;
  maxTokens?: number | null;
  topP?: number | null;
  repeatPenalty?: number | null;
}

interface Preset {
  id: number;
  name: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  repeatPenalty: number;
}

const FEATURES = ['callAnalysis', 'narrativeAssist', 'unitSuggestions', 'safetyBriefings', 'dataCleanup', 'general'] as const;
type FeatureName = typeof FEATURES[number];

const FEATURE_LABELS: Record<FeatureName, string> = {
  callAnalysis: 'Call Analysis',
  narrativeAssist: 'Narrative Assist',
  unitSuggestions: 'Unit Suggestions',
  safetyBriefings: 'Safety Briefings',
  dataCleanup: 'Data Cleanup',
  general: 'General',
};

export default function AIModelTuningPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [defaults, setDefaults] = useState<ModelParams>({ temperature: 0.7, maxTokens: 1024, topP: 0.9, repeatPenalty: 1.0 });
  const [featureParams, setFeatureParams] = useState<Record<FeatureName, FeatureOverride>>(() => {
    const init: Record<string, FeatureOverride> = {};
    FEATURES.forEach(f => { init[f] = {}; });
    return init as Record<FeatureName, FeatureOverride>;
  });
  const [presets, setPresets] = useState<Preset[]>([]);
  const [newPresetName, setNewPresetName] = useState('');
  const [overridesOpen, setOverridesOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [paramsData, presetsData] = await Promise.all([
        apiFetch<{ defaultParams: ModelParams; featureParams: Record<FeatureName, FeatureOverride> }>('/ai/model-params'),
        apiFetch<Preset[]>('/ai/presets'),
      ]);
      setDefaults(paramsData.defaultParams);
      if (paramsData.featureParams) {
        // Merge with defaults so every feature key exists
        const merged: Record<string, FeatureOverride> = {};
        FEATURES.forEach(f => { merged[f] = paramsData.featureParams[f] || {}; });
        setFeatureParams(merged as Record<FeatureName, FeatureOverride>);
      }
      setPresets(presetsData);
    } catch (err: any) {
      setError(err?.message || 'Failed to load model parameters');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiFetch('/ai/model-params', {
        method: 'PUT',
        body: JSON.stringify({ defaultParams: defaults, featureParams }),
      });
    } catch (err: any) {
      setError(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleApplyPreset = (preset: Preset) => {
    setDefaults({
      temperature: preset.temperature,
      maxTokens: preset.maxTokens,
      topP: preset.topP,
      repeatPenalty: preset.repeatPenalty,
    });
  };

  const handleSavePreset = async () => {
    if (!newPresetName.trim()) return;
    try {
      await apiFetch('/ai/presets', {
        method: 'POST',
        body: JSON.stringify({ name: newPresetName.trim(), ...defaults }),
      });
      setNewPresetName('');
      await fetchData();
    } catch (err: any) {
      setError(err?.message || 'Failed to save preset');
    }
  };

  const handleDeletePreset = async (id: number) => {
    try {
      await apiFetch(`/ai/presets/${id}`, { method: 'DELETE' });
      setDeleteConfirm(null);
      await fetchData();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete preset');
    }
  };

  const updateFeatureOverride = (feature: FeatureName, key: keyof FeatureOverride, raw: string) => {
    setFeatureParams(prev => ({
      ...prev,
      [feature]: {
        ...(prev[feature] || {}),
        [key]: raw === '' ? null : parseFloat(raw),
      },
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-xs">{error}</div>
      )}

      {/* Default Parameters */}
      <div className="bg-[#161b21] border border-[#1a3550] rounded p-4 space-y-4">
        <h3 className="text-sm font-semibold text-white">Default Parameters</h3>

        <Slider label="Temperature" description="Controls randomness. Lower = more deterministic."
          value={defaults.temperature} min={0} max={2} step={0.05}
          onChange={v => setDefaults(p => ({ ...p, temperature: v }))} />

        <Slider label="Max Tokens" description="Maximum response length."
          value={defaults.maxTokens} min={128} max={4096} step={64}
          onChange={v => setDefaults(p => ({ ...p, maxTokens: v }))} />

        <Slider label="Top P" description="Nucleus sampling threshold."
          value={defaults.topP} min={0} max={1} step={0.05}
          onChange={v => setDefaults(p => ({ ...p, topP: v }))} />

        <Slider label="Repeat Penalty" description="Penalizes repeated phrases."
          value={defaults.repeatPenalty} min={0.5} max={2} step={0.05}
          onChange={v => setDefaults(p => ({ ...p, repeatPenalty: v }))} />
      </div>

      {/* Per-Feature Overrides */}
      <div className="bg-[#161b21] border border-[#1a3550] rounded">
        <button
          onClick={() => setOverridesOpen(!overridesOpen)}
          className="w-full flex items-center justify-between p-4 text-sm font-semibold text-white hover:bg-[#1b2128] transition-colors"
        >
          <span>Per-Feature Overrides</span>
          {overridesOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
        </button>

        {overridesOpen && (
          <div className="px-4 pb-4 space-y-2">
            <p className="text-[10px] text-gray-600 mb-3">Feature-specific overrides (empty = use defaults)</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-[#1a3550]">
                    <th className="text-left py-2 pr-4 font-medium">Feature</th>
                    <th className="text-left py-2 px-2 font-medium">Temperature</th>
                    <th className="text-left py-2 px-2 font-medium">Max Tokens</th>
                    <th className="text-left py-2 px-2 font-medium">Top P</th>
                    <th className="text-left py-2 px-2 font-medium">Repeat Penalty</th>
                  </tr>
                </thead>
                <tbody>
                  {FEATURES.map(feature => (
                    <tr key={feature} className="border-b border-[#1a3550]/50">
                      <td className="py-2 pr-4 text-gray-300">{FEATURE_LABELS[feature]}</td>
                      {(['temperature', 'maxTokens', 'topP', 'repeatPenalty'] as const).map(key => (
                        <td key={key} className="py-2 px-2">
                          <input
                            type="number"
                            step={key === 'maxTokens' ? 64 : 0.05}
                            value={(featureParams[feature] || {})[key] ?? ''}
                            onChange={e => updateFeatureOverride(feature, key, e.target.value)}
                            placeholder="—"
                            className="w-20 px-2 py-1 bg-[#0c0f13] border border-[#1a3550] rounded text-white text-xs placeholder-gray-700 focus:outline-none focus:border-blue-500"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Presets */}
      <div className="bg-[#161b21] border border-[#1a3550] rounded p-4 space-y-4">
        <h3 className="text-sm font-semibold text-white">Presets</h3>

        {presets.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {presets.map(preset => (
              <div key={preset.id} className="bg-[#0c0f13] border border-[#1a3550] rounded p-3 space-y-2">
                <p className="text-sm font-medium text-white">{preset.name}</p>
                <div className="grid grid-cols-2 gap-1 text-[10px] text-gray-500">
                  <span>Temp: <span className="text-blue-400 font-mono">{preset.temperature}</span></span>
                  <span>Tokens: <span className="text-blue-400 font-mono">{preset.maxTokens}</span></span>
                  <span>Top P: <span className="text-blue-400 font-mono">{preset.topP}</span></span>
                  <span>Repeat: <span className="text-blue-400 font-mono">{preset.repeatPenalty}</span></span>
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => handleApplyPreset(preset)}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] bg-blue-600/20 text-blue-400 rounded hover:bg-blue-600/30 transition-colors"
                  >
                    <Check className="w-3 h-3" /> Apply
                  </button>
                  {deleteConfirm === preset.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleDeletePreset(preset.id)}
                        className="px-2 py-1 text-[10px] bg-red-600/20 text-red-400 rounded hover:bg-red-600/30"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(null)}
                        className="px-2 py-1 text-[10px] text-gray-500 hover:text-gray-300"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirm(preset.id)}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] text-gray-500 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" /> Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-600">No presets saved yet.</p>
        )}

        <div className="flex items-center gap-2 pt-2 border-t border-[#1a3550]">
          <input
            type="text"
            value={newPresetName}
            onChange={e => setNewPresetName(e.target.value)}
            placeholder="Preset name..."
            className="flex-1 px-3 py-1.5 bg-[#0c0f13] border border-[#1a3550] rounded text-white text-xs placeholder-gray-600 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={handleSavePreset}
            disabled={!newPresetName.trim()}
            className="px-3 py-1.5 text-xs bg-[#1a3550] text-gray-300 rounded hover:bg-[#2a4560] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Save Current as Preset
          </button>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Parameters
        </button>
      </div>
    </div>
  );
}

function Slider({ label, description, value, min, max, step, onChange }: {
  label: string; description: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <label className="text-gray-300">{label}</label>
        <span className="text-blue-400 font-mono">{value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 bg-[#1a3550] rounded appearance-none cursor-pointer accent-blue-500" />
      <p className="text-[10px] text-gray-600">{description}</p>
    </div>
  );
}
