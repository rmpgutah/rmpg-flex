import React, { useState, useEffect, useCallback } from 'react';
import { Megaphone, Send, Clock, AlertTriangle, CheckCircle, X } from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';

type Priority = 'routine' | 'urgent' | 'emergency';
type Target = 'all' | 'shift' | 'unit';

interface BroadcastRecord {
  id: number;
  message: string;
  priority: Priority;
  target: Target;
  target_id: string | null;
  sender_name: string;
  created_at: string;
}

interface Unit {
  id: string;
  unit_number: string;
  officer_name?: string;
}

const QUICK_MESSAGES = [
  'All units respond code 3',
  'Scene secured - stand down',
  '10-4 acknowledged',
  'Return to station',
  'Shift briefing in 10 minutes',
];

const PRIORITY_LABELS: Record<Priority, string> = {
  routine: 'Routine',
  urgent: 'Urgent',
  emergency: 'Emergency',
};

const PRIORITY_BADGE: Record<Priority, string> = {
  routine: 'text-rmpg-200 bg-surface-raised border border-rmpg-600',
  urgent: 'text-amber-300 bg-amber-900/30 border border-amber-700',
  emergency: 'text-red-300 bg-red-900/30 border border-red-700',
};

const MAX_CHARS = 500;

function canSend(role: string): boolean {
  return ['admin', 'manager', 'supervisor', 'dispatcher'].includes(role);
}

function canSendEmergency(role: string): boolean {
  return ['admin', 'manager'].includes(role);
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) +
    ' ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function BroadcastMessagePage() {
  const { user } = useAuth();
  const role = user?.role ?? '';

  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState<Priority>('routine');
  const [target, setTarget] = useState<Target>('all');
  const [targetId, setTargetId] = useState('');
  const [units, setUnits] = useState<Unit[]>([]);
  const [history, setHistory] = useState<BroadcastRecord[]>([]);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const showToast = useCallback((text: string, ok: boolean) => {
    setToast({ text, ok });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const data = await apiFetch<BroadcastRecord[]>('/communications/broadcasts?limit=10');
      setHistory(Array.isArray(data) ? data : []);
    } catch {
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  const loadUnits = useCallback(async () => {
    try {
      const data = await apiFetch<Unit[]>('/dispatch/units');
      setUnits(Array.isArray(data) ? data : []);
    } catch {
      setUnits([]);
    }
  }, []);

  useEffect(() => {
    loadHistory();
    loadUnits();
  }, [loadHistory, loadUnits]);

  const doSend = useCallback(async () => {
    if (!message.trim()) return;
    setSending(true);
    setConfirmOpen(false);
    try {
      await apiFetch('/communications/broadcast', {
        method: 'POST',
        body: JSON.stringify({
          message: message.trim(),
          priority,
          target,
          target_id: target === 'unit' ? targetId || undefined : undefined,
        }),
      });
      showToast('Broadcast sent successfully', true);
      setMessage('');
      setPriority('routine');
      setTarget('all');
      setTargetId('');
      await loadHistory();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Send failed';
      showToast(msg, false);
    } finally {
      setSending(false);
    }
  }, [message, priority, target, targetId, showToast, loadHistory]);

  const handleSend = useCallback(() => {
    if (!message.trim()) return;
    if (priority === 'emergency') {
      if (!canSendEmergency(role)) {
        showToast('Emergency broadcasts require admin or manager role', false);
        return;
      }
      setConfirmOpen(true);
      return;
    }
    doSend();
  }, [message, priority, role, doSend, showToast]);

  if (!canSend(role)) {
    return (
      <div className="p-4 space-y-3">
        <PanelTitleBar title="BROADCAST MESSAGE" icon={Megaphone} />
        <div className="rounded bg-surface-raised border border-rmpg-600 p-4 text-rmpg-300 text-xs">
          You do not have permission to send broadcasts. Required: supervisor, dispatcher, manager, or admin.
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 max-w-2xl">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 flex items-center gap-2 rounded border px-3 py-2 text-xs shadow-lg ${
            toast.ok
              ? 'bg-green-900/80 border-green-700 text-green-200'
              : 'bg-red-900/80 border-red-700 text-red-200'
          }`}
        >
          {toast.ok ? <CheckCircle size={13} /> : <AlertTriangle size={13} />}
          {toast.text}
        </div>
      )}

      {/* Emergency confirm modal */}
      {confirmOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
          <div className="rounded border border-red-700 bg-surface-raised p-5 shadow-xl w-80 space-y-3">
            <div className="flex items-center gap-2 text-red-300 font-semibold text-sm">
              <AlertTriangle size={15} />
              Confirm Emergency Broadcast
            </div>
            <p className="text-rmpg-200 text-xs leading-relaxed">
              This will send an <span className="text-red-300 font-semibold">EMERGENCY</span> broadcast to{' '}
              {target === 'all' ? 'all units' : target === 'shift' ? 'current shift' : `unit ${targetId}`}.
              Confirm?
            </p>
            <div className="text-rmpg-300 text-xs bg-surface-base rounded border border-rmpg-600 p-2 italic">
              "{message.slice(0, 120)}{message.length > 120 ? '…' : ''}"
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={() => setConfirmOpen(false)}
                className="px-3 py-1.5 text-xs rounded border border-rmpg-600 text-rmpg-300 hover:bg-surface-base"
              >
                Cancel
              </button>
              <button
                onClick={doSend}
                className="px-3 py-1.5 text-xs rounded border border-red-700 bg-red-900/40 text-red-200 hover:bg-red-900/60"
              >
                Send Emergency
              </button>
            </div>
          </div>
        </div>
      )}

      <PanelTitleBar title="BROADCAST MESSAGE" icon={Megaphone} />

      {/* Compose panel */}
      <div className="rounded border border-rmpg-600 bg-surface-raised p-4 space-y-4">

        {/* Target */}
        <div className="space-y-1">
          <label className="text-[color:var(--field-label-color)] text-[9px] font-semibold uppercase tracking-wider">
            Target
          </label>
          <div className="flex gap-2">
            {(['all', 'shift', 'unit'] as Target[]).map((t) => (
              <button
                key={t}
                onClick={() => setTarget(t)}
                className={`px-3 py-1 text-xs rounded border ${
                  target === t
                    ? 'border-brand-400 bg-brand-900/30 text-rmpg-100'
                    : 'border-rmpg-600 text-rmpg-300 hover:border-rmpg-400'
                }`}
              >
                {t === 'all' ? 'All Units' : t === 'shift' ? 'Current Shift' : 'Specific Unit'}
              </button>
            ))}
          </div>
          {target === 'unit' && (
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className="mt-1 w-full rounded border border-rmpg-600 bg-surface-base text-rmpg-100 text-xs px-2 py-1.5"
            >
              <option value="">— select unit —</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.unit_number}{u.officer_name ? ` — ${u.officer_name}` : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Priority */}
        <div className="space-y-1">
          <label className="text-[color:var(--field-label-color)] text-[9px] font-semibold uppercase tracking-wider">
            Priority
          </label>
          <div className="flex gap-2">
            {(['routine', 'urgent', 'emergency'] as Priority[]).map((p) => (
              <button
                key={p}
                onClick={() => setPriority(p)}
                disabled={p === 'emergency' && !canSendEmergency(role)}
                title={p === 'emergency' && !canSendEmergency(role) ? 'Requires admin or manager' : undefined}
                className={`px-3 py-1 text-xs rounded border ${
                  priority === p
                    ? PRIORITY_BADGE[p]
                    : 'border-rmpg-600 text-rmpg-400 hover:border-rmpg-400 disabled:opacity-40 disabled:cursor-not-allowed'
                } ${p === 'emergency' && !canSendEmergency(role) ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                {PRIORITY_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

        {/* Quick messages */}
        <div className="space-y-1">
          <label className="text-[color:var(--field-label-color)] text-[9px] font-semibold uppercase tracking-wider">
            Quick Messages
          </label>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_MESSAGES.map((q) => (
              <button
                key={q}
                onClick={() => setMessage(q)}
                className="px-2 py-1 text-[10px] rounded border border-rmpg-600 text-rmpg-300 hover:text-rmpg-100 hover:border-rmpg-400 bg-surface-base"
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        {/* Message textarea */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-[color:var(--field-label-color)] text-[9px] font-semibold uppercase tracking-wider">
              Message
            </label>
            <span className={`text-[9px] ${message.length > MAX_CHARS - 50 ? 'text-amber-400' : 'text-rmpg-500'}`}>
              {message.length} / {MAX_CHARS}
            </span>
          </div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, MAX_CHARS))}
            rows={4}
            placeholder="Enter broadcast message…"
            className="w-full rounded border border-rmpg-600 bg-surface-base text-rmpg-100 text-xs px-2 py-2 resize-none focus:outline-none focus:border-brand-500 placeholder:text-rmpg-600"
          />
        </div>

        {/* Send button */}
        <div className="flex justify-end">
          <button
            onClick={handleSend}
            disabled={sending || !message.trim() || (target === 'unit' && !targetId)}
            className={`flex items-center gap-2 px-4 py-2 text-xs rounded border font-semibold ${
              priority === 'emergency'
                ? 'border-red-700 bg-red-900/40 text-red-200 hover:bg-red-900/60'
                : priority === 'urgent'
                ? 'border-amber-700 bg-amber-900/30 text-amber-200 hover:bg-amber-900/50'
                : 'border-brand-600 bg-brand-900/30 text-brand-300 hover:bg-brand-900/50'
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {sending ? (
              <>
                <span className="animate-spin inline-block w-3 h-3 border border-current border-t-transparent rounded-full" />
                Sending…
              </>
            ) : (
              <>
                <Send size={12} />
                Send Broadcast
              </>
            )}
          </button>
        </div>
      </div>

      {/* History */}
      <div className="rounded border border-rmpg-600 bg-surface-raised">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-rmpg-700">
          <Clock size={11} className="text-rmpg-400" />
          <span className="text-[color:var(--panel-header-color)] text-[9px] font-semibold uppercase tracking-wider">
            Recent Broadcasts
          </span>
        </div>
        {loadingHistory ? (
          <div className="p-4 text-rmpg-500 text-xs text-center">Loading…</div>
        ) : history.length === 0 ? (
          <div className="p-4 text-rmpg-500 text-xs text-center">No broadcasts sent yet.</div>
        ) : (
          <div className="divide-y divide-rmpg-700/50">
            {history.map((rec) => (
              <div key={rec.id} className="px-3 py-2 space-y-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded border ${PRIORITY_BADGE[rec.priority]}`}>
                    {PRIORITY_LABELS[rec.priority]}
                  </span>
                  <span className="text-rmpg-400 text-[9px]">
                    {rec.target === 'all' ? 'All Units' : rec.target === 'shift' ? 'Current Shift' : `Unit ${rec.target_id ?? ''}`}
                  </span>
                  <span className="text-rmpg-500 text-[9px] ml-auto">{formatTime(rec.created_at)}</span>
                </div>
                <p className="text-rmpg-200 text-[10px] leading-snug">{rec.message}</p>
                <p className="text-rmpg-500 text-[9px]">Sent by {rec.sender_name}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
