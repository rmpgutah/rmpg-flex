import React, { useState, useEffect, useCallback } from 'react';
import {
  Radio,
  Plus,
  Trash2,
  Save,
  ToggleLeft,
  ToggleRight,
  Loader2,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  Pencil,
  X,
  Wifi,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

// ============================================================
// RMPG Flex — Admin Radio Channel Management Tab
// Manages the PTT radio channels that officers see in RadioPage.
// Channels are stored in system_config (category: radio_channel).
// ============================================================

interface RadioChannel {
  id: string;
  label: string;
  freq: string;
  sort_order: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

interface Props {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

export default function AdminRadioTab({ LoadingSpinner, error, setError }: Props) {
  const [channels, setChannels] = useState<RadioChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [newId, setNewId] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newFreq, setNewFreq] = useState('');

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editFreq, setEditFreq] = useState('');

  const fetchChannels = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiFetch<RadioChannel[]>('/admin/radio-channels');
      setChannels(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load radio channels');
    } finally {
      setLoading(false);
    }
  }, [setError]);

  // Seed defaults if empty, then fetch
  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<RadioChannel[]>('/admin/radio-channels');
        if (Array.isArray(data) && data.length === 0) {
          // Seed defaults
          await apiFetch('/admin/radio-channels/seed', { method: 'POST' });
          await fetchChannels();
        } else {
          setChannels(Array.isArray(data) ? data : []);
          setLoading(false);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load radio channels');
        setLoading(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAdd = async () => {
    if (!newId.trim() || !newLabel.trim()) return;
    setSaving(true);
    try {
      await apiFetch('/admin/radio-channels', {
        method: 'POST',
        body: JSON.stringify({ id: newId.trim().toLowerCase().replace(/\s+/g, '-'), label: newLabel.trim().toUpperCase(), freq: newFreq.trim() || '0.000' }),
      });
      setNewId('');
      setNewLabel('');
      setNewFreq('');
      setShowAdd(false);
      await fetchChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create channel');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (ch: RadioChannel) => {
    try {
      await apiFetch(`/admin/radio-channels/${ch.id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: !ch.is_active }),
      });
      await fetchChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update channel');
    }
  };

  const handleDelete = async (ch: RadioChannel) => {
    if (!confirm(`Delete radio channel "${ch.label}"? This cannot be undone.`)) return;
    try {
      await apiFetch(`/admin/radio-channels/${ch.id}`, { method: 'DELETE' });
      await fetchChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete channel');
    }
  };

  const handleMove = async (ch: RadioChannel, direction: 'up' | 'down') => {
    const idx = channels.findIndex(c => c.id === ch.id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= channels.length) return;

    const other = channels[swapIdx];
    try {
      await Promise.all([
        apiFetch(`/admin/radio-channels/${ch.id}`, {
          method: 'PUT',
          body: JSON.stringify({ sort_order: other.sort_order }),
        }),
        apiFetch(`/admin/radio-channels/${other.id}`, {
          method: 'PUT',
          body: JSON.stringify({ sort_order: ch.sort_order }),
        }),
      ]);
      await fetchChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reorder channels');
    }
  };

  const startEdit = (ch: RadioChannel) => {
    setEditingId(ch.id);
    setEditLabel(ch.label);
    setEditFreq(ch.freq);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditLabel('');
    setEditFreq('');
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      await apiFetch(`/admin/radio-channels/${editingId}`, {
        method: 'PUT',
        body: JSON.stringify({ label: editLabel.trim().toUpperCase(), freq: editFreq.trim() }),
      });
      cancelEdit();
      await fetchChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update channel');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  const activeCount = channels.filter(c => c.is_active).length;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Radio className="w-5 h-5 text-brand-400" />
          <div>
            <h2 className="text-sm font-bold text-rmpg-100 uppercase tracking-wider">Radio Channel Administration</h2>
            <p className="text-[10px] text-rmpg-400 mt-0.5">Manage PTT radio channels available to officers</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-rmpg-400">
            {activeCount} active / {channels.length} total
          </span>
          <button type="button"
            onClick={fetchChannels}
            className="p-1.5 text-rmpg-400 hover:text-brand-400 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button type="button"
            onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-1 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white text-[10px] font-bold uppercase tracking-wider transition-colors"
          >
            <Plus className="w-3 h-3" />
            Add Channel
          </button>
        </div>
      </div>

      {/* Add Form */}
      {showAdd && (
        <div className="panel-surface border border-rmpg-600 p-4 space-y-3">
          <h3 className="text-xs font-bold text-rmpg-200 uppercase tracking-wider">New Radio Channel</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] text-rmpg-400 mb-1 uppercase">Channel ID</label>
              <input
                type="text"
                value={newId}
                onChange={(e) => setNewId(e.target.value)}
                placeholder="e.g. tac-4"
                className="w-full px-2 py-1.5 bg-rmpg-800 border border-rmpg-600 text-rmpg-100 text-xs focus:border-brand-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] text-rmpg-400 mb-1 uppercase">Display Label</label>
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. TAC-4"
                className="w-full px-2 py-1.5 bg-rmpg-800 border border-rmpg-600 text-rmpg-100 text-xs focus:border-brand-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] text-rmpg-400 mb-1 uppercase">Frequency (Display)</label>
              <input
                type="text"
                value={newFreq}
                onChange={(e) => setNewFreq(e.target.value)}
                placeholder="e.g. 156.500"
                className="w-full px-2 py-1.5 bg-rmpg-800 border border-rmpg-600 text-rmpg-100 text-xs focus:border-brand-500 outline-none"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button type="button"
              onClick={handleAdd}
              disabled={!newId.trim() || !newLabel.trim() || saving}
              className="flex items-center gap-1 px-3 py-1.5 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-[10px] font-bold uppercase tracking-wider transition-colors"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              Create
            </button>
            <button type="button"
              onClick={() => setShowAdd(false)}
              className="px-3 py-1.5 text-rmpg-400 hover:text-rmpg-200 text-[10px] font-bold uppercase tracking-wider transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Channel List */}
      <div className="panel-surface border border-rmpg-600 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-rmpg-800/50 text-rmpg-400 uppercase text-[10px] tracking-wider">
              <th className="px-3 py-2 text-left w-10">Order</th>
              <th className="px-3 py-2 text-left">Channel ID</th>
              <th className="px-3 py-2 text-left">Label</th>
              <th className="px-3 py-2 text-left">Frequency</th>
              <th className="px-3 py-2 text-center">Status</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((ch, idx) => (
              <tr key={ch.id} className={`border-t border-rmpg-700/50 ${!ch.is_active ? 'opacity-50' : ''} hover:bg-rmpg-700/20 transition-colors`}>
                {/* Order */}
                <td className="px-3 py-2">
                  <div className="flex items-center gap-0.5">
                    <button type="button"
                      onClick={() => handleMove(ch, 'up')}
                      disabled={idx === 0}
                      className="p-0.5 text-rmpg-500 hover:text-rmpg-200 disabled:opacity-30 transition-colors"
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button type="button"
                      onClick={() => handleMove(ch, 'down')}
                      disabled={idx === channels.length - 1}
                      className="p-0.5 text-rmpg-500 hover:text-rmpg-200 disabled:opacity-30 transition-colors"
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                  </div>
                </td>

                {/* Channel ID */}
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Wifi className={`w-3.5 h-3.5 ${ch.is_active ? 'text-green-400' : 'text-rmpg-600'}`} />
                    <code className="text-rmpg-200 font-mono text-[11px]">{ch.id}</code>
                  </div>
                </td>

                {/* Label */}
                <td className="px-3 py-2">
                  {editingId === ch.id ? (
                    <input
                      type="text"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      className="w-full px-1.5 py-0.5 bg-rmpg-800 border border-brand-500 text-rmpg-100 text-xs outline-none"
                      autoFocus
                    />
                  ) : (
                    <span className="text-rmpg-100 font-bold">{ch.label}</span>
                  )}
                </td>

                {/* Frequency */}
                <td className="px-3 py-2">
                  {editingId === ch.id ? (
                    <input
                      type="text"
                      value={editFreq}
                      onChange={(e) => setEditFreq(e.target.value)}
                      className="w-full px-1.5 py-0.5 bg-rmpg-800 border border-brand-500 text-rmpg-100 text-xs outline-none"
                    />
                  ) : (
                    <span className="text-rmpg-300 font-mono text-[11px]">{ch.freq} MHz</span>
                  )}
                </td>

                {/* Status */}
                <td className="px-3 py-2 text-center">
                  <button type="button"
                    onClick={() => handleToggle(ch)}
                    className="inline-flex items-center gap-1 transition-colors"
                    title={ch.is_active ? 'Click to disable' : 'Click to enable'}
                  >
                    {ch.is_active ? (
                      <>
                        <ToggleRight className="w-5 h-5 text-green-400" />
                        <span className="text-[9px] text-green-400 font-bold uppercase">Active</span>
                      </>
                    ) : (
                      <>
                        <ToggleLeft className="w-5 h-5 text-rmpg-500" />
                        <span className="text-[9px] text-rmpg-500 font-bold uppercase">Disabled</span>
                      </>
                    )}
                  </button>
                </td>

                {/* Actions */}
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {editingId === ch.id ? (
                      <>
                        <button type="button"
                          onClick={saveEdit}
                          disabled={saving}
                          className="p-1 text-green-400 hover:text-green-300 transition-colors"
                          title="Save"
                        >
                          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        </button>
                        <button type="button"
                          onClick={cancelEdit}
                          className="p-1 text-rmpg-400 hover:text-rmpg-200 transition-colors"
                          title="Cancel"
                         aria-label="Close" title="Close">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button"
                          onClick={() => startEdit(ch)}
                          className="p-1 text-rmpg-400 hover:text-brand-400 transition-colors"
                          title="Edit"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button type="button"
                          onClick={() => handleDelete(ch)}
                          className="p-1 text-rmpg-500 hover:text-red-400 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {channels.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-rmpg-500 text-xs">
                  No radio channels configured. Click "Add Channel" to create one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Info box */}
      <div className="panel-surface border border-rmpg-700 p-3 text-[10px] text-rmpg-400 space-y-1">
        <p className="font-bold text-rmpg-300 uppercase tracking-wider">How Radio Channels Work</p>
        <p>Radio channels are used by the PTT (Push-to-Talk) radio system. Active channels appear in the RadioPage channel selector for all officers. The frequency field is cosmetic — actual audio is transmitted over WebSocket.</p>
        <p>Disabling a channel hides it from the selector but preserves its configuration. Officers currently on a disabled channel will not be disconnected until they switch.</p>
      </div>
    </div>
  );
}
