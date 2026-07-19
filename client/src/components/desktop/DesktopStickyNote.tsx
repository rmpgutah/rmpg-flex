import React from 'react';
import { X } from 'lucide-react';
import { useDraggablePosition } from '../../hooks/useDraggablePosition';
import type { DesktopNote } from '../../hooks/useDesktopNotes';
import { DESKTOP_ACCENTS, getAccent } from '../../data/desktopAccents';

export interface DesktopStickyNoteProps {
  note: DesktopNote;
  onChange: (patch: Partial<DesktopNote>) => void;
  onDelete: () => void;
}

export default function DesktopStickyNote({ note, onChange, onDelete }: DesktopStickyNoteProps) {
  const { onPointerDown } = useDraggablePosition(note.x, note.y, (x, y) => onChange({ x, y }));
  const accent = getAccent(note.color);

  return (
    <div
      style={{
        position: 'absolute', left: note.x, top: note.y, width: note.width, height: note.height,
        background: 'var(--surface-raised)', border: `1px solid ${accent.accent}`, boxShadow: `0 2px 8px ${accent.shadow}`,
        display: 'flex', flexDirection: 'column',
      }}
    >
      <div onPointerDown={onPointerDown} className="flex items-center justify-between px-1.5 py-1" style={{ cursor: 'move', borderBottom: `1px solid ${accent.accent}` }}>
        <div className="flex gap-1">
          {DESKTOP_ACCENTS.map(a => (
            <button
              key={a.id}
              type="button"
              aria-label={`Note color: ${a.label}`}
              onClick={() => onChange({ color: a.id })}
              style={{ width: 10, height: 10, borderRadius: '50%', background: a.accent, border: note.color === a.id ? '1px solid var(--text-primary)' : 'none' }}
            />
          ))}
        </div>
        <button type="button" aria-label="Delete note" onClick={onDelete}>
          <X className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
        </button>
      </div>
      <textarea
        value={note.text}
        onChange={(e) => onChange({ text: e.target.value })}
        className="flex-1 w-full p-2 text-[11px] resize-none bg-transparent focus:outline-none"
        style={{ color: 'var(--text-primary)' }}
      />
    </div>
  );
}
