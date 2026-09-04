// Admin UI for managing inbound email rules.
// Rules are evaluated by the poller on every new inbound message.

import { useEffect, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { asArray } from '../../utils/asArray';
import { useToast } from '../../components/ToastProvider';
import { useContextMenu, type ContextMenuItem } from '../../context/ContextMenuContext';
import { useMenuActions } from '../../utils/contextMenuActions';

import RichTextArea from '../../components/RichTextArea';
interface Rule {
  id: number;
  name: string;
  isActive: boolean;
  conditions_json: string;
  actions_json: string;
}

export default function AdminEmailRulesTab() {
  const { addToast } = useToast();
  const [rules, setRules] = useState<Rule[]>([]);
  const [editing, setEditing] = useState<Partial<Rule> | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testFrom, setTestFrom] = useState('');
  const [testSubject, setTestSubject] = useState('');

  const load = () =>
    apiFetch<{ rules: any[]; total: number }>('/api/email/rules')
      .then((data) => setRules(asArray<any>(data?.rules).map((r) => ({
        id: r.id,
        name: r.name,
        isActive: !!r.isActive,
        conditions_json: JSON.stringify(r.conditions ?? {}, null, 2),
        actions_json: JSON.stringify(r.actions ?? [], null, 2),
      }))))
      .catch(err => { console.error('Failed to load rules:', err); addToast(err instanceof Error ? err.message : 'Failed to load email rules', 'error'); });

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
      addToast('Conditions and actions must be valid JSON.', 'error');
      return;
    }
    const payload = {
      name: editing.name,
      isActive: editing.isActive ?? true,
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
    } catch (err) {
      addToast(`Save failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }

  async function remove(id: number) {
    if (!confirm('Delete this rule?')) return;
    try {
      await apiFetch(`/api/email/rules/${id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      addToast(`Delete failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }

  async function testMatch() {
    if (!editing) return;
    let parsedConditions: any;
    try {
      parsedConditions = JSON.parse(editing.conditions_json || '{}');
    } catch {
      addToast('Conditions must be valid JSON.', 'error');
      return;
    }
    try {
      const r = await apiFetch<{ matches: boolean }>('/api/email/rules/test-match', {
        method: 'POST',
        body: JSON.stringify({
          conditions: parsedConditions,
          sample: { from: testFrom, subject: testSubject },
        }),
      });
      setTestResult(r.matches ? 'Sample email MATCHES these conditions' : 'Sample email does not match');
    } catch (err) {
      setTestResult(`Test failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Right-click context menu (per rule row) ──
  const { openMenu } = useContextMenu();
  const m = useMenuActions();

  const buildRuleMenu = (r: Rule): ContextMenuItem[] => [
    m.action('Edit rule', () => { setTestResult(null); setEditing(r); }, { icon: <Pencil size={12} /> }),
    m.separator(),
    m.copy('Copy name', r.name),
    m.copyId(r.id),
    m.separator(),
    m.action('Delete rule', () => remove(r.id), { icon: <Trash2 size={12} />, danger: true }),
  ];

  return (
    <div className="p-4 space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-sm font-semibold text-[color:var(--panel-header-color)]">EMAIL RULES</h2>
        <button
          onClick={() => {
            setTestResult(null);
            setEditing({ isActive: true, conditions_json: '{}', actions_json: '[]' });
          }}
          className="px-3 py-1 border border-border-default text-xs hover:border-accent-silver-500 hover:text-accent-silver-400"
        >
          NEW RULE
        </button>
      </div>

      <div className="overflow-x-auto"><table className="w-full text-xs">
        <thead>
          <tr className="text-left border-b border-border-default">
            <th className="py-1">Name</th>
            <th className="py-1">Enabled</th>
            <th className="py-1"></th>
          </tr>
        </thead>
        <tbody>
          {rules.map(r => (
            <tr key={r.id} onContextMenu={(e) => openMenu(e, buildRuleMenu(r))} className="border-t border-border-default">
              <td className="py-1">{r.name}</td>
              <td className="py-1">{r.isActive ? 'YES' : 'NO'}</td>
              <td className="py-1">
                <button
                  onClick={() => {
                    setTestResult(null);
                    setEditing(r);
                  }}
                  className="px-2 py-0.5 border border-border-default mr-2 hover:border-accent-silver-500"
                >
                  EDIT
                </button>
                <button
                  onClick={() => remove(r.id)}
                  className="px-2 py-0.5 border border-border-default hover:border-red-600"
                >
                  DELETE
                </button>
              </td>
            </tr>
          ))}
          {rules.length === 0 && (
            <tr>
              <td colSpan={3} className="py-4 text-center text-rmpg-500">
                No rules configured.
              </td>
            </tr>
          )}
        </tbody>
      </table></div>

      {editing && (
        <div className="border border-border-default p-3 space-y-2 bg-surface-base">
          <input id="ff-adminemailrulestab-0"
            placeholder="Rule name"
            value={editing.name || ''}
            onChange={e => setEditing({ ...editing, name: e.target.value })}
            className="w-full bg-black text-rmpg-100 px-2 py-1"
          />
          <RichTextArea
            placeholder='Conditions JSON e.g. {"sender_regex":"@ut\\.gov$"}'
            value={editing.conditions_json || ''}
            onChange={e => setEditing({ ...editing, conditions_json: e.target.value })}
            className="w-full bg-black text-rmpg-100 px-2 py-1 h-20 font-mono text-xs"
          />
          <RichTextArea
            placeholder='Actions JSON e.g. [{"type":"flag"}]'
            value={editing.actions_json || ''}
            onChange={e => setEditing({ ...editing, actions_json: e.target.value })}
            className="w-full bg-black text-rmpg-100 px-2 py-1 h-20 font-mono text-xs"
          />
          <label className="flex items-center gap-2 text-xs">
            <input id="ff-adminemailrulestab-2"
              type="checkbox"
              checked={!!editing.isActive}
              onChange={e => setEditing({ ...editing, isActive: e.target.checked })}
            />
            Enabled
          </label>
          <div className="grid grid-cols-2 gap-2">
            <input id="ff-adminemailrulestab-3"
              placeholder="Test: sender email"
              value={testFrom}
              onChange={e => setTestFrom(e.target.value)}
              className="w-full bg-black text-rmpg-100 px-2 py-1"
            />
            <input id="ff-adminemailrulestab-4"
              placeholder="Test: subject"
              value={testSubject}
              onChange={e => setTestSubject(e.target.value)}
              className="w-full bg-black text-rmpg-100 px-2 py-1"
            />
          </div>
          <div className="flex gap-2 items-center">
            <button
              onClick={save}
              className="px-3 py-1 border border-accent-silver-500 text-accent-silver-500"
            >
              SAVE
            </button>
            <button
              onClick={testMatch}
              className="px-3 py-1 border border-border-default hover:border-accent-silver-500"
            >
              TEST MATCH
            </button>
            <button
              onClick={() => {
                setEditing(null);
                setTestResult(null);
              }}
              className="px-3 py-1 border border-border-default"
            >
              CANCEL
            </button>
            {testResult && (
              <span className="text-xs text-rmpg-400 ml-2">{testResult}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
