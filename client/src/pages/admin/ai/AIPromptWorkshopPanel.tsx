import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Play, GitCompare, Save, Pencil, Trash2, ArrowDownToLine } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';

interface Template {
  id: number;
  name: string;
  category: string;
  system_prompt: string;
  user_message: string;
}

interface TestResponse {
  content: string;
  latencyMs: number;
}

const CATEGORIES = ['all', 'dispatch', 'records', 'analysis', 'safety', 'general'] as const;

export default function AIPromptWorkshopPanel() {
  const [loading, setLoading] = useState(true);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [userMessage, setUserMessage] = useState('');
  const [tempOverride, setTempOverride] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [response, setResponse] = useState<TestResponse | null>(null);
  const [compareResponses, setCompareResponses] = useState<[TestResponse, TestResponse] | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState('general');
  const [saveName, setSaveName] = useState('');
  const [saveCategory, setSaveCategory] = useState('general');
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTemplates = useCallback(async () => {
    try {
      const data = await apiFetch<Template[]>('/ai/templates');
      setTemplates(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const runTest = async () => {
    if (!systemPrompt.trim() && !userMessage.trim()) return;
    setRunning(true);
    setResponse(null);
    setCompareResponses(null);
    setError(null);
    try {
      const data = await apiFetch<TestResponse>('/ai/prompt-test', {
        method: 'POST',
        body: JSON.stringify({
          systemPrompt,
          userMessage,
          temperature: tempOverride,
        }),
      });
      setResponse(data);
    } catch (err: any) {
      setError(err?.message || 'Test failed');
    } finally {
      setRunning(false);
    }
  };

  const runCompare = async () => {
    if (!systemPrompt.trim() && !userMessage.trim()) return;
    setComparing(true);
    setResponse(null);
    setCompareResponses(null);
    setError(null);
    try {
      const baseTemp = tempOverride ?? 0.7;
      const [low, high] = await Promise.all([
        apiFetch<TestResponse>('/ai/prompt-test', {
          method: 'POST',
          body: JSON.stringify({ systemPrompt, userMessage, temperature: Math.max(0, baseTemp - 0.1) }),
        }),
        apiFetch<TestResponse>('/ai/prompt-test', {
          method: 'POST',
          body: JSON.stringify({ systemPrompt, userMessage, temperature: Math.min(2, baseTemp + 0.3) }),
        }),
      ]);
      setCompareResponses([low, high]);
    } catch (err: any) {
      setError(err?.message || 'Compare failed');
    } finally {
      setComparing(false);
    }
  };

  const loadTemplate = (t: Template) => {
    setSystemPrompt(t.system_prompt);
    setUserMessage(t.user_message);
    setResponse(null);
    setCompareResponses(null);
  };

  const saveAsTemplate = async () => {
    if (!saveName.trim()) return;
    try {
      await apiFetch('/ai/templates', {
        method: 'POST',
        body: JSON.stringify({
          name: saveName.trim(),
          category: saveCategory,
          system_prompt: systemPrompt,
          user_message: userMessage,
        }),
      });
      setSaveName('');
      setShowSaveForm(false);
      await fetchTemplates();
    } catch (err: any) {
      setError(err?.message || 'Failed to save template');
    }
  };

  const updateTemplate = async (id: number) => {
    try {
      await apiFetch(`/ai/templates/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: editName, category: editCategory }),
      });
      setEditingId(null);
      await fetchTemplates();
    } catch (err: any) {
      setError(err?.message || 'Failed to update template');
    }
  };

  const deleteTemplate = async (id: number) => {
    try {
      await apiFetch(`/ai/templates/${id}`, { method: 'DELETE' });
      await fetchTemplates();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete template');
    }
  };

  const filteredTemplates = categoryFilter === 'all'
    ? templates
    : templates.filter(t => t.category === categoryFilter);

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

      {/* Prompt Sandbox */}
      <div className="bg-[#0a0a0a] border border-[#222222] rounded p-4 space-y-4">
        <h3 className="text-sm font-semibold text-white">Prompt Sandbox</h3>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">System Prompt</label>
            <textarea
              rows={4}
              value={systemPrompt}
              onChange={e => setSystemPrompt(e.target.value)}
              placeholder="You are a law enforcement AI assistant..."
              className="w-full px-3 py-2 bg-[#050505] border border-[#222222] rounded text-white text-xs placeholder-gray-600 focus:outline-none focus:border-gray-500 resize-none"
            />
          </div>

          <div>
            <label className="text-xs text-gray-400 mb-1 block">User Message</label>
            <textarea
              rows={3}
              value={userMessage}
              onChange={e => setUserMessage(e.target.value)}
              placeholder="Summarize this incident report..."
              className="w-full px-3 py-2 bg-[#050505] border border-[#222222] rounded text-white text-xs placeholder-gray-600 focus:outline-none focus:border-gray-500 resize-none"
            />
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-gray-500">Temp override:</label>
              <input
                type="range"
                min={0} max={2} step={0.05}
                value={tempOverride ?? 0.7}
                onChange={e => setTempOverride(parseFloat(e.target.value))}
                className="w-24 h-1 bg-[#222222] rounded appearance-none cursor-pointer accent-[#888888]"
              />
              <span className="text-[10px] text-gray-400 font-mono w-8">{tempOverride?.toFixed(2) ?? '—'}</span>
              {tempOverride !== null && (
                <button onClick={() => setTempOverride(null)} className="text-[10px] text-gray-600 hover:text-gray-400">clear</button>
              )}
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={runTest}
                disabled={running || comparing || (!systemPrompt.trim() && !userMessage.trim())}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-600 text-white rounded hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                Run Test
              </button>
              <button
                onClick={runCompare}
                disabled={running || comparing || (!systemPrompt.trim() && !userMessage.trim())}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[#222222] text-gray-300 rounded hover:bg-[#2e2e2e] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {comparing ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitCompare className="w-3 h-3" />}
                Compare
              </button>
            </div>
          </div>
        </div>

        {/* Single response */}
        {response && (
          <div className="bg-[#050505] border border-[#222222] rounded p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-500">Response</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 bg-gray-600/20 text-gray-400 rounded">{response.latencyMs}ms</span>
            </div>
            <p className="text-xs text-gray-300 whitespace-pre-wrap">{response.content}</p>
          </div>
        )}

        {/* Side-by-side compare */}
        {compareResponses && (
          <div className="grid grid-cols-2 gap-3">
            {compareResponses.map((r, i) => {
              const baseTemp = tempOverride ?? 0.7;
              const label = i === 0 ? `Temp ${Math.max(0, baseTemp - 0.1).toFixed(2)}` : `Temp ${Math.min(2, baseTemp + 0.3).toFixed(2)}`;
              return (
                <div key={i} className="bg-[#050505] border border-[#222222] rounded p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-500">{label}</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 bg-gray-600/20 text-gray-400 rounded">{r.latencyMs}ms</span>
                  </div>
                  <p className="text-xs text-gray-300 whitespace-pre-wrap">{r.content}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Template Library */}
      <div className="bg-[#0a0a0a] border border-[#222222] rounded p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Template Library</h3>
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="px-2 py-1 bg-[#050505] border border-[#222222] rounded text-xs text-gray-300 focus:outline-none focus:border-gray-500"
          >
            {CATEGORIES.map(c => (
              <option key={c} value={c}>{c === 'all' ? 'All Categories' : c.charAt(0).toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
        </div>

        {filteredTemplates.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-72 overflow-y-auto">
            {filteredTemplates.map(t => (
              <div key={t.id} className="bg-[#050505] border border-[#222222] rounded p-3 space-y-2">
                {editingId === t.id ? (
                  <div className="space-y-2">
                    <input
                      type="text" value={editName} onChange={e => setEditName(e.target.value)}
                      className="w-full px-2 py-1 bg-[#0a0a0a] border border-[#222222] rounded text-white text-xs focus:outline-none focus:border-gray-500"
                    />
                    <select
                      value={editCategory} onChange={e => setEditCategory(e.target.value)}
                      className="w-full px-2 py-1 bg-[#0a0a0a] border border-[#222222] rounded text-gray-300 text-xs focus:outline-none"
                    >
                      {CATEGORIES.filter(c => c !== 'all').map(c => (
                        <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                      ))}
                    </select>
                    <div className="flex gap-1">
                      <button onClick={() => updateTemplate(t.id)} className="px-2 py-1 text-[10px] bg-gray-600/20 text-gray-400 rounded hover:bg-gray-600/30">Save</button>
                      <button onClick={() => setEditingId(null)} className="px-2 py-1 text-[10px] text-gray-500 hover:text-gray-300">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white truncate flex-1">{t.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 bg-[#222222] text-gray-400 rounded shrink-0">{(t.category || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</span>
                    </div>
                    <p className="text-[10px] text-gray-600 line-clamp-2">{t.system_prompt.slice(0, 80)}{t.system_prompt.length > 80 ? '...' : ''}</p>
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => loadTemplate(t)} className="flex items-center gap-1 px-2 py-1 text-[10px] bg-gray-600/20 text-gray-400 rounded hover:bg-gray-600/30">
                        <ArrowDownToLine className="w-3 h-3" /> Load
                      </button>
                      <button onClick={() => { setEditingId(t.id); setEditName(t.name); setEditCategory(t.category); }}
                        className="flex items-center gap-1 px-2 py-1 text-[10px] text-gray-500 hover:text-gray-300">
                        <Pencil className="w-3 h-3" /> Edit
                      </button>
                      <button onClick={() => deleteTemplate(t.id)}
                        className="flex items-center gap-1 px-2 py-1 text-[10px] text-gray-500 hover:text-red-400">
                        <Trash2 className="w-3 h-3" /> Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-600">No templates found.</p>
        )}

        {/* Save as template */}
        {showSaveForm ? (
          <div className="flex items-center gap-2 pt-2 border-t border-[#222222]">
            <input
              type="text" value={saveName} onChange={e => setSaveName(e.target.value)}
              placeholder="Template name..."
              className="flex-1 px-3 py-1.5 bg-[#050505] border border-[#222222] rounded text-white text-xs placeholder-gray-600 focus:outline-none focus:border-gray-500"
            />
            <select
              value={saveCategory} onChange={e => setSaveCategory(e.target.value)}
              className="px-2 py-1.5 bg-[#050505] border border-[#222222] rounded text-gray-300 text-xs focus:outline-none"
            >
              {CATEGORIES.filter(c => c !== 'all').map(c => (
                <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
              ))}
            </select>
            <button onClick={saveAsTemplate} disabled={!saveName.trim()}
              className="px-3 py-1.5 text-xs bg-gray-600 text-white rounded hover:bg-gray-700 disabled:opacity-40 transition-colors">
              Save
            </button>
            <button onClick={() => setShowSaveForm(false)} className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-300">Cancel</button>
          </div>
        ) : (
          <button onClick={() => setShowSaveForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[#222222] text-gray-300 rounded hover:bg-[#2e2e2e] transition-colors">
            <Save className="w-3 h-3" /> Save as Template
          </button>
        )}
      </div>
    </div>
  );
}
