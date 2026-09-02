import React, { useState, useEffect, useCallback } from 'react';
import { NotebookPen, Plus, Trash2, Eye, EyeOff, Users, Tag, X, Download, Copy, Search } from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { parseTimestamp } from '../utils/dateUtils';
import { downloadTextFile, shiftNotesToCsv } from '../utils/rmsListExport';

interface ShiftNote {
  id: number;
  officer_name: string;
  content: string;
  visibility: 'private' | 'supervisor' | 'all';
  tags: string[];
  created_at: string;
  shift_date: string;
}

const QUICK_TAGS = [
  'Observation', 'Patrol', 'FI', 'Traffic', 'Complaint',
  'Property', 'People', 'Safety', 'Reminder',
];

const SUPERVISOR_ROLES = ['admin', 'manager', 'supervisor'];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatTime(iso: string): string {
  try {
    return parseTimestamp(iso).toLocaleTimeString('en-US', {
      timeZone: 'America/Denver', hour: '2-digit', minute: '2-digit', hour12: true,
    });
  } catch {
    return iso;
  }
}

function VisibilityBadge({ visibility }: { visibility: ShiftNote['visibility'] }) {
  const styles: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
    private: {
      label: 'Private',
      icon: <EyeOff size={11} />,
      color: 'color:var(--text-secondary)',
    },
    supervisor: {
      label: 'Supervisor',
      icon: <Eye size={11} />,
      color: 'color:var(--sev-warn)',
    },
    all: {
      label: 'All',
      icon: <Users size={11} />,
      color: 'color:var(--sev-ok)',
    },
  };
  const cfg = styles[visibility] ?? styles.private;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        fontSize: 10,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        padding: '1px 6px',
        borderRadius: 2,
        background: 'var(--surface-sunken, rgba(0 0 0 / 0.3))',
        border: '1px solid var(--border-subtle)',
        ...Object.fromEntries(cfg.color.split(';').filter(Boolean).map(s => {
          const [k, v] = s.split(':');
          return [k.trim().replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase()), v.trim()];
        })),
      }}
    >
      {cfg.icon}{cfg.label}
    </span>
  );
}

export default function ShiftNotesPage() {
  const { user } = useAuth();
  const isSupervisor = SUPERVISOR_ROLES.includes(user?.role ?? '');

  const [activeTab, setActiveTab] = useState<'mine' | 'all'>('mine');
  const [shiftDate, setShiftDate] = useState(todayIso());
  const [notes, setNotes] = useState<ShiftNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [content, setContent] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'supervisor' | 'all'>('supervisor');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [noteSearch, setNoteSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [visFilter, setVisFilter] = useState('');

  const MAX_CHARS = 2000;

  const fetchNotes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ notes: ShiftNote[] }>(
        `/shift-notes?shift_date=${shiftDate}`,
      );
      setNotes(data.notes ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load notes');
    } finally {
      setLoading(false);
    }
  }, [shiftDate]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const toggleTag = (tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await apiFetch('/shift-notes', {
        method: 'POST',
        body: JSON.stringify({
          content: content.trim(),
          visibility,
          tags: selectedTags,
          shift_date: shiftDate,
        }),
      });
      setContent('');
      setSelectedTags([]);
      setVisibility('supervisor');
      fetchNotes();
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to save note');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      await apiFetch(`/shift-notes/${id}`, { method: 'DELETE' });
      setNotes(prev => prev.filter(n => n.id !== id));
      setConfirmDeleteId(null);
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to delete note');
    } finally {
      setDeletingId(null);
    }
  };

  const displayedNotes = (activeTab === 'mine'
    ? notes.filter(n => n.officer_name === (user?.first_name ? `${user.first_name} ${user.last_name ?? ''}`.trim() : (user?.username ?? '')))
    : notes
  ).filter(n => {
    if (tagFilter && !(n.tags ?? []).includes(tagFilter)) return false;
    if (visFilter && n.visibility !== visFilter) return false;
    const q = noteSearch.trim().toLowerCase();
    if (!q) return true;
    return n.content.toLowerCase().includes(q) || n.officer_name.toLowerCase().includes(q);
  });

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, minHeight: '100%' }}>
      <PanelTitleBar title="SHIFT NOTES" icon={NotebookPen} />

      {/* Controls row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 11, color: 'var(--field-label-color)', fontWeight: 600, letterSpacing: '0.04em' }}>
          SHIFT DATE
        </label>
        <input
          type="date"
          value={shiftDate}
          onChange={e => setShiftDate(e.target.value)}
          style={{
            background: 'var(--surface-raised)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 2,
            color: 'var(--text-primary)',
            fontSize: 12,
            padding: '3px 7px',
          }}
        />

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, marginLeft: 8, border: '1px solid var(--border-subtle)', borderRadius: 2, overflow: 'hidden' }}>
          {(['mine', ...(isSupervisor ? ['all'] : [])] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as 'mine' | 'all')}
              style={{
                padding: '4px 14px',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                border: 'none',
                borderRadius: 0,
                cursor: 'pointer',
                background: activeTab === tab ? 'var(--brand-400)' : 'var(--surface-raised)',
                color: activeTab === tab ? 'var(--surface-base)' : 'var(--text-secondary)',
                transition: 'background 0.15s',
              }}
            >
              {tab === 'mine' ? 'My Notes' : 'All Notes'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          <Search size={12} color="var(--text-secondary)" />
          <input
            value={noteSearch}
            onChange={e => setNoteSearch(e.target.value)}
            placeholder="Search notes…"
            aria-label="Search shift notes"
            style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 2, color: 'var(--text-primary)', fontSize: 12, padding: '3px 7px' }}
          />
          <select
            value={visFilter}
            onChange={e => setVisFilter(e.target.value)}
            style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 2, color: 'var(--text-primary)', fontSize: 11, padding: '3px 6px' }}
          >
            <option value="">All visibility</option>
            <option value="private">Private</option>
            <option value="supervisor">Supervisor</option>
            <option value="all">All officers</option>
          </select>
          <button
            type="button"
            disabled={displayedNotes.length === 0}
            onClick={() => downloadTextFile('shift-notes.csv', shiftNotesToCsv(displayedNotes))}
            style={{ fontSize: 10, padding: '3px 8px', border: '1px solid var(--border-subtle)', borderRadius: 2, background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer' }}
          >
            CSV
          </button>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(displayedNotes.map(n => n.content).join('\n\n')).catch(() => undefined)}
            style={{ fontSize: 10, padding: '3px 8px', border: '1px solid var(--border-subtle)', borderRadius: 2, background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer' }}
          >
            Copy visible
          </button>
        </div>
      </div>

      {/* New note form */}
      <form
        onSubmit={handleSubmit}
        style={{
          background: 'var(--surface-raised)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 2,
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Plus size={13} /> NEW NOTE
        </div>

        <textarea
          value={content}
          onChange={e => setContent(e.target.value.slice(0, MAX_CHARS))}
          onKeyDown={e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
            }
            if (e.key === 'Escape') {
              setContent('');
              setSelectedTags([]);
            }
          }}
          rows={4}
          placeholder="Write your shift observation, reminder, or note… (Ctrl+Enter to save)"
          style={{
            background: 'var(--surface-base)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 2,
            color: 'var(--text-primary)',
            fontSize: 13,
            padding: '8px 10px',
            resize: 'vertical',
            outline: 'none',
            fontFamily: 'inherit',
            lineHeight: 1.5,
          }}
        />
        <div style={{ fontSize: 10, color: content.length >= MAX_CHARS ? 'var(--sev-critical)' : 'var(--text-secondary)', textAlign: 'right' }}>
          {content.length} / {MAX_CHARS}
        </div>

        {/* Quick tags */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
          <Tag size={12} color="var(--field-label-color)" />
          {QUICK_TAGS.map(tag => (
            <button
              key={tag}
              type="button"
              onClick={() => toggleTag(tag)}
              style={{
                padding: '2px 8px',
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.03em',
                borderRadius: 2,
                border: `1px solid ${selectedTags.includes(tag) ? 'var(--brand-400)' : 'var(--border-subtle)'}`,
                background: selectedTags.includes(tag) ? 'var(--brand-400)' : 'transparent',
                color: selectedTags.includes(tag) ? 'var(--surface-base)' : 'var(--text-secondary)',
                cursor: 'pointer',
                transition: 'all 0.12s',
              }}
            >
              {tag}
            </button>
          ))}
        </div>

        {/* Visibility + submit */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 11, color: 'var(--field-label-color)', fontWeight: 600 }}>VISIBILITY</label>
          <select
            value={visibility}
            onChange={e => setVisibility(e.target.value as typeof visibility)}
            style={{
              background: 'var(--surface-base)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 2,
              color: 'var(--text-primary)',
              fontSize: 12,
              padding: '3px 7px',
            }}
          >
            <option value="private">Private (only me)</option>
            <option value="supervisor">Supervisor+</option>
            <option value="all">All Officers</option>
          </select>

          <button
            type="submit"
            disabled={submitting || !content.trim()}
            style={{
              marginLeft: 'auto',
              padding: '5px 18px',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              borderRadius: 2,
              border: 'none',
              background: submitting || !content.trim() ? 'var(--surface-sunken, rgba(0 0 0 / 0.3))' : 'var(--brand-400)',
              color: submitting || !content.trim() ? 'var(--text-secondary)' : 'var(--surface-base)',
              cursor: submitting || !content.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? 'Saving…' : 'Save Note'}
          </button>
        </div>

        {submitError && (
          <div style={{ fontSize: 11, color: 'var(--sev-critical)' }}>{submitError}</div>
        )}
      </form>

      {/* Notes list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading && (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', padding: 12, textAlign: 'center' }}>
            Loading notes…
          </div>
        )}
        {error && (
          <div style={{ fontSize: 12, color: 'var(--sev-critical)', padding: 12 }}>{error}</div>
        )}
        {!loading && !error && displayedNotes.length === 0 && (
          <div style={{
            fontSize: 13,
            color: 'var(--text-secondary)',
            textAlign: 'center',
            padding: '32px 16px',
            background: 'var(--surface-raised)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 2,
          }}>
            No notes for this shift.
          </div>
        )}
        {confirmDeleteId !== null && (
          <div style={{ fontSize: 12, color: 'var(--sev-critical)', padding: 8, border: '1px solid var(--border-subtle)', borderRadius: 2 }}>
            Delete this note?
            <button type="button" onClick={() => handleDelete(confirmDeleteId)} style={{ marginLeft: 8 }}>Confirm</button>
            <button type="button" onClick={() => setConfirmDeleteId(null)} style={{ marginLeft: 8 }}>Cancel</button>
          </div>
        )}
        {!loading && displayedNotes.map(note => {
          const isOwn = note.officer_name === (user?.first_name ? `${user.first_name} ${user.last_name ?? ''}`.trim() : (user?.username ?? ''));
          return (
            <div
              key={note.id}
              style={{
                background: 'var(--surface-raised)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 2,
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 7,
              }}
            >
              {/* Header row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {note.officer_name}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                  {formatTime(note.created_at)}
                </span>
                <VisibilityBadge visibility={note.visibility} />
                {isOwn && (
                  <button
                    onClick={() => setConfirmDeleteId(note.id)}
                    disabled={deletingId === note.id}
                    aria-label="Delete note"
                    style={{
                      marginLeft: 'auto',
                      background: 'transparent',
                      border: 'none',
                      cursor: deletingId === note.id ? 'not-allowed' : 'pointer',
                      color: 'var(--sev-critical)',
                      padding: 2,
                      display: 'flex',
                      alignItems: 'center',
                      opacity: deletingId === note.id ? 0.4 : 1,
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>

              {/* Tags */}
              {note.tags && note.tags.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {note.tags.map(tag => (
                    <span
                      key={tag}
                      role="button"
                      tabIndex={0}
                      onClick={() => setTagFilter(tagFilter === tag ? '' : tag)}
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '1px 6px',
                        borderRadius: 2,
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--text-secondary)',
                        background: 'var(--surface-base)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3,
                      }}
                    >
                      <X size={8} />{tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Content */}
              <p style={{
                fontSize: 13,
                color: 'var(--text-primary)',
                lineHeight: 1.55,
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                {note.content}
              </p>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(note.content).catch(() => undefined)}
                style={{ alignSelf: 'flex-start', fontSize: 10, background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <Copy size={10} /> Copy
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
