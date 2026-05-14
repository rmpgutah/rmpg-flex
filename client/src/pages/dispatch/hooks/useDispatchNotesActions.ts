// ============================================================
// useDispatchNotesActions — Notes + timeline cluster for DispatchPage
// ============================================================
// Owns the 8 handlers that mutate call notes / activity-timeline
// entries, plus their associated input/edit state. Exists to keep
// this cohesive cluster out of the 6,000-line DispatchPage component.
//
// Handlers:
//   Notes:    handleAddNote, handleEditNote, handleDeleteNote,
//             handleQuickNote (alt entrypoint from CallCard),
//             handleBroadcastNote (POSTs to all units)
//   Timeline: handleAddTimeline, handleEditTimeline, handleDeleteTimeline
//
// State staying in DispatchPage (passed in as args):
//   selectedCall / setSelectedCall / calls / setCalls / setActivityEntries
//
// State owned here (returned to JSX):
//   newNote, editingNoteId, editingNoteText (note input + inline-edit)
//   newTimelineText, showAddTimeline (timeline-add input)
//   editingTimelineId, editTimelineText (timeline inline-edit)
//   broadcastNoteText, isBroadcasting (broadcast composer)
//
// NOT moved (stays in DispatchPage): renderFormattedText (pure render
// helper, no state) and wrapNoteSelection (touches a noteTextareaRef
// owned by DispatchPage). Those access newNote/setNewNote via the
// hook return like any other JSX consumer.

import { useCallback, useState } from 'react';
import type { CallForService, CallNote } from '../../../types';
import { apiFetch } from '../../../hooks/useApi';
import { useToast } from '../../../components/ToastProvider';
import { mapDbCall } from '../utils/dispatchMappers';
import { announceLocalAction } from '../../../utils/voiceAlerts';

export interface UseDispatchNotesActionsArgs {
  selectedCall: CallForService | null;
  setSelectedCall: React.Dispatch<React.SetStateAction<CallForService | null>>;
  calls: CallForService[];
  setCalls: React.Dispatch<React.SetStateAction<CallForService[]>>;
  setActivityEntries: React.Dispatch<React.SetStateAction<any[]>>;
}

export function useDispatchNotesActions(args: UseDispatchNotesActionsArgs) {
  const { selectedCall, setSelectedCall, calls, setCalls, setActivityEntries } = args;
  const { addToast } = useToast();

  // ── Owned state ───────────────────────────────────────────
  // Notes
  const [newNote, setNewNote] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState('');
  // Timeline
  const [newTimelineText, setNewTimelineText] = useState('');
  const [showAddTimeline, setShowAddTimeline] = useState(false);
  const [editingTimelineId, setEditingTimelineId] = useState<string | null>(null);
  const [editTimelineText, setEditTimelineText] = useState('');
  // Broadcast
  const [broadcastNoteText, setBroadcastNoteText] = useState('');
  const [isBroadcasting, setIsBroadcasting] = useState(false);

  // ── Notes handlers ────────────────────────────────────────

  const handleAddNote = useCallback(async () => {
    if (!selectedCall || !newNote.trim()) return;
    const trimmedNote = newNote.trim();
    if (trimmedNote.length > 2000) {
      addToast('Note is too long (max 2000 characters)', 'error');
      return;
    }
    if (trimmedNote.length < 2) {
      addToast('Note must be at least 2 characters', 'error');
      return;
    }
    try {
      const existingNotes = Array.isArray(selectedCall.notes) ? selectedCall.notes : [];
      const note: CallNote = {
        id: `n-${Date.now()}`,
        author: 'Dispatch',
        text: trimmedNote,
        timestamp: new Date().toISOString(),
      };
      const allNotes = [...existingNotes, note];
      const result = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}`, {
        method: 'PUT',
        body: JSON.stringify({ notes: JSON.stringify(allNotes) }),
      });
      const updatedCall = mapDbCall(result);
      setCalls((prev) => prev.map((c) => c.id === selectedCall.id ? updatedCall : c));
      setSelectedCall(updatedCall);
      setNewNote('');
      announceLocalAction('note_added', `Note added to ${selectedCall.call_number}.`);
    } catch (err) {
      console.error('Failed to add note:', err);
      addToast('Failed to save note', 'error');
    }
  }, [selectedCall, newNote, setCalls, setSelectedCall, addToast]);

  const handleEditNote = useCallback(async (noteId: string, text: string) => {
    if (!selectedCall || !text.trim()) return;
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}/notes/${noteId}`, {
        method: 'PUT',
        body: JSON.stringify({ text: text.trim() }),
      });
      const updatedCall = mapDbCall(result);
      setCalls((prev) => prev.map((c) => c.id === selectedCall.id ? updatedCall : c));
      setSelectedCall(updatedCall);
      setEditingNoteId(null);
      setEditingNoteText('');
      addToast('Note updated', 'success');
    } catch {
      addToast('Failed to edit note', 'error');
    }
  }, [selectedCall, setCalls, setSelectedCall, addToast]);

  const handleDeleteNote = useCallback(async (noteId: string) => {
    if (!selectedCall) return;
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}/notes/${noteId}`, {
        method: 'DELETE',
      });
      const updatedCall = mapDbCall(result);
      setCalls((prev) => prev.map((c) => c.id === selectedCall.id ? updatedCall : c));
      setSelectedCall(updatedCall);
      addToast('Note deleted', 'success');
    } catch {
      addToast('Failed to delete note', 'error');
    }
  }, [selectedCall, setCalls, setSelectedCall, addToast]);

  const handleQuickNote = useCallback(async (callId: string, noteText: string) => {
    if (!noteText.trim()) return;
    const call = calls.find((c) => c.id === callId);
    if (!call) return;
    try {
      const existingNotes = Array.isArray(call.notes) ? call.notes : [];
      const note = {
        id: `qn-${Date.now()}`,
        author: 'Dispatch',
        text: noteText,
        timestamp: new Date().toISOString(),
      };
      const allNotes = [...existingNotes, note];
      const result = await apiFetch<any>(`/dispatch/calls/${callId}`, {
        method: 'PUT',
        body: JSON.stringify({ notes: JSON.stringify(allNotes) }),
      });
      const updatedCall = mapDbCall(result);
      setCalls((prev) => prev.map((c) => c.id === callId ? updatedCall : c));
      if (selectedCall?.id === callId) setSelectedCall(updatedCall);
    } catch {
      addToast('Failed to add note', 'error');
    }
  }, [calls, selectedCall, setCalls, setSelectedCall, addToast]);

  const handleBroadcastNote = useCallback(async () => {
    if (!selectedCall || !broadcastNoteText.trim() || isBroadcasting) return;
    setIsBroadcasting(true);
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}/broadcast-note`, {
        method: 'POST',
        body: JSON.stringify({ message: broadcastNoteText.trim() }),
      });
      const updatedCall = mapDbCall(result);
      setCalls((prev) => prev.map((c) => c.id === selectedCall.id ? updatedCall : c));
      setSelectedCall(updatedCall);
      setBroadcastNoteText('');
      addToast('Note broadcast to all units', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Broadcast failed', 'error');
    } finally {
      setIsBroadcasting(false);
    }
  }, [selectedCall, broadcastNoteText, isBroadcasting, setCalls, setSelectedCall, addToast]);

  // ── Timeline handlers ─────────────────────────────────────

  const handleAddTimeline = useCallback(async () => {
    if (!selectedCall || !newTimelineText.trim()) return;
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}/timeline`, {
        method: 'POST',
        body: JSON.stringify({ action: 'note_added', details: newTimelineText.trim() }),
      });
      setActivityEntries((prev) => [result, ...prev]);
      setNewTimelineText('');
      setShowAddTimeline(false);
    } catch (err) {
      console.error('Failed to add timeline entry:', err);
      addToast('Failed to add timeline entry', 'error');
    }
  }, [selectedCall, newTimelineText, setActivityEntries, addToast]);

  const handleEditTimeline = useCallback(async (entryId: string) => {
    if (!selectedCall || !editTimelineText.trim()) return;
    try {
      await apiFetch<any>(`/dispatch/calls/${selectedCall.id}/timeline/${entryId}`, {
        method: 'PUT',
        body: JSON.stringify({ details: editTimelineText.trim() }),
      });
      setActivityEntries((prev) =>
        prev.map((e) => e.id === entryId ? { ...e, details: editTimelineText.trim() } : e),
      );
      setEditingTimelineId(null);
      setEditTimelineText('');
    } catch (err) {
      console.error('Failed to edit timeline entry:', err);
      addToast('Failed to edit timeline entry', 'error');
    }
  }, [selectedCall, editTimelineText, setActivityEntries, addToast]);

  const handleDeleteTimeline = useCallback(async (entryId: string) => {
    if (!selectedCall) return;
    try {
      await apiFetch<any>(`/dispatch/calls/${selectedCall.id}/timeline/${entryId}`, { method: 'DELETE' });
      setActivityEntries((prev) => prev.filter((e) => String(e.id) !== String(entryId)));
    } catch (err) {
      console.error('Failed to delete timeline entry:', err);
      addToast('Failed to delete timeline entry', 'error');
    }
  }, [selectedCall, setActivityEntries, addToast]);

  return {
    // Notes state
    newNote, setNewNote,
    editingNoteId, setEditingNoteId,
    editingNoteText, setEditingNoteText,
    // Timeline state
    newTimelineText, setNewTimelineText,
    showAddTimeline, setShowAddTimeline,
    editingTimelineId, setEditingTimelineId,
    editTimelineText, setEditTimelineText,
    // Broadcast state
    broadcastNoteText, setBroadcastNoteText,
    isBroadcasting,
    // Handlers
    handleAddNote,
    handleEditNote,
    handleDeleteNote,
    handleQuickNote,
    handleBroadcastNote,
    handleAddTimeline,
    handleEditTimeline,
    handleDeleteTimeline,
  };
}
