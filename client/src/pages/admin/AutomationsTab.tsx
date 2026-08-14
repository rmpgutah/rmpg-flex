import React, { useState, useEffect, useCallback } from 'react';
import { Zap, Plus, Trash2, Edit2 } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import PanelTitleBar from '../../components/PanelTitleBar';
import AutomationRuleEditor from '../../components/AutomationRuleEditor';
import { formatDateTime } from '../../utils/dateUtils';

interface Rule {
  id: number;
  name: string;
  description: string | null;
  scope: string;
  scope_id: number | null;
  enabled: number;
  trigger_type: string;
  action_type: string;
  dedup_window_ms: number;
  evaluate_client: number;
  evaluate_server: number;
  trigger_config: string;
  action_config: string;
  created_by_name: string | null;
  created_at: string;
}

interface Firing {
  id: number;
  rule_id: number;
  rule_name: string;
  officer_name: string;
  fired_at: string;
  trigger_lat: number;
  trigger_lng: number;
  context: string;
  source: 'client' | 'server';
}

interface Template {
  name: string;
  description: string;
  scope: string;
  scope_id: null;
  trigger_type: string;
  trigger_config: string;
  action_type: string;
  action_config: string;
  dedup_window_ms: number;
  evaluate_client: number;
  evaluate_server: number;
}

const TEMPLATES: Template[] = [
  {
    name: 'Welfare check — no movement 15 min',
    description: 'Automatically starts welfare timer when officer has not moved for 15 minutes',
    scope: 'global', scope_id: null,
    trigger_type: 'no_movement', trigger_config: JSON.stringify({ threshold_ms: 900000, radius_m: 50 }),
    action_type: 'trigger_welfare_check', action_config: JSON.stringify({ timer_ms: 900000 }),
    dedup_window_ms: 900000, evaluate_client: 0, evaluate_server: 1,
  },
  {
    name: 'Auto on-scene prompt — call proximity 328 ft',
    description: 'Prompts officer to mark on-scene when within 328 ft of their assigned call',
    scope: 'global', scope_id: null,
    trigger_type: 'call_proximity', trigger_config: JSON.stringify({ radius_m: 100 }),
    action_type: 'notify_officer', action_config: JSON.stringify({ message: "You're near your assigned call — mark on scene?", severity: 'info' }),
    dedup_window_ms: 300000, evaluate_client: 1, evaluate_server: 0,
  },
  {
    name: 'Speed alert — over 90 mph',
    description: 'Notifies supervisor when an officer exceeds 90 mph',
    scope: 'global', scope_id: null,
    trigger_type: 'speed_threshold', trigger_config: JSON.stringify({ speed_ms: 40.2, direction: 'above' }),
    action_type: 'notify_supervisor', action_config: JSON.stringify({ message: 'Officer exceeding 90 mph', severity: 'warn' }),
    dedup_window_ms: 120000, evaluate_client: 0, evaluate_server: 1,
  },
  {
    name: 'Beat entry log',
    description: 'Logs an audit entry whenever an officer enters a new beat',
    scope: 'global', scope_id: null,
    trigger_type: 'beat_entry', trigger_config: JSON.stringify({}),
    action_type: 'log_audit_event', action_config: JSON.stringify({ category: 'beat_entry', note: 'Officer entered beat' }),
    dedup_window_ms: 60000, evaluate_client: 0, evaluate_server: 1,
  },
];

type PanelView = 'rules' | 'history' | 'templates';

export default function AutomationsTab() {
  const [view, setView] = useState<PanelView>('rules');
  const [rules, setRules] = useState<Rule[]>([]);
  const [firings, setFirings] = useState<Firing[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [creating, setCreating] = useState(false);
  const [toggling, setToggling] = useState<number | null>(null);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ rules: Rule[] }>('/automation-rules');
      setRules(data?.rules ?? []);
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchFirings = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ firings: Firing[] }>('/automation-rules/firings');
      setFirings(data?.firings ?? []);
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRules(); }, [fetchRules]);
  useEffect(() => { if (view === 'history') fetchFirings(); }, [view, fetchFirings]);

  const handleToggle = async (rule: Rule) => {
    setToggling(rule.id);
    try {
      await apiFetch(`/automation-rules/${rule.id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: rule.enabled ? 0 : 1 }),
      });
      await fetchRules();
    } catch {
      // non-fatal
    } finally {
      setToggling(null);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this rule?')) return;
    try {
      await apiFetch(`/automation-rules/${id}`, { method: 'DELETE' });
      await fetchRules();
    } catch {
      // non-fatal
    }
  };

  const handleInstallTemplate = async (tpl: Template) => {
    try {
      await apiFetch('/automation-rules', { method: 'POST', body: JSON.stringify(tpl) });
      await fetchRules();
      setView('rules');
    } catch {
      // non-fatal
    }
  };

  if (creating || editing) {
    return (
      <div className="p-4 space-y-4 max-w-xl">
        <PanelTitleBar title={editing ? 'EDIT RULE' : 'NEW RULE'} icon={Zap} />
        <AutomationRuleEditor
          rule={editing ? {
            id: editing.id,
            name: editing.name,
            description: editing.description ?? undefined,
            scope: (editing.scope as 'global' | 'unit' | 'user'),
            scope_id: editing.scope_id != null ? String(editing.scope_id) : undefined,
            trigger_type: editing.trigger_type,
            action_type: editing.action_type,
            dedup_window_ms: editing.dedup_window_ms,
            evaluate_client: !!editing.evaluate_client,
            evaluate_server: !!editing.evaluate_server,
            trigger_config: (() => { try { return JSON.parse(editing.trigger_config || '{}'); } catch { return {}; } })(),
            action_config: (() => { try { return JSON.parse(editing.action_config || '{}'); } catch { return {}; } })(),
          } : undefined}
          adminMode
          onSaved={() => { setCreating(false); setEditing(null); fetchRules(); }}
          onCancel={() => { setCreating(false); setEditing(null); }}
        />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="SMART AUTOMATIONS" icon={Zap} />

      {/* Sub-nav */}
      <div className="flex gap-2">
        {(['rules', 'history', 'templates'] as PanelView[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-3 py-1 text-[11px] rounded-sm border ${
              view === v
                ? 'bg-brand-600 text-white border-brand-600'
                : 'bg-surface-raised border-surface-border text-text-secondary'
            }`}
          >
            {v === 'rules' ? 'Rule Library' : v === 'history' ? 'Firing History' : 'Templates'}
          </button>
        ))}
        {view === 'rules' && (
          <button
            onClick={() => setCreating(true)}
            className="ml-auto px-3 py-1 text-[11px] rounded-sm bg-surface-raised border border-surface-border text-text-primary flex items-center gap-1"
          >
            <Plus size={11} /> New Rule
          </button>
        )}
      </div>

      {view === 'rules' && (
        <div className="border border-surface-border rounded-sm overflow-hidden">
          <table className="w-full text-[11px]">
            <thead className="bg-surface-raised">
              <tr>
                {['Name', 'Trigger', 'Action', 'Scope', 'Eval', 'On'].map((h) => (
                  <th key={h} className="text-left py-[3px] px-2 text-[9px] font-semibold text-[color:var(--panel-header-color)]">{h}</th>
                ))}
                <th className="py-[3px] px-2 text-[9px]" />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className="text-center py-4 text-text-muted">Loading…</td></tr>
              )}
              {!loading && rules.length === 0 && (
                <tr><td colSpan={7} className="text-center py-4 text-text-muted">No rules. Create one or install a template.</td></tr>
              )}
              {rules.map((rule) => (
                <tr key={rule.id} className="border-t border-surface-border hover:bg-surface-raised/30">
                  <td className="py-[2px] px-2 text-text-primary">{rule.name}</td>
                  <td className="py-[2px] px-2 text-text-secondary">{rule.trigger_type.replace(/_/g, ' ')}</td>
                  <td className="py-[2px] px-2 text-text-secondary">{rule.action_type.replace(/_/g, ' ')}</td>
                  <td className="py-[2px] px-2 text-text-muted">
                    {rule.scope}{rule.scope_id ? ` #${rule.scope_id}` : ''}
                  </td>
                  <td className="py-[2px] px-2">
                    <span className="text-[9px] text-text-muted">
                      {rule.evaluate_client ? 'C' : ''}{rule.evaluate_server ? 'S' : ''}
                    </span>
                  </td>
                  <td className="py-[2px] px-2">
                    <button
                      onClick={() => handleToggle(rule)}
                      disabled={toggling === rule.id}
                      aria-label={rule.enabled ? 'Disable rule' : 'Enable rule'}
                      className={`w-8 h-4 rounded-full transition-colors ${rule.enabled ? 'bg-sev-ok' : 'bg-surface-border'}`}
                    >
                      <span className={`block w-3 h-3 rounded-full bg-white transition-transform mx-0.5 ${rule.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </td>
                  <td className="py-[2px] px-2">
                    <div className="flex gap-1">
                      <button
                        onClick={() => setEditing(rule)}
                        aria-label="Edit rule"
                        className="text-text-muted hover:text-text-primary"
                      >
                        <Edit2 size={11} />
                      </button>
                      <button
                        onClick={() => handleDelete(rule.id)}
                        aria-label="Delete rule"
                        className="text-text-muted hover:text-sev-critical"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'history' && (
        <div className="border border-surface-border rounded-sm overflow-hidden">
          <table className="w-full text-[11px]">
            <thead className="bg-surface-raised">
              <tr>
                {['Rule', 'Officer', 'Fired at', 'Source', 'Location'].map((h) => (
                  <th key={h} className="text-left py-[3px] px-2 text-[9px] font-semibold text-[color:var(--panel-header-color)]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={5} className="text-center py-4 text-text-muted">Loading…</td></tr>
              )}
              {!loading && firings.length === 0 && (
                <tr><td colSpan={5} className="text-center py-4 text-text-muted">No firings recorded yet.</td></tr>
              )}
              {firings.map((f) => (
                <tr key={f.id} className="border-t border-surface-border">
                  <td className="py-[2px] px-2 text-text-primary">{f.rule_name}</td>
                  <td className="py-[2px] px-2 text-text-secondary">{f.officer_name}</td>
                  <td className="py-[2px] px-2 text-text-muted">{formatDateTime(f.fired_at)}</td>
                  <td className="py-[2px] px-2">
                    <span className={`text-[9px] font-semibold ${f.source === 'client' ? 'text-brand-400' : 'text-accent-silver-400'}`}>
                      {f.source.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-[2px] px-2 text-text-muted font-mono">
                    {f.trigger_lat?.toFixed(4)}, {f.trigger_lng?.toFixed(4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'templates' && (
        <div className="grid grid-cols-1 gap-3">
          {TEMPLATES.map((tpl, i) => (
            <div key={i} className="bg-surface-raised border border-surface-border rounded-sm p-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold text-text-primary">{tpl.name}</p>
                <p className="text-[10px] text-text-muted mt-0.5">{tpl.description}</p>
                <p className="text-[10px] text-text-secondary mt-1">
                  {tpl.trigger_type.replace(/_/g, ' ')} → {tpl.action_type.replace(/_/g, ' ')}
                </p>
              </div>
              <button
                onClick={() => handleInstallTemplate(tpl)}
                className="shrink-0 px-3 py-1 text-[11px] bg-brand-600 text-white rounded-sm"
              >
                Install
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
