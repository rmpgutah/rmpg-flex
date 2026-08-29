import { useState, useEffect, useMemo } from 'react';
import { apiFetch } from '../hooks/useApi';
import { asArray } from '../utils/asArray';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';
import { parseTimestamp } from '../utils/dateUtils';
import { formatEnumValue, toDisplayLabel } from '../utils/formatters';
import { briefingsToCsv, downloadTextFile } from '../utils/rmsListExport';
import {
  FileText, Clock, Users, Shield, AlertTriangle,
  Plus, RefreshCw, Check, Sun, Moon, Sunset, Download, Copy, Search,
} from 'lucide-react';

interface Briefing {
  id: number;
  briefing_number: string;
  title: string;
  shift_type: 'day' | 'swing' | 'night';
  created_at: string;
  created_by: string;
  content: string;
  acknowledged_count: number;
  total_officers: number;
}

interface GeneratedBriefing {
  active_bulletins: { id: number; title: string; priority: string }[];
  critical_calls: { call_number: string; incident_type: string; priority: string; time: string }[];
  high_priority_warrants: { warrant_number: string; subject: string; charges: string }[];
  premise_alerts: { address: string; alert_type: string; notes: string }[];
  recent_arrests: { name: string; charges: string; arrest_time: string }[];
  units_on_duty: { unit_id: string; officer_name: string; status: string }[];
}

interface SafetyAlert {
  id: number;
  type: 'premise' | 'weapons_call';
  location: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
  created_at: string;
}

function getCurrentShift(): { type: 'day' | 'swing' | 'night'; start: string; end: string } {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 14) return { type: 'day', start: '06:00', end: '14:00' };
  if (hour >= 14 && hour < 22) return { type: 'swing', start: '14:00', end: '22:00' };
  return { type: 'night', start: '22:00', end: '06:00' };
}

function shiftIcon(type: string) {
  if (type === 'day') return <Sun className="w-4 h-4 text-yellow-400" />;
  if (type === 'swing') return <Sunset className="w-4 h-4 text-orange-400" />;
  return <Moon className="w-4 h-4 text-blue-300" />;
}

export default function ShiftBriefingsPage() {
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [generated, setGenerated] = useState<GeneratedBriefing | null>(null);
  const [safetyAlerts, setSafetyAlerts] = useState<SafetyAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [safetyExpanded, setSafetyExpanded] = useState(true);
  const [manualTitle, setManualTitle] = useState('');
  const [manualContent, setManualContent] = useState('');
  const [showManualForm, setShowManualForm] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [histSearch, setHistSearch] = useState('');
  const [shiftFilter, setShiftFilter] = useState<'all' | 'day' | 'swing' | 'night'>('all');

  const currentShift = getCurrentShift();

  useEffect(() => {
    loadBriefings();
    loadSafetyAlerts();
  }, []);

  async function loadBriefings() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiFetch<Briefing[]>('/api/shift-briefings');
      setBriefings(asArray<Briefing>(data));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load briefings');
    } finally {
      setLoading(false);
    }
  }

  async function loadSafetyAlerts() {
    try {
      const data = await apiFetch<SafetyAlert[]>('/api/shift-briefings/officer-safety/alerts');
      setSafetyAlerts(asArray<SafetyAlert>(data));
    } catch (err) {
      console.error('Failed to load safety alerts', err);
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    try {
      const data = await apiFetch<GeneratedBriefing>('/api/shift-briefings/generate');
      setGenerated(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to generate briefing');
    } finally {
      setGenerating(false);
    }
  }

  async function handleSaveGenerated() {
    if (!generated) return;
    setSaving(true);
    try {
      await apiFetch('/api/shift-briefings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shift_type: currentShift.type,
          title: `${currentShift.type.toUpperCase()} Shift Briefing - ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Denver' })}`,
          content: JSON.stringify(generated),
        }),
      });
      setGenerated(null);
      loadBriefings();
    } catch (err) {
      console.error('Failed to save briefing', err);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveManual() {
    if (!manualTitle.trim() || !manualContent.trim()) return;
    setSaving(true);
    try {
      await apiFetch('/api/shift-briefings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shift_type: currentShift.type,
          title: manualTitle,
          content: manualContent,
        }),
      });
      setManualTitle('');
      setManualContent('');
      setShowManualForm(false);
      loadBriefings();
    } catch (err) {
      console.error('Failed to save manual briefing', err);
    } finally {
      setSaving(false);
    }
  }

  const visibleBriefings = useMemo(() => {
    const q = histSearch.trim().toLowerCase();
    const filtered = briefings.filter((b) => {
      if (shiftFilter !== 'all' && b.shift_type !== shiftFilter) return false;
      if (!q) return true;
      return b.title.toLowerCase().includes(q) || b.briefing_number.toLowerCase().includes(q) || b.created_by.toLowerCase().includes(q);
    });
    return [...filtered].sort((a, b) => {
      const pin = (x: Briefing) => (x.shift_type === currentShift.type ? 0 : 1);
      return pin(a) - pin(b);
    });
  }, [briefings, histSearch, shiftFilter, currentShift.type]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName);
      if (e.key === 'Escape') {
        setShowManualForm(false);
        setGenerated(null);
        setExpandedId(null);
      }
      if (typing) return;
      if (e.key === 'n' || e.key === 'N') setShowManualForm(true);
      if (e.key === 'g' || e.key === 'G') handleGenerate();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="p-4 space-y-4 bg-surface-base min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-[color:var(--panel-header-color)] tracking-wide">SHIFT BRIEFINGS</h1>
        <div className="flex gap-2">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-surface-raised border border-border-default rounded-sm text-text-primary hover:border-brand-400 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${generating ? 'animate-spin' : ''}`} />
            Generate Briefing
          </button>
          <button
            onClick={() => setShowManualForm(!showManualForm)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-surface-raised border border-border-default rounded-sm text-text-primary hover:border-brand-400"
          >
            <Plus className="w-3.5 h-3.5" />
            New Manual Briefing
          </button>
        </div>
      </div>

      {loadError && (
        <div className="text-[11px] px-3 py-2 border border-red-700/40 bg-red-900/20 text-red-400 flex justify-between" role="alert">
          <span>{loadError}</span>
          <button type="button" onClick={loadBriefings} className="underline">Retry</button>
        </div>
      )}

      {/* Current Shift Info */}
      <div className="bg-surface-raised border border-border-default rounded-sm p-3">
        <PanelTitleBar title="CURRENT SHIFT" icon={Clock} />
        <div className="mt-2 flex items-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            {shiftIcon(currentShift.type)}
            <span className="text-neutral-200 font-medium uppercase">{currentShift.type} Shift</span>
          </div>
          <div className="text-neutral-400 font-mono text-xs">
            {currentShift.start} – {currentShift.end}
          </div>
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
            <span className="text-red-400 text-xs font-medium">
              {safetyAlerts.length} Safety Alert{safetyAlerts.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </div>

      {/* Manual Briefing Form */}
      {showManualForm && (
        <div className="bg-surface-raised border border-border-default rounded-sm p-3 space-y-3">
          <PanelTitleBar title="NEW MANUAL BRIEFING" icon={FileText} />
          <input
            type="text"
            placeholder="Briefing title..."
            value={manualTitle}
            onChange={(e) => setManualTitle(e.target.value)}
            className="w-full px-2 py-1.5 text-sm bg-surface-sunken border border-border-default rounded-sm text-text-primary placeholder-fg-muted focus:border-brand-400 outline-none"
          />
          <textarea
            placeholder="Briefing content..."
            value={manualContent}
            onChange={(e) => setManualContent(e.target.value)}
            rows={6}
            className="w-full px-2 py-1.5 text-sm bg-surface-sunken border border-border-default rounded-sm text-text-primary placeholder-fg-muted focus:border-brand-400 outline-none resize-y font-mono"
          />
          <button
            onClick={handleSaveManual}
            disabled={saving || !manualTitle.trim() || !manualContent.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-surface-raised border border-brand-400 text-text-primary rounded-sm hover:bg-brand-400/10 disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" />
            Save Briefing
          </button>
        </div>
      )}

      {/* Generated Briefing */}
      {generated && (
        <div className="bg-surface-raised border border-border-default rounded-sm p-3 space-y-3">
          <div className="flex items-center justify-between">
            <PanelTitleBar title="GENERATED BRIEFING" icon={FileText} />
            <button
              onClick={handleSaveGenerated}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-surface-raised border border-brand-400 text-text-primary rounded-sm hover:bg-brand-400/10 disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" />
              Save Briefing
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Active Bulletins */}
            <div className="bg-surface-sunken border border-border-default rounded-sm p-2">
              <h4 className="text-xs font-semibold text-[color:var(--panel-header-color)] mb-1.5">ACTIVE BULLETINS</h4>
              {generated.active_bulletins.length === 0 ? (
                <p className="text-xs text-neutral-500">None</p>
              ) : (
                generated.active_bulletins.map((b) => (
                  <div key={b.id} className="text-xs text-neutral-300 py-0.5 border-b border-border-muted last:border-0">
                    <span className="text-neutral-400">[{b.priority}]</span> {b.title}
                  </div>
                ))
              )}
            </div>

            {/* Critical Calls */}
            <div className="bg-surface-sunken border border-border-default rounded-sm p-2">
              <h4 className="text-xs font-semibold text-[color:var(--panel-header-color)] mb-1.5">CRITICAL CALLS (12H)</h4>
              {generated.critical_calls.length === 0 ? (
                <p className="text-xs text-neutral-500">None</p>
              ) : (
                generated.critical_calls.map((c) => (
                  <div key={c.call_number} className="text-xs text-neutral-300 py-0.5 border-b border-border-muted last:border-0">
                    <span className="font-mono text-neutral-400">{c.call_number}</span> {formatEnumValue(c.incident_type)}
                    <span className="ml-1 text-neutral-500">{c.time}</span>
                  </div>
                ))
              )}
            </div>

            {/* High-Priority Warrants */}
            <div className="bg-surface-sunken border border-border-default rounded-sm p-2">
              <h4 className="text-xs font-semibold text-[color:var(--panel-header-color)] mb-1.5">HIGH-PRIORITY WARRANTS</h4>
              {generated.high_priority_warrants.length === 0 ? (
                <p className="text-xs text-neutral-500">None</p>
              ) : (
                generated.high_priority_warrants.map((w) => (
                  <div key={w.warrant_number} className="text-xs text-neutral-300 py-0.5 border-b border-border-muted last:border-0">
                    <span className="font-mono text-neutral-400">{w.warrant_number}</span> {w.subject} — {w.charges}
                  </div>
                ))
              )}
            </div>

            {/* Premise Alerts */}
            <div className="bg-surface-sunken border border-border-default rounded-sm p-2">
              <h4 className="text-xs font-semibold text-[color:var(--panel-header-color)] mb-1.5">PREMISE ALERTS</h4>
              {generated.premise_alerts.length === 0 ? (
                <p className="text-xs text-neutral-500">None</p>
              ) : (
                generated.premise_alerts.map((p, i) => (
                  <div key={i} className="text-xs text-neutral-300 py-0.5 border-b border-border-muted last:border-0">
                    <span className="text-neutral-400">{p.address}</span> — {p.alert_type}: {p.notes}
                  </div>
                ))
              )}
            </div>

            {/* Recent Arrests */}
            <div className="bg-surface-sunken border border-border-default rounded-sm p-2">
              <h4 className="text-xs font-semibold text-[color:var(--panel-header-color)] mb-1.5">RECENT ARRESTS</h4>
              {generated.recent_arrests.length === 0 ? (
                <p className="text-xs text-neutral-500">None</p>
              ) : (
                generated.recent_arrests.map((a, i) => (
                  <div key={i} className="text-xs text-neutral-300 py-0.5 border-b border-border-muted last:border-0">
                    {a.name} — {a.charges} <span className="text-neutral-500">{a.arrest_time}</span>
                  </div>
                ))
              )}
            </div>

            {/* Units on Duty */}
            <div className="bg-surface-sunken border border-border-default rounded-sm p-2">
              <h4 className="text-xs font-semibold text-[color:var(--panel-header-color)] mb-1.5">UNITS ON DUTY</h4>
              {generated.units_on_duty.length === 0 ? (
                <p className="text-xs text-neutral-500">None</p>
              ) : (
                generated.units_on_duty.map((u) => (
                  <div key={u.unit_id} className="text-xs text-neutral-300 py-0.5 border-b border-border-muted last:border-0 flex justify-between">
                    <span><span className="font-mono text-neutral-400">{u.unit_id}</span> {u.officer_name}</span>
                    <span className="text-neutral-500">{toDisplayLabel(u.status)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Briefing History */}
      <div className="bg-surface-raised border border-border-default rounded-sm p-3">
        <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
          <PanelTitleBar title="BRIEFING HISTORY" icon={Users} />
          <div className="flex items-center gap-2">
            <Search className="w-3 h-3 text-fg-muted" />
            <input
              value={histSearch}
              onChange={(e) => setHistSearch(e.target.value)}
              placeholder="Search title / # / author"
              aria-label="Search briefing history"
              className="w-40 px-2 py-1 text-[10px] bg-surface-sunken border border-border-default rounded-sm text-text-primary"
            />
            <select
              value={shiftFilter}
              onChange={(e) => setShiftFilter(e.target.value as typeof shiftFilter)}
              className="px-2 py-1 text-[10px] bg-surface-sunken border border-border-default rounded-sm text-text-primary"
            >
              <option value="all">All shifts</option>
              <option value="day">Day</option>
              <option value="swing">Swing</option>
              <option value="night">Night</option>
            </select>
            <button
              type="button"
              disabled={visibleBriefings.length === 0}
              onClick={() => downloadTextFile('shift-briefings.csv', briefingsToCsv(visibleBriefings))}
              className="flex items-center gap-1 px-2 py-1 text-[10px] border border-border-default rounded-sm disabled:opacity-40"
            >
              <Download className="w-3 h-3" /> CSV
            </button>
            <IconButton
            onClick={loadBriefings}
            disabled={loading}
            aria-label="Refresh briefings"
            className="p-1 text-neutral-400 hover:text-neutral-200"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </IconButton>
          </div>
        </div>

        {visibleBriefings.length === 0 ? (
          <p className="text-xs text-neutral-500 py-2">{briefings.length === 0 ? 'No briefings found.' : 'No briefings match the filter.'}</p>
        ) : (
          <div className="space-y-1">
            {visibleBriefings.map((b) => (
              <div key={b.id} className="border border-border-default rounded-sm bg-surface-sunken">
                <button
                  onClick={() => setExpandedId(expandedId === b.id ? null : b.id)}
                  className="w-full flex items-center justify-between px-2 py-1.5 text-left hover:bg-surface-raised"
                >
                  <div className="flex items-center gap-3 text-xs">
                    {shiftIcon(b.shift_type)}
                    <span className="font-mono text-neutral-400">{b.briefing_number}</span>
                    <span className="text-neutral-200">{b.title}</span>
                    <span className="text-neutral-500">{parseTimestamp(b.created_at).toLocaleDateString('en-US', { timeZone: 'America/Denver' })}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-neutral-500">
                      <Check className="w-3 h-3 inline mr-0.5" />
                      {b.acknowledged_count}/{b.total_officers}
                    </span>
                  </div>
                </button>
                {expandedId === b.id && (
                  <div className="px-3 py-2 border-t border-border-default text-xs text-text-primary whitespace-pre-wrap font-mono">
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(b.content).catch(() => undefined)}
                      className="mb-2 flex items-center gap-1 text-[10px] text-fg-muted"
                    >
                      <Copy className="w-3 h-3" /> Copy body
                    </button>
                    {b.content}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Officer Safety Alerts */}
      <div className="bg-surface-raised border border-border-default rounded-sm p-3">
        <button
          onClick={() => setSafetyExpanded(!safetyExpanded)}
          className="w-full flex items-center justify-between"
        >
          <PanelTitleBar title="OFFICER SAFETY ALERTS" icon={Shield} />
          <span className="text-xs text-neutral-500">{safetyExpanded ? '▼' : '▶'}</span>
        </button>

        {safetyExpanded && (
          <div className="mt-2 space-y-1">
            {safetyAlerts.length === 0 ? (
              <p className="text-xs text-neutral-500 py-1">No active safety alerts.</p>
            ) : (
              safetyAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-start gap-2 px-2 py-1.5 bg-surface-sunken border border-border-default rounded-sm"
                >
                  <AlertTriangle className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${
                    alert.severity === 'high' ? 'text-red-400' :
                    alert.severity === 'medium' ? 'text-yellow-400' : 'text-neutral-400'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs">
                      <span className={`font-medium ${
                        alert.severity === 'high' ? 'text-red-400' :
                        alert.severity === 'medium' ? 'text-yellow-400' : 'text-neutral-300'
                      }`}>
                        {alert.type === 'premise' ? 'PREMISE' : 'WEAPONS CALL'}
                      </span>
                      <span className="text-neutral-500 font-mono">{alert.location}</span>
                      <button
                        type="button"
                        className="text-[10px] text-fg-muted"
                        onClick={() => navigator.clipboard.writeText(alert.location).catch(() => undefined)}
                      >
                        Copy loc
                      </button>
                    </div>
                    <p className="text-xs text-neutral-400 mt-0.5 truncate">{alert.description}</p>
                  </div>
                  <span className="text-[10px] text-neutral-600 whitespace-nowrap">
                    {parseTimestamp(alert.created_at).toLocaleDateString('en-US', { timeZone: 'America/Denver' })}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
