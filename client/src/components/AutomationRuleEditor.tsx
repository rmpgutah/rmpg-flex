import React, { useState } from 'react';
import { apiFetch } from '../hooks/useApi';

export interface RuleFormState {
  name: string;
  description: string;
  scope: 'global' | 'unit' | 'user';
  scope_id: string;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  action_type: string;
  action_config: Record<string, unknown>;
  dedup_window_ms: number;
  evaluate_client: boolean;
  evaluate_server: boolean;
}

const TRIGGER_OPTIONS = [
  { value: 'speed_threshold', label: 'Speed threshold' },
  { value: 'no_movement', label: 'No movement (welfare)' },
  { value: 'call_proximity', label: 'Near assigned call' },
  { value: 'geofence_enter', label: 'Geofence entry' },
  { value: 'geofence_exit', label: 'Geofence exit' },
  { value: 'low_accuracy', label: 'Low GPS accuracy' },
];

const ACTION_OPTIONS = [
  { value: 'notify_officer', label: 'Notify officer (in-app)' },
  { value: 'notify_dispatch', label: 'Notify dispatch' },
  { value: 'notify_supervisor', label: 'Notify supervisor' },
  { value: 'change_unit_status', label: 'Change unit status' },
  { value: 'trigger_welfare_check', label: 'Start welfare timer' },
  { value: 'log_audit_event', label: 'Log audit event' },
  { value: 'sync_fleet_odometer', label: 'Sync Fleet.io odometer' },
];

interface Props {
  rule?: { id: number } & Partial<RuleFormState>;
  adminMode?: boolean;
  onSaved: () => void;
  onCancel: () => void;
}

const EMPTY: RuleFormState = {
  name: '', description: '', scope: 'global', scope_id: '',
  trigger_type: 'speed_threshold',
  trigger_config: { speed_ms: 40, direction: 'above' },
  action_type: 'notify_dispatch',
  action_config: { message: '', severity: 'warn' },
  dedup_window_ms: 300000,
  evaluate_client: true, evaluate_server: true,
};

export default function AutomationRuleEditor({ rule, adminMode = true, onSaved, onCancel }: Props) {
  const [form, setForm] = useState<RuleFormState>(rule ? {
    name: rule.name ?? '',
    description: rule.description ?? '',
    scope: (rule.scope as 'global' | 'unit' | 'user') ?? 'global',
    scope_id: String(rule.scope_id ?? ''),
    trigger_type: rule.trigger_type ?? 'speed_threshold',
    trigger_config: rule.trigger_config ?? {},
    action_type: rule.action_type ?? 'notify_officer',
    action_config: rule.action_config ?? {},
    dedup_window_ms: rule.dedup_window_ms ?? 300000,
    evaluate_client: rule.evaluate_client !== false,
    evaluate_server: rule.evaluate_server !== false,
  } : { ...EMPTY, action_type: adminMode ? 'notify_dispatch' : 'notify_officer' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableActions = adminMode
    ? ACTION_OPTIONS
    : ACTION_OPTIONS.filter((o) => o.value === 'notify_officer');

  const availableTriggers = adminMode
    ? TRIGGER_OPTIONS
    : TRIGGER_OPTIONS.filter((o) =>
        ['call_proximity', 'no_movement', 'low_accuracy', 'speed_threshold'].includes(o.value)
      );

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...form,
        scope_id: form.scope_id ? Number(form.scope_id) : undefined,
        evaluate_client: form.evaluate_client ? 1 : 0,
        evaluate_server: form.evaluate_server ? 1 : 0,
      };
      if (rule?.id) {
        await apiFetch(`/automation-rules/${rule.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/automation-rules', { method: 'POST', body: JSON.stringify(payload) });
      }
      onSaved();
    } catch (e: unknown) {
      setError((e as Error)?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-[11px] text-[color:var(--field-label-color)] mb-1">Rule Name</label>
        <input
          className="w-full bg-surface-sunken border border-surface-border text-text-primary px-2 py-1 text-[11px] rounded-sm"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="e.g. Speed alert highway patrol"
        />
      </div>

      <div>
        <label className="block text-[11px] text-[color:var(--field-label-color)] mb-1">Description (optional)</label>
        <input
          className="w-full bg-surface-sunken border border-surface-border text-text-primary px-2 py-1 text-[11px] rounded-sm"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="Brief description of what this rule does"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] text-[color:var(--field-label-color)] mb-1">Trigger</label>
          <select
            className="w-full bg-surface-sunken border border-surface-border text-text-primary px-2 py-1 text-[11px] rounded-sm"
            value={form.trigger_type}
            onChange={(e) => setForm((f) => ({ ...f, trigger_type: e.target.value, trigger_config: {} }))}
          >
            {availableTriggers.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-[color:var(--field-label-color)] mb-1">Action</label>
          <select
            className="w-full bg-surface-sunken border border-surface-border text-text-primary px-2 py-1 text-[11px] rounded-sm"
            value={form.action_type}
            onChange={(e) => setForm((f) => ({ ...f, action_type: e.target.value, action_config: {} }))}
          >
            {availableActions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {/* Trigger config fields */}
      {form.trigger_type === 'speed_threshold' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] text-[color:var(--field-label-color)] mb-1">Speed (mph)</label>
            <input
              type="number"
              className="w-full bg-surface-sunken border border-surface-border text-text-primary px-2 py-1 text-[11px] rounded-sm"
              value={Math.round(((form.trigger_config.speed_ms as number) ?? 40) * 2.237)}
              onChange={(e) => setForm((f) => ({
                ...f,
                trigger_config: { ...f.trigger_config, speed_ms: Number(e.target.value) / 2.237 },
              }))}
            />
          </div>
          <div>
            <label className="block text-[11px] text-[color:var(--field-label-color)] mb-1">Direction</label>
            <select
              className="w-full bg-surface-sunken border border-surface-border text-text-primary px-2 py-1 text-[11px] rounded-sm"
              value={(form.trigger_config.direction as string) ?? 'above'}
              onChange={(e) => setForm((f) => ({
                ...f,
                trigger_config: { ...f.trigger_config, direction: e.target.value },
              }))}
            >
              <option value="above">Above threshold</option>
              <option value="below">Below threshold</option>
            </select>
          </div>
        </div>
      )}

      {form.trigger_type === 'no_movement' && (
        <div>
          <label className="block text-[11px] text-[color:var(--field-label-color)] mb-1">No movement for (minutes)</label>
          <input
            type="number"
            className="w-full bg-surface-sunken border border-surface-border text-text-primary px-2 py-1 text-[11px] rounded-sm"
            value={Math.round(((form.trigger_config.threshold_ms as number) ?? 900000) / 60000)}
            onChange={(e) => setForm((f) => ({
              ...f,
              trigger_config: { ...f.trigger_config, threshold_ms: Number(e.target.value) * 60000, radius_m: 50 },
            }))}
          />
        </div>
      )}

      {form.trigger_type === 'call_proximity' && (
        <div>
          <label className="block text-[11px] text-[color:var(--field-label-color)] mb-1">Radius (feet)</label>
          <input
            type="number"
            className="w-full bg-surface-sunken border border-surface-border text-text-primary px-2 py-1 text-[11px] rounded-sm"
            value={Math.round(((form.trigger_config.radius_m as number) ?? 200) * 3.281)}
            onChange={(e) => setForm((f) => ({
              ...f,
              trigger_config: { ...f.trigger_config, radius_m: Number(e.target.value) / 3.281 },
            }))}
          />
        </div>
      )}

      {form.trigger_type === 'low_accuracy' && (
        <div>
          <label className="block text-[11px] text-[color:var(--field-label-color)] mb-1">Accuracy threshold (feet)</label>
          <input
            type="number"
            className="w-full bg-surface-sunken border border-surface-border text-text-primary px-2 py-1 text-[11px] rounded-sm"
            value={Math.round(((form.trigger_config.threshold_m as number) ?? 50) * 3.281)}
            onChange={(e) => setForm((f) => ({
              ...f,
              trigger_config: { ...f.trigger_config, threshold_m: Number(e.target.value) / 3.281 },
            }))}
          />
        </div>
      )}

      {/* Action config fields */}
      {['notify_officer', 'notify_dispatch', 'notify_supervisor'].includes(form.action_type) && (
        <div>
          <label className="block text-[11px] text-[color:var(--field-label-color)] mb-1">Alert message</label>
          <input
            className="w-full bg-surface-sunken border border-surface-border text-text-primary px-2 py-1 text-[11px] rounded-sm"
            value={(form.action_config.message as string) ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, action_config: { ...f.action_config, message: e.target.value } }))}
            placeholder="Message shown to recipient"
          />
        </div>
      )}

      {form.action_type === 'change_unit_status' && (
        <div>
          <label className="block text-[11px] text-[color:var(--field-label-color)] mb-1">New unit status</label>
          <input
            className="w-full bg-surface-sunken border border-surface-border text-text-primary px-2 py-1 text-[11px] rounded-sm"
            value={(form.action_config.status as string) ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, action_config: { ...f.action_config, status: e.target.value } }))}
            placeholder="e.g. on_scene, available"
          />
        </div>
      )}

      {form.action_type === 'trigger_welfare_check' && (
        <div>
          <label className="block text-[11px] text-[color:var(--field-label-color)] mb-1">Welfare timer (minutes)</label>
          <input
            type="number"
            className="w-full bg-surface-sunken border border-surface-border text-text-primary px-2 py-1 text-[11px] rounded-sm"
            value={Math.round(((form.action_config.timer_ms as number) ?? 900000) / 60000)}
            onChange={(e) => setForm((f) => ({
              ...f,
              action_config: { ...f.action_config, timer_ms: Number(e.target.value) * 60000 },
            }))}
          />
        </div>
      )}

      {form.action_type === 'log_audit_event' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] text-[color:var(--field-label-color)] mb-1">Category</label>
            <input
              className="w-full bg-surface-sunken border border-surface-border text-text-primary px-2 py-1 text-[11px] rounded-sm"
              value={(form.action_config.category as string) ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, action_config: { ...f.action_config, category: e.target.value } }))}
              placeholder="e.g. beat_entry"
            />
          </div>
          <div>
            <label className="block text-[11px] text-[color:var(--field-label-color)] mb-1">Note</label>
            <input
              className="w-full bg-surface-sunken border border-surface-border text-text-primary px-2 py-1 text-[11px] rounded-sm"
              value={(form.action_config.note as string) ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, action_config: { ...f.action_config, note: e.target.value } }))}
              placeholder="Log message"
            />
          </div>
        </div>
      )}

      <div>
        <label className="block text-[11px] text-[color:var(--field-label-color)] mb-1">Re-fire cooldown (minutes)</label>
        <input
          type="number"
          className="w-full bg-surface-sunken border border-surface-border text-text-primary px-2 py-1 text-[11px] rounded-sm"
          value={Math.round(form.dedup_window_ms / 60000)}
          onChange={(e) => setForm((f) => ({ ...f, dedup_window_ms: Number(e.target.value) * 60000 }))}
        />
      </div>

      <div className="flex gap-4 text-[11px]">
        <label className="flex items-center gap-1.5 text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={form.evaluate_client}
            onChange={(e) => setForm((f) => ({ ...f, evaluate_client: e.target.checked }))}
          />
          Evaluate on client
        </label>
        <label className="flex items-center gap-1.5 text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={form.evaluate_server}
            onChange={(e) => setForm((f) => ({ ...f, evaluate_server: e.target.checked }))}
          />
          Evaluate on server
        </label>
      </div>

      {error && <p className="text-sev-critical text-[11px]">{error}</p>}

      <div className="flex gap-2 justify-end pt-2">
        <button
          onClick={onCancel}
          className="px-3 py-1 text-[11px] bg-surface-raised border border-surface-border text-text-secondary rounded-sm"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1 text-[11px] bg-brand-600 text-white rounded-sm disabled:opacity-50"
        >
          {saving ? 'Saving…' : rule?.id ? 'Update Rule' : 'Create Rule'}
        </button>
      </div>
    </div>
  );
}
