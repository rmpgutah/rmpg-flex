import { useState } from 'react';
import type { Editor } from '@tiptap/core';
import { Camera, RotateCcw, Trash2, Plus } from 'lucide-react';
import IconButton from '../../../components/IconButton';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { listSnapshots, saveSnapshot, deleteSnapshot, type Snapshot } from '../autosave';

/** Version snapshots side panel. Save a named checkpoint of the current document
 *  to localStorage and restore any prior one back into the editor. Backed by the
 *  saveSnapshot/listSnapshots/deleteSnapshot helpers in autosave.ts. */
export default function SnapshotsPanel({
  editor, title, onClose, onRestore,
}: {
  editor: Editor;
  title: string;
  onClose: () => void;
  onRestore?: () => void;
}) {
  const [snaps, setSnaps] = useState<Snapshot[]>(() => listSnapshots().slice().reverse());
  const [name, setName] = useState('');
  const [restoreSnap, setRestoreSnap] = useState<Snapshot | null>(null);
  const [deleteSnap, setDeleteSnap] = useState<Snapshot | null>(null);

  const refresh = () => setSnaps(listSnapshots().slice().reverse());

  const handleSave = () => {
    const label = name.trim() || `${title} — ${new Date().toLocaleString()}`;
    saveSnapshot(label, title, editor.getHTML());
    setName('');
    refresh();
  };

  const handleRestore = (snap: Snapshot) => {
    setRestoreSnap(snap);
  };

  const confirmRestore = () => {
    if (!restoreSnap) return;
    editor.chain().focus().setContent(restoreSnap.html).run();
    onRestore?.();
    setRestoreSnap(null);
  };

  const handleDelete = (snap: Snapshot) => {
    setDeleteSnap(snap);
  };

  const confirmDelete = () => {
    if (!deleteSnap) return;
    deleteSnapshot(deleteSnap.id);
    refresh();
    setDeleteSnap(null);
  };

  return (
    <>
    <div className="w-48 sm:w-64 shrink-0 bg-surface-base border border-border-default rounded-[2px] p-2 overflow-auto flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-rmpg-300 uppercase tracking-wide flex items-center gap-1">
          <Camera className="w-3 h-3" /> Snapshots
        </span>
        <button type="button" onClick={onClose} className="text-[10px] text-rmpg-500 hover:text-rmpg-200">✕</button>
      </div>

      <div className="flex items-center gap-1 mb-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
          placeholder="Snapshot name…"
          aria-label="Snapshot name"
          className="flex-1 min-w-0 bg-surface-base border border-border-default text-rmpg-200 text-[10px] rounded-[2px] px-1.5 py-1 focus:outline-none focus:border-accent-silver-500/50"
        />
        <IconButton aria-label="Save snapshot" onClick={handleSave}
          className="p-1 bg-accent-silver-500/10 border border-accent-silver-500/30 text-accent-silver-300 rounded-[2px] hover:bg-accent-silver-500/20">
          <Plus className="w-3.5 h-3.5" />
        </IconButton>
      </div>

      {snaps.length === 0 && <div className="text-[10px] text-rmpg-600 italic px-1">No snapshots yet</div>}

      <div className="space-y-1">
        {snaps.map((s) => (
          <div key={s.id} className="group border border-border-default rounded-[2px] px-1.5 py-1 hover:border-rmpg-700">
            <div className="text-[11px] text-rmpg-200 truncate" title={s.name}>{s.name}</div>
            <div className="flex items-center justify-between mt-0.5">
              <span className="text-[9px] text-rmpg-600 tabular-nums">{new Date(s.createdAt).toLocaleString()}</span>
              <div className="flex items-center gap-0.5">
                <IconButton aria-label={`Restore ${s.name}`} title="Restore" onClick={() => handleRestore(s)}
                  className="p-0.5 text-rmpg-400 hover:text-accent-silver-300">
                  <RotateCcw className="w-3 h-3" />
                </IconButton>
                <IconButton aria-label={`Delete ${s.name}`} title="Delete" onClick={() => handleDelete(s)}
                  className="p-0.5 text-rmpg-400 hover:text-red-400">
                  <Trash2 className="w-3 h-3" />
                </IconButton>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
    <ConfirmDialog
      isOpen={restoreSnap != null}
      onClose={() => setRestoreSnap(null)}
      onConfirm={confirmRestore}
      title="Restore snapshot"
      message={`Restore "${restoreSnap?.name ?? ''}"? This replaces the current document content.`}
      confirmLabel="Restore"
      confirmVariant="warning"
    />
    <ConfirmDialog
      isOpen={deleteSnap != null}
      onClose={() => setDeleteSnap(null)}
      onConfirm={confirmDelete}
      title="Delete snapshot"
      message={`Delete snapshot "${deleteSnap?.name ?? ''}"?`}
      confirmLabel="Delete"
      confirmVariant="danger"
    />
    </>
  );
}
