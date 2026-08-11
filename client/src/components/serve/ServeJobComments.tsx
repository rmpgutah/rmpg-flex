import React, { useEffect, useState, useRef } from 'react';
import { MessageSquare, Send, Bot, User } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { safeDateStr, safeTimeStr } from '../../utils/dateUtils';

interface Comment {
  id: number;
  author_name: string;
  author_role: string | null;
  body: string;
  created_at: string;
  is_system: number;
}

interface ServeJobCommentsProps {
  jobId: number;
  className?: string;
}

export default function ServeJobComments({ jobId, className = '' }: ServeJobCommentsProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = () =>
    apiFetch<Comment[]>(`/serve/${jobId}/comments`)
      .then(setComments)
      .catch(() => {});

  useEffect(() => { load(); }, [jobId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [comments]);

  const submit = async () => {
    const text = draft.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/serve/${jobId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: text }),
      });
      setDraft('');
      await load();
    } catch {
      setError('Failed to post comment.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider"
        style={{ color: 'var(--panel-header-color)' }}>
        <MessageSquare className="w-3 h-3" />
        Job Comments
        {comments.length > 0 && (
          <span className="text-rmpg-400 font-normal">({comments.length})</span>
        )}
      </div>

      {/* Thread */}
      <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
        {comments.length === 0 && (
          <p className="text-[10px] text-rmpg-400 italic">No comments yet.</p>
        )}
        {comments.map((c) => (
          <div key={c.id}
            className={`rounded-[2px] border px-2 py-1.5 text-[10px] ${
              c.is_system
                ? 'bg-amber-900/20 border-amber-700/40'
                : 'bg-surface-raised border-border-default'
            }`}>
            <div className="flex items-center gap-1 mb-0.5">
              {c.is_system
                ? <Bot className="w-2.5 h-2.5 text-amber-400 flex-shrink-0" />
                : <User className="w-2.5 h-2.5 text-rmpg-400 flex-shrink-0" />}
              <span className={`font-bold ${c.is_system ? 'text-amber-300' : 'text-rmpg-200'}`}>
                {c.author_name}
              </span>
              {c.author_role && !c.is_system && (
                <span className="text-rmpg-500 text-[9px]">({c.author_role})</span>
              )}
              <span className="text-rmpg-500 ml-auto">
                {safeDateStr(c.created_at)} {safeTimeStr(c.created_at)}
              </span>
            </div>
            <p className="text-rmpg-200 whitespace-pre-wrap leading-relaxed">{c.body}</p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      {error && <p className="text-[10px] text-red-400">{error}</p>}
      <div className="flex gap-1.5">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); }}
          placeholder="Add a comment… (Ctrl+Enter to send)"
          rows={2}
          className="flex-1 text-[10px] bg-surface-sunken border border-border-default rounded-[2px] px-2 py-1 text-rmpg-100 placeholder-rmpg-500 resize-none focus:outline-none focus:border-brand-400/50"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!draft.trim() || submitting}
          aria-label="Send comment"
          className="px-2 py-1 bg-brand-600/40 border border-brand-500/50 rounded-[2px] text-brand-300 hover:bg-brand-600/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
        >
          <Send className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
