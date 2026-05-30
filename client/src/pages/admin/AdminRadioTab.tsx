import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Radio, Plus, Edit2, Archive as ArchiveIcon, Loader2, X,
  Search, MessageSquare, Clock,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { asArray } from '../../utils/asArray';
import ConfirmDialog from '../../components/ConfirmDialog';
import IconButton from '../../components/IconButton';
import { safeDateTimeStr } from '../../utils/dateUtils';
import AdminRadioSettings from './AdminRadioSettings';

// ============================================================
// Admin → Radio Channels
// ============================================================
// CRUD over /api/radio/channels (radio_channels table from
// migrations/0038_radio.sql). Transmissions and recordings are
// out of scope here — they're append-only audit logs surfaced
// in the RadioPage operator console, not configuration.
//
// Channels render archived rows dimmed at the bottom of the
// list. Restore-from-archive isn't possible until the backend
// adds it (PATCH whitelist excludes archived_at) — flagged
// inline in the UI rather than silently dropped.
// ============================================================

interface RadioChannel {
  id: number;
  name: string;
  description: string | null;
  frequency: string | null;
  talkgroup: string | null;
  color: string | null;
  is_default: number;
  sort_order: number;
  archived_at: string | null;
  created_at: string;
  tx_count: number;
  last_tx_at: string | null;
}

interface FormState {
  name: string;
  description: string;
  frequency: string;
  talkgroup: string;
  color: string;
  sort_order: number;
}

const emptyForm: FormState = {
  name: '',
  description: '',
  frequency: '',
  talkgroup: '',
  color: '#d4a017',
  sort_order: 0,
};

// Spillman-palette swatches. Keep narrow so the picker stays
// readable on the dark background; users can still type any
// hex into the input.
const COLOR_SWATCHES = ['#d4a017', '#a16207', '#9a3412', '#7f1d1d', '#374151', '#1f2937', '#0f766e', '#4d7c0f'];

export default function AdminRadioTab() {
  const [view, setView] = useState<'channels' | 'settings'>('channels');
  const [channels, setChannels] = useState<RadioChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<RadioChannel | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<RadioChannel | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);

  const fetchChannels = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<RadioChannel[]>('/radio/channels?include_archived=1');
      setChannels(asArray<RadioChannel>(data));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load radio channels');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchChannels(); }, [fetchChannels]);

  // Escape closes whichever modal is open (matches AdminAnnouncementsTab pattern).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (archiveTarget) setArchiveTarget(null);
      else if (showForm) closeForm();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [archiveTarget, showForm]);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = (ch: RadioChannel) => {
    setEditing(ch);
    setForm({
      name: ch.name,
      description: ch.description || '',
      frequency: ch.frequency || '',
      talkgroup: ch.talkgroup || '',
      color: ch.color || '#d4a017',
      sort_order: ch.sort_order ?? 0,
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
    setForm(emptyForm);
  };

  const submit = async () => {
    const name = form.name.trim();
    if (!name) {
      setError('Channel name is required');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        name,
        description: form.description.trim() || null,
        frequency: form.frequency.trim() || null,
        talkgroup: form.talkgroup.trim() || null,
        color: form.color || null,
        sort_order: Number.isFinite(form.sort_order) ? form.sort_order : 0,
      };
      if (editing) {
        await apiFetch(`/radio/channels/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch('/radio/channels', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      closeForm();
      await fetchChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  };

  const archive = async () => {
    if (!archiveTarget) return;
    setArchiveBusy(true);
    try {
      await apiFetch(`/radio/channels/${archiveTarget.id}`, { method: 'DELETE' });
      setArchiveTarget(null);
      await fetchChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Archive failed');
    } finally {
      setArchiveBusy(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return channels;
    return channels.filter(ch =>
      ch.name.toLowerCase().includes(q) ||
      (ch.description || '').toLowerCase().includes(q) ||
      (ch.frequency || '').toLowerCase().includes(q) ||
      (ch.talkgroup || '').toLowerCase().includes(q),
    );
  }, [channels, search]);

  // Active first (sorted by sort_order asc), archived dimmed at bottom.
  const sorted = useMemo(() => {
    const active = filtered.filter(c => !c.archived_at)
      .sort((a, b) => (a.sort_order - b.sort_order) || (a.id - b.id));
    const archived = filtered.filter(c => c.archived_at)
      .sort((a, b) => (a.archived_at || '') < (b.archived_at || '') ? 1 : -1);
    return [...active, ...archived];
  }, [filtered]);

  const activeCount = channels.filter(c => !c.archived_at).length;
  const totalTx = channels.reduce((sum, c) => sum + (Number(c.tx_count) || 0), 0);

  // Sub-tab bar: Channels (CRUD) vs Settings (org-wide AI/recording/audio).
  const subTabs = (
    <div className="flex items-center gap-1 border-b border-[#181818] pb-2">
      {(['channels', 'settings'] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => setView(v)}
          className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider rounded-sm"
          style={{
            color: view === v ? '#d4a017' : '#888',
            background: view === v ? 'rgba(212,160,23,0.10)' : 'transparent',
            border: `1px solid ${view === v ? '#d4a017' : 'transparent'}`,
          }}
        >
          {v}
        </button>
      ))}
    </div>
  );

  if (view === 'settings') {
    return <div className="space-y-3">{subTabs}<AdminRadioSettings /></div>;
  }

  return (
    <div className="space-y-3">
      {subTabs}
      {/* Header */}
      <div className="bg-[#141414] border border-[#181818] rounded-sm p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Radio size={18} className="text-[#d4a017]" />
            <div>
              <h2 className="text-sm font-bold text-gray-200 uppercase tracking-wide">Radio Channels</h2>
              <p className="text-[11px] text-gray-500">
                {loading
                  ? 'Loading…'
                  : `${activeCount} active · ${channels.length - activeCount} archived · ${totalTx.toLocaleString()} total transmissions`}
              </p>
            </div>
          </div>
          <button
            onClick={openNew}
            className="flex items-center gap-1.5 bg-[#d4a017] hover:bg-[#a16207] text-black px-3 py-1.5 rounded-sm text-xs font-semibold transition-colors"
          >
            <Plus size={14} /> New Channel
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="bg-[#141414] border border-[#181818] rounded-sm p-2 flex items-center gap-2">
        <Search size={14} className="text-gray-500" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by name, description, frequency, talkgroup…"
          className="flex-1 bg-transparent text-xs text-gray-200 placeholder-gray-600 outline-none"
        />
      </div>

      {error && (
        <div className="bg-[#1a0a0a] border border-[#3d1414] text-red-400 text-xs px-3 py-2 rounded-sm flex items-start justify-between gap-3">
          <span>{error}</span>
          <IconButton aria-label="Dismiss error" onClick={() => setError(null)}>
            <X size={12} />
          </IconButton>
        </div>
      )}

      {/* List */}
      <div className="bg-[#141414] border border-[#181818] rounded-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="animate-spin text-gray-500" size={20} />
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center text-xs text-gray-500 italic py-8">
            {search ? 'No channels match the filter.' : 'No channels yet — create one to get started.'}
          </div>
        ) : (
          <table className="w-full text-left">
            <thead className="bg-[#0c0c0c] border-b border-[#181818]">
              <tr className="text-[9px] uppercase text-gray-500 font-semibold">
                <th className="px-2 py-[3px] w-8"></th>
                <th className="px-2 py-[3px]">Name</th>
                <th className="px-2 py-[3px]">Frequency</th>
                <th className="px-2 py-[3px]">Talkgroup</th>
                <th className="px-2 py-[3px] text-right">Order</th>
                <th className="px-2 py-[3px] text-right">TX</th>
                <th className="px-2 py-[3px]">Last TX</th>
                <th className="px-2 py-[3px] text-right w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(ch => {
                const isArchived = !!ch.archived_at;
                return (
                  <tr
                    key={ch.id}
                    className={`border-b border-[#181818]/50 hover:bg-[#0c0c0c] ${isArchived ? 'opacity-50' : ''}`}
                  >
                    <td className="px-2 py-[2px]">
                      <span
                        className="inline-block w-3 h-3 rounded-sm border border-[#2e2e2e]"
                        style={{ backgroundColor: ch.color || '#333333' }}
                        title={ch.color || 'no color'}
                      />
                    </td>
                    <td className="px-2 py-[2px] text-[11px]">
                      <div className="text-gray-200 font-medium">
                        {ch.name}
                        {isArchived && <span className="ml-1.5 text-[9px] uppercase text-gray-600">[archived]</span>}
                        {ch.is_default === 1 && <span className="ml-1.5 text-[9px] uppercase text-[#d4a017]">[default]</span>}
                      </div>
                      {ch.description && <div className="text-[10px] text-gray-500 truncate max-w-[24rem]">{ch.description}</div>}
                    </td>
                    <td className="px-2 py-[2px] text-[11px] text-gray-300 font-mono">{ch.frequency || '—'}</td>
                    <td className="px-2 py-[2px] text-[11px] text-gray-300 font-mono">{ch.talkgroup || '—'}</td>
                    <td className="px-2 py-[2px] text-[11px] text-gray-400 text-right font-mono">{ch.sort_order}</td>
                    <td className="px-2 py-[2px] text-[11px] text-gray-300 text-right font-mono">
                      <span className="inline-flex items-center gap-1">
                        <MessageSquare size={9} className="text-gray-600" />
                        {(Number(ch.tx_count) || 0).toLocaleString()}
                      </span>
                    </td>
                    <td className="px-2 py-[2px] text-[10px] text-gray-500">
                      {ch.last_tx_at ? (
                        <span className="inline-flex items-center gap-1">
                          <Clock size={9} />
                          {safeDateTimeStr(ch.last_tx_at)}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-2 py-[2px] text-right">
                      <div className="inline-flex items-center gap-1">
                        <IconButton aria-label="Edit channel" onClick={() => openEdit(ch)} disabled={isArchived}>
                          <Edit2 size={12} />
                        </IconButton>
                        <IconButton aria-label="Archive channel" onClick={() => setArchiveTarget(ch)} disabled={isArchived}>
                          <ArchiveIcon size={12} />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-[10px] text-gray-600 italic">
        Archive is a soft-delete — transmission history stays intact. Channel restore isn't supported yet (would need a backend addition to the PATCH whitelist).
      </p>

      {/* Form modal */}
      {showForm && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in"
          onClick={closeForm}
          role="dialog"
          aria-modal="true"
          aria-label={editing ? 'Edit radio channel' : 'New radio channel'}
        >
          <div
            className="bg-[#0a0a0a] border border-[#2e2e2e] rounded-sm w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-[#181818] px-3 py-2 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase text-gray-200 tracking-wide">
                {editing ? `Edit "${editing.name}"` : 'New Radio Channel'}
              </h3>
              <IconButton aria-label="Close" onClick={closeForm}>
                <X size={14} />
              </IconButton>
            </div>
            <div className="p-3 space-y-2.5">
              <div>
                <label className="block text-[10px] uppercase text-gray-500 mb-0.5">Name *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Dispatch Main"
                  className="w-full bg-[#0c0c0c] border border-[#1a1a1a] rounded-sm px-2 py-1 text-xs text-gray-200 focus:border-[#d4a017] outline-none"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase text-gray-500 mb-0.5">Description</label>
                <input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="What this channel is used for"
                  className="w-full bg-[#0c0c0c] border border-[#1a1a1a] rounded-sm px-2 py-1 text-xs text-gray-200 focus:border-[#d4a017] outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] uppercase text-gray-500 mb-0.5">Frequency</label>
                  <input
                    value={form.frequency}
                    onChange={(e) => setForm({ ...form, frequency: e.target.value })}
                    placeholder="155.475 MHz"
                    className="w-full bg-[#0c0c0c] border border-[#1a1a1a] rounded-sm px-2 py-1 text-xs text-gray-200 font-mono focus:border-[#d4a017] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase text-gray-500 mb-0.5">Talkgroup</label>
                  <input
                    value={form.talkgroup}
                    onChange={(e) => setForm({ ...form, talkgroup: e.target.value })}
                    placeholder="TG-1234"
                    className="w-full bg-[#0c0c0c] border border-[#1a1a1a] rounded-sm px-2 py-1 text-xs text-gray-200 font-mono focus:border-[#d4a017] outline-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] uppercase text-gray-500 mb-0.5">Color</label>
                  <div className="flex items-center gap-1.5">
                    <input
                      value={form.color}
                      onChange={(e) => setForm({ ...form, color: e.target.value })}
                      placeholder="#d4a017"
                      className="flex-1 bg-[#0c0c0c] border border-[#1a1a1a] rounded-sm px-2 py-1 text-xs text-gray-200 font-mono focus:border-[#d4a017] outline-none"
                    />
                    <span
                      className="inline-block w-6 h-6 rounded-sm border border-[#2e2e2e] flex-shrink-0"
                      style={{ backgroundColor: form.color || '#333333' }}
                    />
                  </div>
                  <div className="flex gap-1 mt-1">
                    {COLOR_SWATCHES.map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setForm({ ...form, color: c })}
                        aria-label={`Use color ${c}`}
                        className={`w-4 h-4 rounded-sm border ${form.color === c ? 'border-white' : 'border-[#2e2e2e]'}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] uppercase text-gray-500 mb-0.5">Sort Order</label>
                  <input
                    type="number"
                    value={form.sort_order}
                    onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value, 10) || 0 })}
                    className="w-full bg-[#0c0c0c] border border-[#1a1a1a] rounded-sm px-2 py-1 text-xs text-gray-200 font-mono focus:border-[#d4a017] outline-none"
                  />
                  <p className="text-[9px] text-gray-600 mt-0.5">Lower = higher in operator picker.</p>
                </div>
              </div>
            </div>
            <div className="border-t border-[#181818] px-3 py-2 flex items-center justify-end gap-2">
              <button
                onClick={closeForm}
                disabled={submitting}
                className="text-xs text-gray-400 hover:text-gray-200 px-2 py-1 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={submitting || !form.name.trim()}
                className="flex items-center gap-1.5 bg-[#d4a017] hover:bg-[#a16207] disabled:opacity-50 text-black px-3 py-1 rounded-sm text-xs font-semibold transition-colors"
              >
                {submitting && <Loader2 size={11} className="animate-spin" />}
                {editing ? 'Save Changes' : 'Create Channel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Archive confirm */}
      <ConfirmDialog
        isOpen={!!archiveTarget}
        title="Archive Radio Channel"
        message={archiveTarget ? `Archive "${archiveTarget.name}"? Operators won't see it anymore, but the ${archiveTarget.tx_count} transmission(s) on it stay in the audit log.` : ''}
        confirmLabel="Archive"
        confirmVariant="danger"
        isLoading={archiveBusy}
        onConfirm={archive}
        onClose={() => setArchiveTarget(null)}
      />
    </div>
  );
}
