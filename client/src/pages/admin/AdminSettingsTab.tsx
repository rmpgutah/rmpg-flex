import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { loadSystemSettings } from '../../utils/systemSettings';
import { useToast } from '../../components/ToastProvider';
import { Settings, RotateCcw, Save, Check, Eye, ChevronDown, RefreshCw } from 'lucide-react';

interface SettingItem {
  key: string; value: string | null; default_value: string | null;
  type: string; label: string; description: string | null;
  category: string; options: string | null;
  min_value: number | null; max_value: number | null; ui_order: number;
}

interface Props { LoadingSpinner: React.ComponentType }

const CATEGORY_LABELS: Record<string, string> = {
  branding: 'Branding & Appearance',
  display: 'Display & Theme',
  dispatch: 'CAD / Dispatch',
  notifications: 'Notifications',
  security: 'Security & Auth',
  records: 'Records & Data',
  maps: 'Maps & GPS',
  reports: 'Reports & Printing',
  ai: 'AI & Voice',
  evidence: 'Evidence & Property',
  integrations: 'Integrations & API',
  fleet: 'Fleet & GPS',
  training: 'Training & Certification',
  shift: 'Shift & Schedule',
  audit: 'Audit & Logging',
  email_templates: 'Email Templates',
  system: 'System & Maintenance',
};

export default function AdminSettingsTab(_props: Props) {
  const [categories, setCategories] = useState<string[]>([]);
  const [settings, setSettings] = useState<Record<string, SettingItem[]>>({});
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState('branding');
  const [search, setSearch] = useState('');
  const { addToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await apiFetch<{ categories: string[]; settings: Record<string, SettingItem[]> }>('/admin/settings');
      setCategories(data.categories || []);
      setSettings(data.settings || {});
      const vals: Record<string, string> = {};
      for (const cat of Object.values(data.settings || {})) {
        for (const s of cat) {
          vals[s.key] = s.value ?? s.default_value ?? '';
        }
      }
      setEditValues(vals);
    } catch (err) { setError('Failed to load settings'); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const updateValue = (key: string, value: string) => {
    setEditValues(prev => ({ ...prev, [key]: value }));
  };

  const saveAll = useCallback(async () => {
    setSaving(true);
    try {
      await apiFetch('/admin/settings', { method: 'PUT', body: JSON.stringify(editValues) });
      // Refresh the org-wide system-settings cache so branding/display/
      // localization changes apply immediately (re-applies Display to the
      // document root) instead of only on next login.
      await loadSystemSettings();
      addToast('Settings saved', 'success');
    } catch (err) { addToast('Failed to save settings', 'error'); }
    finally { setSaving(false); }
  }, [editValues, addToast]);

  const resetAll = useCallback(async () => {
    if (!confirm('Reset all settings to their default values? This cannot be undone.')) return;
    setSaving(true);
    try {
      await apiFetch('/admin/settings/reset', { method: 'POST' });
      addToast('Settings reset to defaults', 'success');
      load();
    } catch (err) { addToast('Failed to reset settings', 'error'); }
    finally { setSaving(false); }
  }, [addToast, load]);

  const filteredSettings = Object.entries(settings).filter(([cat]) => {
    if (search) {
      return (settings[cat] || []).some(s =>
        (s.label || '').toLowerCase().includes(search.toLowerCase()) ||
        (s.description || '').toLowerCase().includes(search.toLowerCase()) ||
        s.key.toLowerCase().includes(search.toLowerCase())
      );
    }
    return true;
  });

  if (loading) return <div className="flex items-center justify-center py-20"><RefreshCw className="animate-spin text-accent-silver-500" size={20} /></div>;
  if (error) return <div className="flex flex-col items-center justify-center py-20"><p className="text-[10px] text-red-300 mb-3">{error}</p><button onClick={load} className="btn-gold"><RefreshCw size={12} /> Retry</button></div>;

  return (
    <div className="flex flex-col h-full">
      {/* Action Bar */}
      <div className="flex items-center gap-3 p-3 bg-surface-overlay border-b border-border-subtle">
        <Settings size={14} color="var(--accent-silver-500)" />
        <span className="text-[10px] font-bold uppercase text-[color:var(--panel-header-color)] tracking-wider flex-1">System Settings</span>
        <input id="ff-adminsettingstab-0"
          type="text" placeholder="Search settings..."
          value={search} onChange={e => setSearch(e.target.value)}
          className="px-3 py-1.5 text-[10px] bg-surface-sunken border border-border-subtle text-rmpg-400 w-48 focus:border-accent-silver-500"
        />
        <button onClick={resetAll} disabled={saving} className="btn-secondary btn-xs flex items-center gap-1"><RotateCcw size={10} />Reset</button>
        <button onClick={saveAll} disabled={saving} className="btn-gold btn-xs flex items-center gap-1"><Save size={10} />{saving ? 'Saving...' : 'Save All'}</button>
      </div>

      {/* Honesty note: which categories are wired to actually affect the app. */}
      <div className="px-3 py-1.5 bg-surface-sunken border-b border-border-subtle text-[9px] text-text-muted leading-relaxed">
        <span className="text-[color:var(--field-label-color)] font-bold uppercase tracking-wider">Live-applied:</span>{' '}
        Branding (agency name, colors, classification &amp; watermark on all reports/PDFs); Display &amp; Theme
        (CRT scanline/vignette, animations, high-contrast, amber/green phosphor, grid lines, status bar, date/time format).
        Other settings are saved but not yet consumed everywhere — wiring continues per release.
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Category Nav */}
        <div className="w-48 bg-surface-deep border-r border-border-subtle overflow-y-auto flex-shrink-0">
          {filteredSettings.map(([cat]) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`w-full text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wider border-l-3 transition-all ${
                activeCategory === cat
                  ? 'text-accent-silver-500 border-l-[3px] border-l-accent-silver-500 bg-accent-silver-500/[0.06]'
                  : 'text-rmpg-500 border-l-[3px] border-l-transparent hover:text-rmpg-400 hover:bg-[rgba(255,255,255,0.02)]'
              }`}
            >
              {CATEGORY_LABELS[cat] || cat}
              <span className="block text-[8px] text-rmpg-500 normal-case font-normal mt-0.5">{(settings[cat] || []).length} settings</span>
            </button>
          ))}
        </div>

        {/* Settings Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-6">
          {activeCategory && settings[activeCategory] && (
            <div className="space-y-4 max-w-2xl">
              <h2 className="text-[11px] font-bold uppercase text-[color:var(--panel-header-color)] tracking-wider border-b border-border-subtle pb-2 mb-4">
                {CATEGORY_LABELS[activeCategory] || activeCategory}
              </h2>
              {(settings[activeCategory] || []).map((setting) => (
                <div key={setting.key} className="flex items-start gap-4 py-3 border-b border-border-subtle">
                  <div className="flex-1 min-w-0">
                    <label htmlFor="ff-adminsettingstab-2" className="text-[10px] font-semibold text-rmpg-300 block">{setting.label}</label>
                    {setting.description && (
                      <p className="text-[9px] text-rmpg-500 mt-0.5">{setting.description}</p>
                    )}
                    <p className="text-[8px] text-rmpg-500 font-mono mt-0.5">{setting.key}</p>
                  </div>
                  <div className="flex-shrink-0" style={{ minWidth: '200px' }}>
                    {setting.type === 'boolean' ? (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input id="ff-adminsettingstab-1"
                          type="checkbox"
                          checked={editValues[setting.key] === 'true'}
                          onChange={e => updateValue(setting.key, e.target.checked ? 'true' : 'false')}
                          className="w-3.5 h-3.5"
                        />
                        <span className="text-[10px] text-fg-muted">Enabled</span>
                      </label>
                    ) : setting.type === 'select' && setting.options ? (
                      <select id="ff-adminsettingstab-2"
                        value={editValues[setting.key] || ''}
                        onChange={e => updateValue(setting.key, e.target.value)}
                        className="w-full px-2 py-1.5 text-[10px] bg-surface-sunken border border-border-subtle text-rmpg-400 focus:border-accent-silver-500"
                      >
                        {(() => { try { return JSON.parse(setting.options) as string[]; } catch { return []; } })().map((opt: string) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ) : setting.type === 'color' ? (
                      <div className="flex items-center gap-2">
                        <input id="ff-adminsettingstab-3"
                          type="color"
                          value={editValues[setting.key] || ''}
                          onChange={e => updateValue(setting.key, e.target.value)}
                          className="w-8 h-8 bg-transparent border border-border-subtle cursor-pointer p-0"
                        />
                        <input id="ff-adminsettingstab-4"
                          type="text"
                          value={editValues[setting.key] || ''}
                          onChange={e => updateValue(setting.key, e.target.value)}
                          className="flex-1 px-2 py-1.5 text-[10px] bg-surface-sunken border border-border-subtle text-rmpg-400 font-mono focus:border-accent-silver-500"
                        />
                      </div>
                    ) : setting.type === 'number' ? (
                      <input id="ff-adminsettingstab-5"
                        type="number"
                        value={editValues[setting.key] || ''}
                        onChange={e => updateValue(setting.key, e.target.value)}
                        min={setting.min_value ?? undefined}
                        max={setting.max_value ?? undefined}
                        className="w-full px-2 py-1.5 text-[10px] bg-surface-sunken border border-border-subtle text-rmpg-400 font-mono focus:border-accent-silver-500"
                      />
                    ) : (
                      <input id="ff-adminsettingstab-6"
                        type="text"
                        value={editValues[setting.key] || ''}
                        onChange={e => updateValue(setting.key, e.target.value)}
                        className="w-full px-2 py-1.5 text-[10px] bg-surface-sunken border border-border-subtle text-rmpg-400 focus:border-accent-silver-500"
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
