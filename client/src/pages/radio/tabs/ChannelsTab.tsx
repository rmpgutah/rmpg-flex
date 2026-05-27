// ChannelsTab — browse / favorite / mute / create / edit / archive.
// Selecting a channel jumps back to LiveTab via onSelectChannel.
import { useCallback, useEffect, useState } from 'react';
import { Plus, Star, VolumeX, Archive, ChevronRight, Radio } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { ls } from '../helpers';
import { SectionHeader, MiniToggle, ToolbarBtn } from '../components';
import type { RadioChannel } from '../types';

interface Props {
  selectedChannelId: number | null;
  onSelectChannel: (id: number) => void;
}

export default function ChannelsTab({ selectedChannelId, onSelectChannel }: Props) {
  const [channels, setChannels] = useState<RadioChannel[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(() => ls.getSet('radio_favorites'));
  const [muted, setMuted] = useState<Set<string>>(() => ls.getSet('radio_muted_channels'));
  const [includeArchived, setIncludeArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const load = useCallback(() => {
    apiFetch<RadioChannel[]>(`/radio/channels${includeArchived ? '?include_archived=1' : ''}`)
      .then(setChannels)
      .catch((err) => console.error('[radio] channels', err));
  }, [includeArchived]);

  useEffect(() => { load(); }, [load]);

  const toggleFav = (id: number) => {
    const next = new Set(favorites);
    const key = String(id);
    if (next.has(key)) next.delete(key); else next.add(key);
    setFavorites(next);
    ls.setSet('radio_favorites', next);
  };

  const toggleMute = (id: number) => {
    const next = new Set(muted);
    const key = String(id);
    if (next.has(key)) next.delete(key); else next.add(key);
    setMuted(next);
    ls.setSet('radio_muted_channels', next);
  };

  const createChannel = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await apiFetch('/radio/channels', { method: 'POST', body: JSON.stringify({ name, description: newDesc.trim() || null }) });
      setNewName(''); setNewDesc(''); setCreating(false);
      load();
    } catch (err) { console.error('[radio] create channel', err); }
  };

  const archive = async (id: number) => {
    if (!confirm('Archive this channel? Existing transmissions are kept.')) return;
    try {
      await apiFetch(`/radio/channels/${id}`, { method: 'DELETE' });
      load();
    } catch (err) { console.error('[radio] archive', err); }
  };

  return (
    <div className="h-full flex flex-col">
      <SectionHeader
        icon={<Radio className="w-3 h-3" style={{ color: 'var(--rt-accent)' }} />}
        label={`CHANNELS — ${channels.length}`}
        trailing={
          <div className="flex items-center gap-2">
            <ToolbarBtn onClick={() => setIncludeArchived((v) => !v)} active={includeArchived}>
              <Archive className="w-3 h-3" /> ARCHIVED
            </ToolbarBtn>
            <ToolbarBtn onClick={() => setCreating((v) => !v)} active={creating}>
              <Plus className="w-3 h-3" /> NEW
            </ToolbarBtn>
          </div>
        }
      />

      {creating && (
        <div className="px-3 py-2 flex flex-col gap-2"
          style={{ background: 'var(--rt-panel)', borderBottom: '1px solid var(--rt-border)' }}>
          <input
            type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
            placeholder="Channel name (e.g. Tac-2)"
            aria-label="New channel name"
            className="bg-transparent text-[11px] font-mono outline-none px-2 py-1"
            style={{ color: 'var(--rt-text)', border: '1px solid var(--rt-border)' }}
          />
          <input
            type="text" value={newDesc} onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Description (optional)"
            aria-label="New channel description"
            className="bg-transparent text-[11px] font-mono outline-none px-2 py-1"
            style={{ color: 'var(--rt-text)', border: '1px solid var(--rt-border)' }}
          />
          <div className="flex gap-2">
            <ToolbarBtn onClick={createChannel}>CREATE</ToolbarBtn>
            <ToolbarBtn onClick={() => { setCreating(false); setNewName(''); setNewDesc(''); }}>CANCEL</ToolbarBtn>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto">
        <ul className="divide-y" style={{ borderColor: 'var(--rt-border)' }}>
          {channels.map((c) => {
            const isFav = favorites.has(String(c.id));
            const isMuted = muted.has(String(c.id));
            const isSelected = c.id === selectedChannelId;
            const isArchived = c.archived_at != null;
            return (
              <li key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-mono hover:bg-black/30"
                style={{ background: isSelected ? 'rgba(212,160,23,0.10)' : 'transparent', opacity: isArchived ? 0.5 : 1 }}>
                <MiniToggle onClick={() => toggleFav(c.id)} active={isFav} title="Favorite">
                  <Star className="w-3 h-3" />
                </MiniToggle>
                <MiniToggle onClick={() => toggleMute(c.id)} active={isMuted} title="Mute">
                  <VolumeX className="w-3 h-3" />
                </MiniToggle>
                <button type="button" onClick={() => onSelectChannel(c.id)}
                  className="flex-1 flex items-center gap-2 text-left">
                  <span className="font-bold tracking-wider" style={{ color: 'var(--rt-text)' }}>{c.name}</span>
                  {c.description && <span style={{ color: 'var(--rt-muted)' }}>— {c.description}</span>}
                </button>
                <span className="tabular-nums" style={{ color: 'var(--rt-muted)' }}>{c.tx_count} tx</span>
                {!isArchived && (
                  <button type="button" onClick={() => archive(c.id)} title="Archive channel"
                    aria-label={`Archive ${c.name}`}
                    className="opacity-60 hover:opacity-100"
                    style={{ color: 'var(--rt-muted)' }}>
                    <Archive className="w-3 h-3" />
                  </button>
                )}
                <ChevronRight className="w-3 h-3" style={{ color: 'var(--rt-muted)' }} />
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
