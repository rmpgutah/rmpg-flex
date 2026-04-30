// Admin UI for managing inbound email rules.
// Rules are evaluated by the poller on every new inbound message.

import { useEffect, useState } from 'react';
import { apiFetch } from '../../hooks/useApi';

import RichTextArea from '../../components/RichTextArea';
interface Rule {
  id: number;
  name: string;
  priority: number;
  enabled: number;
  conditions_json: string;
  actions_json: string;
}

export default function AdminEmailRulesTab() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [editing, setEditing] = useState<Partial<Rule> | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  const load = () =>
    apiFetch<Rule[]>('/api/email/rules')
      .then(setRules)
      .catch(err => console.error('Failed to load rules:', err));

  useEffect(() => {
    load();
  }, []);

  async function save() {
    if (!editing) return;
    let parsedConditions: any, parsedActions: any;
    try {
      parsedConditions = JSON.parse(editing.conditions_json || '{}');
      parsedActions = JSON.parse(editing.actions_json || '[]');
    } catch {
      alert('Conditions and actions must be valid JSON.');
      return;
    }
    const payload = {
      name: editing.name,
      priority: editing.priority ?? 100,
      enabled: editing.enabled ?? 1,
      conditions: parsedConditions,
      actions: parsedActions,
    };
    try {
      if (editing.id) {
        await apiFetch(`/api/email/rules/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch('/api/email/rules', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      setEditing(null);
      setTestResult(null);
      load();
    } catch (err: any) {
      alert(`Save failed: ${err.message || err}`);
    }
  }

  async function remove(id: number) {
    if (!confirm('Delete this rule?')) return;
    try {
      await apiFetch(`/api/email/rules/${id}`, { method: 'DELETE' });
      load();
    } catch (err: any) {
      alert(`Delete failed: ${err.message || err}`);
    }
  }

  async function testMatch() {
    if (!editing) return;
    let parsedConditions: any;
    try {
      parsedConditions = JSON.parse(editing.conditions_json || '{}');
    } catch {
      alert('Conditions must be valid JSON.');
      return;
    }
    try {
      const r = await apiFetch<{ matched: number; total: number }>('/api/email/rules/test-match', {
        method: 'POST',
        body: JSON.stringify({ conditions: parsedConditions }),
      });
      setTestResult(`Matched ${r.matched} of last ${r.total} inbox emails`);
    } catch (err: any) {
      setTestResult(`Test failed: ${err.message || err}`);
    }
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-sm font-semibold text-[#d4a017]">EMAIL RULES</h2>
        <button
          onClick={() => {
            setTestResult(null);
            setEditing({ priority: 100, enabled: 1, conditions_json: '{}', actions_json: '[]' });
          }}
          className="px-3 py-1 border border-[#222] text-xs hover:border-[#d4a017] hover:text-[#d4a017]"
        >
          NEW RULE
        </button>
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="text-left border-b border-[#222]">
            <th className="py-1">Name</th>
            <th className="py-1">Priority</th>
            <th className="py-1">Enabled</th>
            <th className="py-1"></th>
          </tr>
        </thead>
        <tbody>
          {rules.map(r => (
            <tr key={r.id} className="border-t border-[#222]">
              <td className="py-1">{r.name}</td>
              <td className="py-1">{r.priority}</td>
              <td className="py-1">{r.enabled ? 'YES' : 'NO'}</td>
              <td className="py-1">
                <button
                  onClick={() => {
                    setTestResult(null);
                    setEditing(r);
                  }}
                  className="px-2 py-0.5 border border-[#222] mr-2 hover:border-[#d4a017]"
                >
                  EDIT
                </button>
                <button
                  onClick={() => remove(r.id)}
                  className="px-2 py-0.5 border border-[#222] hover:border-red-600"
                >
                  DELETE
                </button>
              </td>
            </tr>
          ))}
          {rules.length === 0 && (
            <tr>
              <td colSpan={4} className="py-4 text-center text-gray-500">
                No rules configured.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing && (
        <div className="border border-[#222] p-3 space-y-2 bg-[#141414]">
          <input
            placeholder="Rule name"
            value={editing.name || ''}
            onChange={e => setEditing({ ...editing, name: e.target.value })}
            className="w-full bg-black text-white px-2 py-1"
          />
          <input
            type="number"
            placeholder="Priority"
            value={editing.priority ?? 100}
            onChange={e => setEditing({ ...editing, priority: Number(e.target.value) })}
            className="w-full bg-black text-white px-2 py-1"
          />
          <RichTextArea
            placeholder='Conditions JSON e.g. {"sender_regex":"@ut\\.gov$"}'
            value={editing.conditions_json || ''}
            onChange={e => setEditing({ ...editing, conditions_json: e.target.value })}
            className="w-full bg-black text-white px-2 py-1 h-20 font-mono text-xs"
          />
          <RichTextArea
            placeholder='Actions JSON e.g. [{"type":"flag"}]'
            value={editing.actions_json || ''}
            onChange={e => setEditing({ ...editing, actions_json: e.target.value })}
            className="w-full bg-black text-white px-2 py-1 h-20 font-mono text-xs"
          />
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={!!editing.enabled}
              onChange={e => setEditing({ ...editing, enabled: e.target.checked ? 1 : 0 })}
            />
            Enabled
          </label>
          <div className="flex gap-2 items-center">
            <button
              onClick={save}
              className="px-3 py-1 border border-[#d4a017] text-[#d4a017]"
            >
              SAVE
            </button>
            <button
              onClick={testMatch}
              className="px-3 py-1 border border-[#222] hover:border-[#d4a017]"
            >
              TEST MATCH
            </button>
            <button
              onClick={() => {
                setEditing(null);
                setTestResult(null);
              }}
              className="px-3 py-1 border border-[#222]"
            >
              CANCEL
            </button>
            {testResult && (
              <span className="text-xs text-gray-400 ml-2">{testResult}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
