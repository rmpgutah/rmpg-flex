import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { dialerApi, type PresencePeer } from './dialerApi';

export default function TransferPicker({ mode, onPick, onClose }: {
  mode: 'blind' | 'warm';
  onPick(targetDispatcherId: string): void;
  onClose(): void;
}) {
  const [peers, setPeers] = useState<PresencePeer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    dialerApi.listPresence().then(setPeers).catch((e) => setError(e instanceof Error ? e.message : 'Could not load dispatchers'));
  }, []);
  return (
    <div className="bg-surface-sunken border border-border-subtle p-2 space-y-1" role="dialog" aria-label={`${mode} transfer`}>
      <div className="flex items-center justify-between text-[9px] uppercase tracking-widest text-fg-muted">
        <span>{mode === 'warm' ? 'Warm transfer — announce, then hang up' : 'Blind transfer — caller moves immediately'}</span>
        <button type="button" aria-label="Close transfer picker" onClick={onClose}><X className="w-3 h-3" /></button>
      </div>
      {error && <div className="text-[10px]" style={{ color: 'var(--sev-critical)' }}>{error}</div>}
      {peers && peers.length === 0 && <div className="text-[10px] text-fg-muted">No other dispatchers are online.</div>}
      {peers?.map((p) => (
        <button
          key={p.id}
          type="button"
          disabled={p.dnd}
          onClick={() => onPick(p.id)}
          className="w-full text-left px-2 py-1 text-[11px] text-rmpg-100 hover:bg-surface-hover disabled:opacity-40 flex items-center justify-between"
        >
          <span>{p.name}</span>
          <span className="text-[9px] text-fg-muted">{p.dnd ? 'DND' : p.agency}</span>
        </button>
      ))}
    </div>
  );
}
