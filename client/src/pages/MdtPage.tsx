// ============================================================
// RMPG Flex — Mobile Data Terminal (MDT) Page
// Officer-facing terminal for viewing assigned calls, changing
// unit status, self-dispatching to pending calls, and managing
// field operations. Mirrors the Spillman Flex MDT interface.
// ============================================================

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import {
  Monitor, Navigation, Eye, CheckCircle, MapPin, Clock, Send, AlertTriangle,
  MessageSquare, Shield, FileText, Loader2, ChevronRight, Hash, Search, X, Radio, History,
} from 'lucide-react';
import type { CallForService, Unit, CallStatus } from '../types';
import { apiFetch } from '../hooks/useApi';
import { useIsMobile } from '../hooks/useIsMobile';
import { useGpsTracking } from '../hooks/useGpsTracking';
import { useLiveSync } from '../hooks/useLiveSync';
import { useWebSocket } from '../context/WebSocketContext';
import { useAuth } from '../context/AuthContext';
import { formatIncidentType } from '../utils/caseNumbers';
import { humanizePriority } from '../utils/statusLabels';
import { formatTimer, getStatusElapsed, isActiveStatus } from '../utils/dispatchTimers';
import { mapDbCall } from './dispatch/utils/dispatchMappers';
import StatusBadge from '../components/StatusBadge';
import ZsbBadge from '../components/ZsbBadge';
import PremiseHistory from '../components/PremiseHistory';
import NcicQueryPanel from '../components/NcicQueryPanel';
import PremiseAlertModal from '../components/PremiseAlertModal';
import WelfareCheckModal from '../components/WelfareCheckModal';
import ConfirmDialog from '../components/ConfirmDialog';
import IconButton from '../components/IconButton';
import { playTone } from '../utils/dispatchTones';
import { Volume2, VolumeX, Vibrate } from 'lucide-react';
import { type AudioMode, getLocalAudioMode, persistAudioMode, syncAudioModeFromServer } from '../utils/audioMode';
import { formatDateTime, localToday, safeTimeStr, parseTimestamp } from '../utils/dateUtils';
import { useToast } from '../components/ToastProvider';
import { toastClockLinkWarnings, type ClockLinkFlags } from '../utils/corporateOpsClient';
import CorporateLinkageStrip from '../components/CorporateLinkageStrip';
import { openShiftReportPdf } from '../utils/shiftReportPdf';
import { formatEnumValue, toDisplayLabel } from '../utils/formatters';

// ── Quick Status Buttons ────────────────────────────────────

// Status color tokens — semantic hues route through the sev-* palette so a
// future tactical-day mode (if ever) remaps automatically. "ENROUTE" stays
// neutral grey (no severity); "OFF" uses the rmpg-500 muted token.
const UNIT_STATUSES = [
  { label: 'AVAIL',    status: 'available', color: 'var(--sev-ok)' },
  { label: 'ENROUTE',  status: 'enroute',   color: 'var(--spm-text-muted)' },
  { label: 'ON SCENE', status: 'onscene',   color: 'var(--sev-special-soft)' },
  { label: 'BUSY',     status: 'busy',      color: 'var(--sev-critical)' },
  { label: 'OFF',      status: 'off_duty',  color: 'var(--text-muted)' },
] as const;

// Checks if weapons_involved has a meaningful (non-empty/non-"none") value
const hasActiveWeapons = (value: any): boolean =>
  !!value && !['none', 'no', 'n/a', 'false', '0', ''].includes(String(value).toLowerCase().trim());

// Checks if a call has officer safety concerns
const checkOfficerSafety = (call: CallForService | null): boolean =>
  !!call && !!(call.officer_safety_caution || hasActiveWeapons(call.weapons_involved) || call.domestic_violence);

// ── MDT Messages Panel ────────────────────────────────────

interface MdtMessage {
  id: number;
  from_user_id: number;
  from_name: string;
  from_badge?: string;
  to_user_id: number | null;
  to_name?: string;
  channel: string;
  content: string;
  priority: string;
  subject?: string;
  read_at: string | null;
  created_at: string;
}

function MdtMessagesPanel({ userId }: { userId?: string }) {
  const { addToast } = useToast();
  const [messages, setMessages] = useState<MdtMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [composeText, setComposeText] = useState('');
  const [composeChannel, setComposeChannel] = useState<'dispatch' | 'broadcast'>('dispatch');
  const [composePriority, setComposePriority] = useState<'routine' | 'urgent' | 'emergency'>('routine');

  const fetchMessages = useCallback(async () => {
    try {
      const result = await apiFetch<{ data: MdtMessage[]; unreadCount: number }>('/comms/messages?limit=30');
      setMessages(result.data || []);
      setUnreadCount(result.unreadCount || 0);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchMessages(); }, [fetchMessages]);
  useLiveSync('comms', fetchMessages);

  const handleSend = async () => {
    if (!composeText.trim()) return;
    try {
      await apiFetch('/comms/messages', {
        method: 'POST',
        body: JSON.stringify({
          channel: composeChannel,
          content: composeText.trim(),
          priority: composePriority,
        }),
      });
      setComposeText('');
      fetchMessages();
      addToast('Message sent', 'success');
    } catch (err) {
      console.error('Send message failed:', err);
      addToast('Failed to send message', 'error');
    }
  };

  const handleMarkRead = async (id: number) => {
    try {
      await apiFetch(`/comms/messages/${id}/read`, { method: 'PUT' });
      fetchMessages();
    } catch { /* silent */ }
  };

  const prioStyle = (p: string) => {
    switch (p) {
      case 'emergency': return { color: 'var(--sev-critical)', bg: 'rgb(var(--sev-critical-rgb) / 0.1)' };
      case 'urgent':    return { color: 'var(--sev-warn)',     bg: 'rgb(var(--sev-warn-rgb) / 0.1)' };
      default:          return { color: 'var(--sev-ok)',       bg: 'transparent' };
    }
  };

  const channelBadge = (ch: string) => {
    // Channel color hue is semantic, not severity — these are just visual
    // tags. Background reads on top of a colored chip so text stays surface-
    // base for max contrast (it's the same trick the priority pills use).
    const colors: Record<string, string> = {
      dispatch: 'var(--spm-text-muted)',
      broadcast: 'var(--sev-special-soft)',
      direct: 'var(--sev-ok)',
      zone: 'var(--sev-warn)',
    };
    return (
      <span
        className="text-[7px] font-black uppercase px-1 py-px rounded-sm"
        style={{
          background: colors[ch] || 'var(--text-muted)',
          color: 'var(--surface-base)',
          letterSpacing: '0.05em',
        }}
      >
        {ch}
      </span>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Message list */}
      <div className="flex-1 overflow-auto">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-rmpg-500 text-[10px]">
            <div className="text-center">
              <MessageSquare className="w-8 h-8 mx-auto mb-2 text-rmpg-600" />
              <p>No messages</p>
            </div>
          </div>
        ) : (
          messages.map(msg => {
            const ps = prioStyle(msg.priority);
            return (
              <div
                key={msg.id}
                onClick={() => !msg.read_at && msg.to_user_id && handleMarkRead(msg.id)}
                className="px-3 py-2 border-b border-rmpg-700/50 cursor-pointer transition-colors hover:bg-surface-raised/30"
                style={{
                  background: ps.bg,
                  borderLeft: msg.read_at ? '3px solid transparent' : `3px solid ${ps.color}`,
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    {channelBadge(msg.channel)}
                    <span className="text-[10px] font-bold text-rmpg-100">{msg.from_name || 'System'}</span>
                    {msg.from_badge && (
                      <span className="text-[8px] text-rmpg-500 font-mono">#{msg.from_badge}</span>
                    )}
                  </div>
                  <span className="text-[8px] text-rmpg-500 font-mono">
                    {safeTimeStr(msg.created_at)}
                  </span>
                </div>
                {msg.subject && (
                  <div className="text-[9px] text-rmpg-300 font-semibold mt-0.5">{msg.subject}</div>
                )}
                <div className="text-[10px] text-rmpg-200 mt-0.5">{msg.content}</div>
                {msg.priority !== 'routine' && (
                  <span
                    className="text-[7px] font-black uppercase px-1 py-px mt-1 inline-block rounded-sm"
                    style={{ background: ps.color, color: 'var(--surface-base)', letterSpacing: '0.05em' }}
                  >
                    {humanizePriority(msg.priority)}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Compose bar */}
      <div className="flex-shrink-0 p-2 border-t border-rmpg-700/50 bg-surface-sunken">
        <div className="flex items-center gap-1 mb-1">
          {(['dispatch', 'broadcast'] as const).map(ch => (
            <button type="button"
              key={ch}
              onClick={() => setComposeChannel(ch)}
              className="text-[8px] font-bold uppercase px-1.5 py-0.5 transition-colors"
              style={{
                background: composeChannel === ch ? 'var(--spm-text-muted)' : 'transparent',
                color: composeChannel === ch ? 'var(--surface-base)' : 'var(--text-muted)',
                border: `1px solid ${composeChannel === ch ? 'var(--spm-text-muted)' : 'var(--border-subtle)'}`,
              }}
            >
              {ch}
            </button>
          ))}
          <select id="ff-mdtpage-0"
            value={composePriority}
            onChange={(e) => setComposePriority(e.target.value as any)}
            className="text-[8px] bg-surface-base border border-rmpg-600 text-rmpg-300 px-1 py-0.5 ml-auto"
          >
            <option value="routine">Routine</option>
            <option value="urgent">Urgent</option>
            <option value="emergency">Emergency</option>
          </select>
        </div>
        <div className="flex items-center gap-1">
          <input id="ff-mdtpage-1"
            type="text"
            value={composeText}
            onChange={(e) => setComposeText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Type message..."
            className="flex-1 bg-surface-base border border-rmpg-600 text-rmpg-100 text-[10px] px-2 py-1 font-mono focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500/30 transition-colors"
          />
          <button type="button"
            onClick={handleSend}
            disabled={!composeText.trim()}
            className="px-3 py-1 text-[9px] font-bold uppercase bg-green-900/50 text-green-400 border border-green-700/50 hover:bg-green-800/50 disabled:opacity-40 transition-colors"
          >
            <Send style={{ width: 10, height: 10 }} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── BOLO type ─────────────────────────────────────────────

interface BoloEntry {
  id: number;
  description?: string;
  priority?: string;
  vehicle_description?: string;
  subject_description?: string;
  created_at?: string;
  status?: string;
}

// ── Dispatch Code type ────────────────────────────────────

interface DispatchCode {
  id?: number;
  code: string;
  description: string;
  priority?: string;
  category?: string;
}

// ── Component ──────────────────────────────────────────────

const MANAGE_ROLES = new Set(['admin', 'manager', 'supervisor']);

export default function MdtPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  const { user } = useAuth();
  // Layout.tsx already mounts the single upload-enabled GPS tracker for every
  // authenticated route. Without `upload: false` here, this page ran a SECOND
  // independent tracker with its own queue/interval, double-POSTing breadcrumbs
  // to /dispatch/gps (same defect NavTripContext.tsx already guards against).
  const gps = useGpsTracking({ upload: false });

  // Role gates — destructive duty/call actions gated to admin/manager/supervisor
  const canManage = MANAGE_ROLES.has(user?.role ?? '');
  const [myUnit, setMyUnit] = useState<Unit | null>(null);
  const [showCodes, setShowCodes] = useState(false);
  const [codeFilter, setCodeFilter] = useState('');
  const [codes, setCodes] = useState<DispatchCode[]>([]);
  const [noteText, setNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [bolos, setBolos] = useState<BoloEntry[]>([]);
  const [boloIndex, setBoloIndex] = useState(0);
  const [historyCalls, setHistoryCalls] = useState<CallForService[]>([]);
  const lastWarnedCallRef = useRef<number | string | null>(null);
  // DI-5: per-unit audio mode (silent dispatch). Source of truth = server,
  // localStorage mirror keeps the voice hook gate latency-free.
  const [audioMode, setAudioMode] = useState<AudioMode>(getLocalAudioMode());
  useEffect(() => {
    syncAudioModeFromServer().then(setAudioMode).catch(() => { /* keep local */ });
    const onChange = (e: Event) => {
      const ce = e as CustomEvent<AudioMode>;
      if (ce.detail) setAudioMode(ce.detail);
    };
    window.addEventListener('rmpg:audio-mode-changed', onChange);
    return () => window.removeEventListener('rmpg:audio-mode-changed', onChange);
  }, []);
  const cycleAudioMode = useCallback(async () => {
    if (!myUnit) return;
    const next: AudioMode = audioMode === 'audible' ? 'silent' : audioMode === 'silent' ? 'vibrate' : 'audible';
    try {
      await persistAudioMode(myUnit.id, next);
      setAudioMode(next);
      addToast(`Audio mode: ${next.toUpperCase()}`, 'success');
    } catch (err) {
      console.error('[MDT] audio mode change failed', err);
      addToast('Failed to change audio mode', 'error');
    }
  }, [audioMode, myUnit, addToast]);
  const [myCalls, setMyCalls] = useState<CallForService[]>([]);
  const [pendingCalls, setPendingCalls] = useState<CallForService[]>([]);
  const [selectedCall, setSelectedCall] = useState<CallForService | null>(null);
  const [activeTab, setActiveTab] = useState<'my-calls' | 'pending' | 'messages' | 'ncic' | 'history'>('my-calls');
  const [ncicQuery, setNcicQuery] = useState<{ type: 'person' | 'vehicle' | 'warrant'; query: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [msgUnread, setMsgUnread] = useState(0);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [dispatchingCallId, setDispatchingCallId] = useState<string | null>(null);
  const [showFiForm, setShowFiForm] = useState(false);
  const [fiData, setFiData] = useState({ subject_name: '', location: '', reason: '', narrative: '' });
  const [fiSubmitting, setFiSubmitting] = useState(false);

  // ConfirmDialog state — off-duty (ends shift/releases vehicle) + clear call
  const [confirmOffDuty, setConfirmOffDuty] = useState(false);
  const [confirmClearCallId, setConfirmClearCallId] = useState<string | null>(null);

  // Ref for FI subject name input — used by N shortcut
  const fiSubjectRef = useRef<HTMLInputElement | null>(null);

  // Timer tick — force re-render every second so elapsed timers update
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Shift Report PDF ──
  // Replaces the previous text-blob-with-Unicode-box-borders download with a
  // court-ready PDF (Arial, RMPG-gold banner, summary tiles, per-section
  // tables, two-signature block). Pure-client — feeds the same /reports/
  // shift-activity payload into shiftReportPdf.ts. User id pulled from
  // useAuth so a stale localStorage entry can't mis-attribute the report.
  const handleGenerateShiftReport = async () => {
    if (!user) {
      addToast('Sign in required to generate a shift report', 'warning');
      return;
    }
    setGeneratingReport(true);
    try {
      const today = localToday();
      const data = await apiFetch<any>(`/reports/shift-activity/${user.id}?date=${today}`);
      openShiftReportPdf({
        officer: data.officer,
        date: data.date || today,
        unitCallSign: myUnit?.call_sign,
        summary: data.summary,
        calls: data.calls,
        incidents: data.incidents,
        scans: data.scans,
        officerNameFallback: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username,
      });
    } catch (err) {
      console.error('Failed to generate shift report:', err);
      addToast('Failed to generate shift report', 'error');
    }
    setGeneratingReport(false);
  };

  // ── Quick Field Interview ──
  const handleSubmitFi = async () => {
    if (!fiData.subject_name.trim()) return;
    setFiSubmitting(true);
    try {
      await apiFetch('/field-interviews', {
        method: 'POST',
        body: JSON.stringify({
          ...fiData,
          location: fiData.location || (gps.latitude ? `${gps.latitude.toFixed(5)}, ${gps.longitude?.toFixed(5)}` : ''),
          // user_id routes through useAuth (was localStorage which lagged the
          // real auth state and could attribute the FI to a stale prior user).
          officer_id: user?.id || '',
          call_id: selectedCall?.id || undefined,
        }),
      });
      setFiData({ subject_name: '', location: '', reason: '', narrative: '' });
      setShowFiForm(false);
      addToast('Field interview submitted', 'success');
    } catch (err) {
      console.error('Failed to submit FI:', err);
      addToast('Failed to submit field interview', 'error');
    }
    setFiSubmitting(false);
  };

  // ── Data Fetching ──
  const fetchData = useCallback(async () => {
    try {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const [callsRaw, historyRaw, unitsRaw, msgResult] = await Promise.all([
        apiFetch<any>('/dispatch/calls?limit=100'),
        apiFetch<any>(`/dispatch/calls?startDate=${encodeURIComponent(startOfMonth.toISOString())}&limit=500`),
        apiFetch<any[]>('/dispatch/units'),
        apiFetch<{ unreadCount: number }>('/comms/messages?limit=1'),
      ]);

      setMsgUnread(msgResult?.unreadCount || 0);

      // API returns { data: [...], pagination: {} } envelope
      const callRows: any[] = Array.isArray(callsRaw?.data) ? callsRaw.data : Array.isArray(callsRaw) ? callsRaw : [];
      const allCalls: CallForService[] = callRows.map(mapDbCall);
      const historyRows: any[] = Array.isArray(historyRaw?.data) ? historyRaw.data : Array.isArray(historyRaw) ? historyRaw : [];
      const allHistory: CallForService[] = historyRows.map(mapDbCall);
      const allUnits = Array.isArray(unitsRaw) ? unitsRaw : [];

      // Find my unit via GPS hook's unit ID
      const unit = allUnits.find((u: any) => u.id === gps.unitId) || null;
      setMyUnit(unit ? { ...unit, id: String(unit.id) } as Unit : null);

      // My calls: calls where my unit is assigned
      // assigned_units contains unit IDs as strings (from JSON.parse of assigned_unit_ids)
      if (unit) {
        const myUnitIdStr = String(unit.id);
        setMyCalls(allCalls.filter(c =>
          isActiveStatus(c.status) && c.assigned_units?.includes(myUnitIdStr)
        ));
        // History calls: this unit's cleared/closed calls since start of month
        setHistoryCalls(allHistory.filter(c =>
          !isActiveStatus(c.status) && c.assigned_units?.includes(myUnitIdStr)
        ));
      } else {
        setMyCalls([]);
        setHistoryCalls([]);
      }

      // Pending calls (available for self-dispatch)
      setPendingCalls(allCalls.filter(c => c.status === 'pending'));

      // Keep selectedCall fresh — update from new data if still in the
      // page-1 list. If the call has dropped off the list (could be a
      // paged-out result, a transient filter hiccup, or a real delete),
      // refetch it by id rather than blindly nulling. The previous
      // behavior was nulling the open call any time it slipped past
      // ?limit=100 — disorienting for the officer mid-view.
      setSelectedCall(prev => {
        if (!prev) return prev;
        const fresh = allCalls.find(c => c.id === prev.id) || allHistory.find(c => c.id === prev.id);
        if (fresh) return fresh;
        // Fire-and-forget refetch; clear on 404, keep on success.
        // We return prev to avoid a flash of empty state during the
        // refetch — if the call IS deleted, the next render clears it.
        apiFetch<any>(`/dispatch/calls/${prev.id}`)
          .then((detail) => {
            if (detail && detail.id != null) {
              setSelectedCall(mapDbCall(detail));
            } else {
              setSelectedCall(null);
            }
          })
          .catch(() => setSelectedCall(null));
        return prev;
      });

    } catch (err) {
      console.error('MDT fetch error:', err);
      addToast('Failed to load dispatch data', 'error');
    } finally {
      setLoading(false);
    }
  }, [gps.unitId, addToast]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useLiveSync('dispatch', fetchData);

  useEffect(() => {
    window.addEventListener('rmpg:ws-reconnected', fetchData);
    return () => window.removeEventListener('rmpg:ws-reconnected', fetchData);
  }, [fetchData]);

  // ── Deep-link auto-select: /mdt?call_id=<id> ──
  // Fourth consecutive page-pass implementing this contract (Dashboard emits,
  // Dispatch/Map/MDT consume). Picks the call from either my-calls or
  // pending, sets it as selectedCall, switches the appropriate tab, and
  // strips the query so a refresh doesn't re-select. Falls back to a toast
  // if the call id isn't in either list once both are hydrated.
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingCallIdRef = useRef<string | null>(searchParams.get('call_id'));
  useEffect(() => {
    const target = pendingCallIdRef.current;
    if (!target || loading) return;
    const mine = myCalls.find((c) => String(c.id) === String(target));
    const pending = !mine ? pendingCalls.find((c) => String(c.id) === String(target)) : null;
    const hit = mine || pending;
    if (!hit) {
      // Only complain once both lists have actually hydrated.
      if (myCalls.length === 0 && pendingCalls.length === 0) return;
      pendingCallIdRef.current = null;
      addToast(`Call ${target} not assigned to you or pending`, 'warning');
      const next = new URLSearchParams(searchParams);
      next.delete('call_id');
      setSearchParams(next, { replace: true });
      return;
    }
    pendingCallIdRef.current = null;
    setSelectedCall(hit);
    setActiveTab(mine ? 'my-calls' : 'pending');
    const next = new URLSearchParams(searchParams);
    next.delete('call_id');
    setSearchParams(next, { replace: true });
  }, [myCalls, pendingCalls, loading, searchParams, setSearchParams, addToast]);

  // ── BOLO Fetching ──
  const fetchBolos = useCallback(async () => {
    try {
      const raw = await apiFetch<BoloEntry[]>('/comms/bolos/active');
      if (Array.isArray(raw)) setBolos(raw.filter((b) => b.status === 'active'));
    } catch { /* best-effort */ }
  }, []);

  // ── Real-time WebSocket subscriptions for dispatch events ──
  const { subscribe, isConnected: wsConnected } = useWebSocket();
  useEffect(() => {
    // When dispatch assigns/unassigns units or changes call status, refresh
    // immediately — but skip high-frequency GPS position pushes (every ~1s),
    // which the MDT doesn't display and which would refetch on every tick.
    const unsubDispatch = subscribe('dispatch_update', (msg: any) => {
      if ((msg?.data || msg)?.action === 'unit_position_update') return;
      fetchData();
    });
    // When any unit status changes (dispatched, enroute, onscene, available)
    const unsubUnit = subscribe('unit_update', (msg: any) => {
      const data = msg.data || msg;
      if (data?.action === 'unit_position_update') return;
      if (data?.unit && gps.unitId && data.unit.id === gps.unitId) {
        // Our unit was updated — refresh to pick up status/call changes
        fetchData();
      }
    });
    // BOLO alerts
    const unsubBolo = subscribe('bolo_alert', () => {
      fetchBolos();
    });
    return () => { unsubDispatch(); unsubUnit(); unsubBolo(); };
  }, [subscribe, fetchData, fetchBolos, gps.unitId]);

  // ── N shortcut + Esc cascade ──
  // N : open Quick FI form and focus the subject-name input (field role action;
  //     skips if already typing in an input or textarea).
  // Esc cascade (in order, stops propagation at first match):
  //   1. Close off-duty confirm dialog
  //   2. Close clear-call confirm dialog
  //   3. Close FI form
  //   4. Deselect call (return to list on mobile)
  //   5. Close selected call detail
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName ?? '';
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if (e.key === 'Escape') {
        if (confirmOffDuty) { e.stopPropagation(); setConfirmOffDuty(false); return; }
        if (confirmClearCallId) { e.stopPropagation(); setConfirmClearCallId(null); return; }
        if (showFiForm) { e.stopPropagation(); setShowFiForm(false); return; }
        if (selectedCall) { e.stopPropagation(); setSelectedCall(null); return; }
        return;
      }

      if ((e.key === 'n' || e.key === 'N') && !inInput && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setShowFiForm(true);
        // Focus fires after the form renders via requestAnimationFrame
        requestAnimationFrame(() => fiSubjectRef.current?.focus());
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [confirmOffDuty, confirmClearCallId, showFiForm, selectedCall]);

  // ── Unit Status Change ──
  // Duty BOUNDARIES (off_duty, and going available FROM off_duty) run through
  // the integrated shift API so they clock the officer out/in AND release/assign
  // the fleet vehicle — matching the ShiftCard. Operational statuses
  // (enroute/onscene/busy, or going available mid-shift) stay on the legacy
  // unit-status path, which owns the live /api/ws broadcast + transition guard.
  // off_duty is routed through ConfirmDialog (destructive: ends shift + releases vehicle).
  const handleUnitStatus = async (newStatus: string) => {
    if (!myUnit) return;
    if (newStatus === 'off_duty') {
      setConfirmOffDuty(true);
      return;
    }
    try {
      if (newStatus === 'available' && myUnit.status === 'off_duty') {
        const started = await apiFetch('/dispatch/duty/start', { method: 'POST', body: JSON.stringify({ unit_id: myUnit.id }) });
        addToast('On duty — clocked in, vehicle assigned', 'success');
        toastClockLinkWarnings(addToast, started as ClockLinkFlags);
      } else {
        await apiFetch(`/dispatch/units/${myUnit.id}/status`, {
          method: 'PUT',
          body: JSON.stringify({ status: newStatus }),
        });
      }
      fetchData();
    } catch (err: any) {
      if (err?.code === 'NEEDS_VEHICLE') {
        addToast('No take-home vehicle set — pick one on the Shift card to go on duty', 'warning');
      } else if (err?.code === 'NEEDS_MILEAGE') {
        addToast('No odometer history for this vehicle — start your shift from the Shift card once to seed it', 'warning');
      } else if (err?.code === 'NO_UNIT') {
        addToast('No unit assigned — ask dispatch to assign you a unit', 'error');
      } else {
        console.error('Status change failed:', err);
        addToast('Failed to change unit status', 'error');
      }
    }
  };

  // Confirmed off-duty: clock out + release vehicle
  const handleConfirmOffDuty = async () => {
    if (!myUnit) return;
    setConfirmOffDuty(false);
    try {
      await apiFetch('/dispatch/duty/end', { method: 'POST', body: JSON.stringify({ unit_id: myUnit.id }) });
      addToast('Shift ended — clocked out, vehicle released', 'success');
      fetchData();
    } catch (err: any) {
      console.error('End duty failed:', err);
      addToast('Failed to end shift', 'error');
    }
  };

  // ── Call Status Change ──
  // 'cleared' is routed through ConfirmDialog — closing a call is irreversible
  // from the MDT (dispatch can re-open, but the officer shouldn't do it by accident).
  const handleCallStatus = async (callId: string, newStatus: CallStatus) => {
    if (newStatus === 'cleared') {
      setConfirmClearCallId(callId);
      return;
    }
    await executeCallStatus(callId, newStatus);
  };

  const executeCallStatus = async (callId: string, newStatus: CallStatus) => {
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${callId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: newStatus }),
      });
      const updated = mapDbCall(result);
      setMyCalls(prev => prev.map(c => c.id === callId ? updated : c));
      if (selectedCall?.id === callId) setSelectedCall(updated);
      fetchData();
    } catch (err) {
      console.error('Call status update failed:', err);
      addToast('Failed to update call status', 'error');
    }
  };

  // ── Self-Dispatch ──
  const handleSelfDispatch = async (callId: string) => {
    if (!myUnit || dispatchingCallId) return;
    setDispatchingCallId(callId);
    try {
      await apiFetch(`/dispatch/calls/${callId}/assign-unit`, {
        method: 'POST',
        body: JSON.stringify({ unit_id: myUnit.id }),
      });
      fetchData();
    } catch (err) {
      console.error('Self-dispatch failed:', err);
      addToast('Failed to self-dispatch', 'error');
    } finally {
      setDispatchingCallId(null);
    }
  };

  // ── Officer Safety Alert — play warning tone on first view ──
  useEffect(() => {
    if (!selectedCall) return;
    if (checkOfficerSafety(selectedCall) && lastWarnedCallRef.current !== selectedCall.id) {
      lastWarnedCallRef.current = selectedCall.id;
      playTone('warning');
    }
  }, [selectedCall]);

  // ── Keyboard Hotkeys ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      switch (e.key) {
        case 'F5':
          e.preventDefault();
          if (selectedCall?.status === 'dispatched') {
            handleCallStatus(selectedCall.id, 'enroute');
          }
          break;
        case 'F6':
          e.preventDefault();
          if (selectedCall?.status === 'enroute') {
            handleCallStatus(selectedCall.id, 'onscene');
          }
          break;
        case 'F7':
          e.preventDefault();
          if (selectedCall?.status === 'onscene') {
            handleCallStatus(selectedCall.id, 'cleared');
          }
          break;
        case 'F8':
          e.preventDefault();
          setActiveTab('ncic');
          break;
        case 'Escape':
          e.preventDefault();
          if (showCodes) {
            setShowCodes(false);
          } else if (selectedCall) {
            setSelectedCall(null);
          }
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedCall, showCodes, handleCallStatus]);

  // ── Add Call Note ──
  const handleAddNote = async () => {
    if (!selectedCall || !noteText.trim()) return;
    setAddingNote(true);
    try {
      await apiFetch(`/dispatch/calls/${selectedCall.id}/notes`, {
        method: 'POST',
        body: JSON.stringify({ text: noteText.trim() }),
      });
      setNoteText('');
      fetchData();
    } catch (err) {
      console.error('Add note failed:', err);
      addToast('Failed to add note', 'error');
    } finally {
      setAddingNote(false);
    }
  };

  // ── Priority Color ──
  // Routes through semantic sev tokens — P1=critical, P2=high, P3=caution —
  // so a future tactical-day mode (if ever) automatically remaps without
  // touching this map.
  const prioColor = (p: string) => {
    switch (p) {
      case 'P1': return 'var(--sev-critical)';
      case 'P2': return 'var(--sev-high)';
      case 'P3': return 'var(--sev-caution)';
      default: return 'var(--text-muted)';
    }
  };

  // Set document title
  useEffect(() => { document.title = 'Mobile Data Terminal \u2014 RMPG Flex'; }, []);

  // ── Response Time Calculation ──
  const calcResponseTime = (call: CallForService): string | null => {
    const start = call.dispatched_at;
    const end = call.onscene_at;
    if (!start || !end) return null;
    const diffMs = parseTimestamp(end).getTime() - parseTimestamp(start).getTime();
    if (diffMs < 0) return null;
    const mins = Math.floor(diffMs / 60000);
    const secs = Math.floor((diffMs % 60000) / 1000);
    return `${mins}m ${secs}s`;
  };

  // ── 24h Clock ──
  const now = new Date();
  const clockStr = now.toLocaleTimeString('en-US', { timeZone: 'America/Denver', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // ── Officer Safety Check ──
  const hasOfficerSafety = checkOfficerSafety(selectedCall);

  // ── Filtered codes ──
  const filteredCodes = useMemo(() =>
    codeFilter
      ? codes.filter(c =>
          c.code.toLowerCase().includes(codeFilter.toLowerCase()) ||
          c.description.toLowerCase().includes(codeFilter.toLowerCase())
        )
      : codes,
    [codes, codeFilter]
  );

  // ── Active / pending counts for status bar ──
  const activeCallCount = myCalls.length;
  const pendingCallCount = pendingCalls.length;


  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-surface-base">
        <div className="text-center">
          <Monitor className="w-8 h-8 text-green-500 animate-pulse mx-auto mb-3" />
          <p className="text-rmpg-400 text-xs uppercase tracking-wider font-bold font-mono">Initializing MDT...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="tactical-dark h-full flex flex-col bg-surface-base text-rmpg-100 overflow-hidden animate-fade-in">
      {/* DI-3: Premise alert auto-push modal — listens for premise_alert_for_unit WS event */}
      <PremiseAlertModal />
      {/* DI-4: Welfare-check ack modal — listens for welfare_check WS event */}
      <WelfareCheckModal />
      <CorporateLinkageStrip mode="mine" />

      {/* ── ConfirmDialog: End Shift (off_duty) ── */}
      <ConfirmDialog
        isOpen={confirmOffDuty}
        onClose={() => setConfirmOffDuty(false)}
        onConfirm={handleConfirmOffDuty}
        title="End Shift"
        message="This will clock you out and release your assigned fleet vehicle. Are you sure you want to go off duty?"
        details={myUnit ? <span>Unit: {myUnit.call_sign}</span> : undefined}
        confirmLabel="Go Off Duty"
        confirmVariant="warning"
      />

      {/* ── ConfirmDialog: Clear Call ── */}
      <ConfirmDialog
        isOpen={!!confirmClearCallId}
        onClose={() => setConfirmClearCallId(null)}
        onConfirm={() => {
          if (confirmClearCallId) executeCallStatus(confirmClearCallId, 'cleared');
          setConfirmClearCallId(null);
        }}
        title="Clear Call"
        message="Mark this call as cleared? Dispatch can re-open if needed."
        details={confirmClearCallId
          ? (() => { const c = myCalls.find(x => x.id === confirmClearCallId); return c ? <span>{c.call_number} — {formatIncidentType(c.incident_type)}</span> : null; })()
          : undefined}
        confirmLabel="Clear"
        confirmVariant="warning"
      />

      {/* ── TOP BAR: Unit Identity & Status ─────────────── */}
      <div
        className={`${isMobile ? 'flex flex-col gap-1.5 px-3 py-2' : 'flex items-center justify-between px-4 py-2'} flex-shrink-0 bg-surface-sunken border-b border-rmpg-700`}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-6 h-6" style={{ background: 'rgb(var(--sev-ok-rgb) / 0.1)', border: '1px solid rgb(var(--sev-ok-rgb) / 0.25)' }}>
            <Monitor style={{ width: 14, height: 14, color: 'var(--sev-ok)' }} />
          </div>
          <div>
            <span className="text-[11px] font-black text-green-400 tracking-wider font-mono">
              {myUnit?.call_sign || 'UNASSIGNED'}
            </span>
            {myUnit && (
              <span className="text-[9px] text-rmpg-400 ml-2">
                <StatusBadge status={myUnit.status} type="unit_status" size="sm" />
              </span>
            )}
          </div>
          {!isMobile && (
            <span className="text-[8px] text-rmpg-500 font-mono flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${gps.latitude ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
              {gps.latitude ? `${gps.latitude.toFixed(4)}, ${gps.longitude?.toFixed(4)}` : 'NO GPS'}
            </span>
          )}
        </div>

        {/* Quick status buttons + actions */}
        <div className={`flex items-center gap-1 ${isMobile ? 'overflow-x-auto' : ''}`}>
          {/* 10-CODES button */}
          <button type="button"
            onClick={() => setShowCodes(!showCodes)}
            className={`px-2 py-1 text-[9px] font-bold uppercase tracking-wider transition-colors border mr-0.5 ${
              showCodes ? 'border-accent-silver-400 text-accent-silver-300 bg-accent-silver-700/20' : 'border-rmpg-700 text-rmpg-400 hover:text-white hover:border-accent-silver-400'
            }`}
            title="Dispatch Codes Quick Reference"
          >
            <span className="flex items-center gap-1">
              <Hash style={{ width: 9, height: 9 }} />
              10-CODES
            </span>
          </button>
          <button type="button"
            onClick={() => setShowFiForm(!showFiForm)}
            className={`px-2 py-1 text-[9px] font-bold uppercase tracking-wider transition-colors border mr-0.5 ${
              showFiForm ? 'border-purple-500 text-purple-400 bg-purple-900/20' : 'border-rmpg-700 text-rmpg-400 hover:text-rmpg-100 hover:border-purple-500'
            }`}
            title="Quick Field Interview"
          >
            FI
          </button>
          {/* DI-5: Silent dispatch toggle (3-way cycle: audible → silent → vibrate) */}
          <button type="button"
            onClick={cycleAudioMode}
            disabled={!myUnit}
            aria-label={`Audio mode: ${audioMode}. Click to cycle.`}
            className={`px-2 py-1 text-[9px] font-bold uppercase tracking-wider transition-colors border mr-0.5 flex items-center gap-1 ${
              audioMode === 'silent' ? 'border-red-500 text-red-400 bg-red-900/20'
              : audioMode === 'vibrate' ? 'border-amber-500 text-amber-400 bg-amber-900/20'
              : 'border-green-600 text-green-400'
            }`}
            title={
              audioMode === 'silent' ? 'SILENT — TTS suppressed. Click for vibrate.'
              : audioMode === 'vibrate' ? 'VIBRATE — Haptic only. Click for audible.'
              : 'AUDIBLE — Full TTS. Click for silent.'
            }
            style={{ opacity: myUnit ? 1 : 0.4 }}
          >
            {audioMode === 'silent' ? <VolumeX style={{ width: 10, height: 10 }} />
              : audioMode === 'vibrate' ? <Vibrate style={{ width: 10, height: 10 }} />
              : <Volume2 style={{ width: 10, height: 10 }} />}
            <span>{audioMode === 'silent' ? 'SIL' : audioMode === 'vibrate' ? 'VIB' : 'AUD'}</span>
          </button>
          {canManage && (
            <button type="button"
              onClick={handleGenerateShiftReport}
              disabled={generatingReport}
              className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider transition-colors border border-rmpg-700 text-rmpg-400 hover:text-rmpg-100 hover:border-brand-500 mr-1"
              title="Generate End-of-Shift Report (admin/manager/supervisor)"
            >
              {generatingReport ? <Loader2 style={{ width: 10, height: 10 }} className="animate-spin" /> : <FileText style={{ width: 10, height: 10 }} />}
            </button>
          )}
          {UNIT_STATUSES.map(({ label, status, color }) => {
            // off_duty is destructive (ends shift + releases vehicle) — gated to managers
            if (status === 'off_duty' && !canManage) return null;
            return (
              <button type="button"
                key={status}
                onClick={() => handleUnitStatus(status)}
                disabled={!myUnit}
                className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider transition-colors"
                style={{
                  background: myUnit?.status === status ? color : 'transparent',
                  color: myUnit?.status === status ? 'var(--surface-base)' : color,
                  border: `1px solid ${color}`,
                  opacity: myUnit ? 1 : 0.4,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── BOLO Ticker ── */}
      {bolos.length > 0 && (
        <div
          className="flex-shrink-0 px-4 py-1.5 flex items-center gap-2 border-b overflow-hidden"
          style={{
            background: 'rgba(239,68,68,0.06)',
            borderColor: 'rgba(239,68,68,0.2)',
          }}
        >
          <div className="flex items-center gap-1 flex-shrink-0">
            <Volume2 style={{ width: 10, height: 10, color: 'var(--sev-critical)' }} />
            <span className="text-[8px] font-black uppercase tracking-wider text-red-400">BOL</span>
          </div>
          <div className="flex-1 min-w-0 overflow-hidden">
            {bolos[boloIndex % bolos.length] && (
              <div className="flex items-center gap-2 animate-fade-in">
                <span
                  className="text-[8px] font-black px-1 py-px rounded-sm flex-shrink-0"
                  style={{
                    background: bolos[boloIndex % bolos.length].priority === 'high' ? 'var(--sev-critical)' :
                                bolos[boloIndex % bolos.length].priority === 'medium' ? 'var(--sev-warn)' : 'var(--sev-ok)',
                    color: 'var(--surface-base)',
                  }}
                >
                  {(bolos[boloIndex % bolos.length].priority || 'INFO').toUpperCase()}
                </span>
                <span className="text-[10px] text-rmpg-200 truncate font-mono">
                  {bolos[boloIndex % bolos.length].description ||
                   bolos[boloIndex % bolos.length].subject_description ||
                   bolos[boloIndex % bolos.length].vehicle_description ||
                   'Active BOLO'}
                </span>
              </div>
            )}
          </div>
          <span className="text-[8px] text-rmpg-500 flex-shrink-0 font-mono">
            {boloIndex % bolos.length + 1}/{bolos.length}
          </span>
        </div>
      )}

      {/* ── Dispatch Codes Panel ── */}
      {showCodes && (
        <div className="flex-shrink-0 border-b border-accent-silver-400/30 bg-accent-silver-700/5" style={{ maxHeight: 240 }}>
          <div className="px-4 py-2 flex items-center justify-between border-b border-accent-silver-400/20">
            <span className="text-[9px] font-bold [color:var(--panel-header-color)] uppercase tracking-wider">10-Code Quick Reference</span>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search style={{ width: 9, height: 9, position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  value={codeFilter}
                  onChange={e => setCodeFilter(e.target.value)}
                  placeholder="Filter codes..."
                  className="bg-surface-base border border-rmpg-600 text-white text-[9px] pl-5 pr-2 py-0.5 font-mono w-32 focus:border-accent-silver-400 focus:outline-none"
                />
              </div>
              <IconButton onClick={() => setShowCodes(false)} aria-label="Close codes panel" className="text-rmpg-500 hover:text-white">
                <X className="w-3 h-3" />
              </IconButton>
            </div>
          </div>
          <div className="overflow-auto px-4 py-1" style={{ maxHeight: 180 }}>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-0.5">
              {filteredCodes.map((c, i) => (
                <div key={`${c.code}-${i}`} className="flex items-center gap-1.5 py-0.5">
                  <span
                    className="text-[9px] font-mono font-bold min-w-[40px]"
                    style={{
                      color: c.priority === 'P1' ? 'var(--sev-critical)' :
                             c.priority === 'P2' ? 'var(--sev-high)' :
                             c.priority === 'P3' ? 'var(--sev-warn)' : 'var(--spm-text-muted)',
                    }}
                  >
                    {c.code}
                  </span>
                  <span className="text-[9px] text-rmpg-300 truncate">{c.description}</span>
                </div>
              ))}
              {filteredCodes.length === 0 && (
                <div className="col-span-full text-[9px] text-rmpg-500 py-2 text-center">No matching codes</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Quick FI Form ── */}
      {showFiForm && (
        <div className="px-4 py-2 flex-shrink-0 border-b border-purple-700/50" style={{ background: 'rgb(var(--sev-special-rgb) / 0.08)' }}>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[9px] font-bold text-purple-400 uppercase tracking-wider">Quick Field Interview</span>
            {selectedCall && <span className="text-[8px] text-rmpg-400">Linked to {selectedCall.call_number}</span>}
          </div>
          <div className={`grid ${isMobile ? 'grid-cols-1' : 'grid-cols-4'} gap-2`}>
            <input id="ff-mdtpage-2"
              ref={fiSubjectRef}
              type="text"
              className="input-dark text-[10px] min-h-[36px]"
              placeholder="Subject Name *"
              value={fiData.subject_name}
              onChange={(e) => setFiData(prev => ({ ...prev, subject_name: e.target.value }))}
            />
            <input id="ff-mdtpage-3"
              type="text"
              className="input-dark text-[10px] min-h-[36px]"
              placeholder={gps.latitude ? `Location (auto: ${gps.latitude.toFixed(4)})` : 'Location'}
              value={fiData.location}
              onChange={(e) => setFiData(prev => ({ ...prev, location: e.target.value }))}
            />
            <input id="ff-mdtpage-4"
              type="text"
              className="input-dark text-[10px] min-h-[36px]"
              placeholder="Reason for contact"
              value={fiData.reason}
              onChange={(e) => setFiData(prev => ({ ...prev, reason: e.target.value }))}
            />
            <div className="flex items-center gap-1">
              <input id="ff-mdtpage-5"
                type="text"
                className="input-dark text-[10px] flex-1 min-h-[36px]"
                placeholder="Brief narrative"
                value={fiData.narrative}
                onChange={(e) => setFiData(prev => ({ ...prev, narrative: e.target.value }))}
              />
              <button type="button"
                onClick={handleSubmitFi}
                disabled={!fiData.subject_name.trim() || fiSubmitting}
                className="px-2 py-1 text-[9px] font-bold uppercase bg-purple-700 text-rmpg-100 border border-purple-600 hover:bg-purple-600 disabled:opacity-40"
              >
                {fiSubmitting ? '...' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ACTIVE CALL BANNER ── */}
      {myCalls.length > 0 && !selectedCall && (
        <div
          className="flex-shrink-0 px-4 py-2 flex items-center gap-3 cursor-pointer hover:bg-green-900/15 transition-colors"
          style={{ background: 'rgb(var(--sev-ok-rgb) / 0.06)', borderBottom: '1px solid rgb(var(--sev-ok-rgb) / 0.2)' }}
          onClick={() => setSelectedCall(myCalls[0])}
        >
          <span className="led-dot led-green animate-led-pulse" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono font-black text-green-400">{myCalls[0].call_number}</span>
              <span className="text-[9px] font-bold px-1 py-px rounded-sm" style={{ background: prioColor(myCalls[0].priority), color: 'var(--surface-base)' }}>{myCalls[0].priority}</span>
              <StatusBadge status={myCalls[0].status} type="call_status" size="sm" />
            </div>
            <div className="text-[10px] text-rmpg-100 font-semibold truncate">{formatIncidentType(myCalls[0].incident_type)}</div>
            <div className="text-[9px] text-rmpg-400 truncate flex items-center gap-1">
              <MapPin style={{ width: 9, height: 9 }} />
              {myCalls[0].location || 'No address'}
            </div>
          </div>
          {myCalls[0].description && (
            <div className="hidden md:block text-[9px] text-rmpg-300 max-w-[200px] truncate">
              {myCalls[0].description}
            </div>
          )}
          <div className="text-[9px] text-green-500 font-mono font-bold">
            {getStatusElapsed(myCalls[0]) ? formatTimer(getStatusElapsed(myCalls[0])!) : ''}
          </div>
          <ChevronRight style={{ width: 12, height: 12, color: 'var(--text-muted)' }} />
        </div>
      )}

      {/* ── MAIN CONTENT ────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        {/* ── LEFT: Call List ── */}
        <div className={`${isMobile ? (selectedCall ? 'hidden' : 'w-full') : 'w-2/5'} flex flex-col border-r border-rmpg-700/50 overflow-hidden`}>
          {/* Tabs */}
          <div className="flex border-b border-rmpg-700/50 flex-shrink-0 overflow-x-auto bg-surface-sunken">
            {(['my-calls', 'pending', 'messages', 'ncic', 'history'] as const).map(tab => (
              <button type="button"
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="flex-1 px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider transition-colors whitespace-nowrap"
                style={{
                  background: activeTab === tab ? 'var(--surface-deep)' : 'transparent',
                  color: activeTab === tab ? 'var(--sev-ok)' : 'var(--text-muted)',
                  borderBottom: activeTab === tab ? '2px solid var(--sev-ok)' : '2px solid transparent',
                }}
              >
                {tab === 'my-calls' ? `My Calls (${myCalls.length})` :
                 tab === 'pending' ? `Pending (${pendingCalls.length})` :
                 tab === 'messages' ? `Messages${msgUnread > 0 ? ` (${msgUnread})` : ''}` :
                 tab === 'ncic' ? 'NCIC' :
                 `History (${historyCalls.length})`}
              </button>
            ))}
          </div>

          {/* Call list */}
          <div className="flex-1 overflow-auto">
            {activeTab === 'my-calls' && (
              myCalls.length === 0 ? (
                <div className="flex items-center justify-center h-full text-rmpg-500 text-[10px]">
                  <div className="text-center">
                    <Shield className="w-8 h-8 mx-auto mb-2 text-rmpg-600" />
                    <p>No active assigned calls</p>
                  </div>
                </div>
              ) : (
                myCalls.map(call => (
                  <div
                    key={call.id}
                    onClick={() => setSelectedCall(call)}
                    className="px-3 py-2 cursor-pointer transition-colors border-b border-rmpg-700/50 hover:bg-surface-raised"
                    style={{
                      background: selectedCall?.id === call.id ? 'rgb(var(--sev-ok-rgb) / 0.08)' : 'transparent',
                      borderLeft: `3px solid ${prioColor(call.priority)}`,
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono font-bold text-green-400">{call.call_number}</span>
                        <StatusBadge status={call.status} type="call_status" size="sm" />
                      </div>
                      <span className="text-[9px] font-mono text-rmpg-500">
                        {formatTimer(getStatusElapsed(call))}
                      </span>
                    </div>
                    <div className="text-[10px] text-rmpg-100 font-semibold mt-0.5">
                      {formatIncidentType(call.incident_type)}
                    </div>
                    <div className="text-[9px] text-rmpg-400 flex items-center gap-1 mt-0.5">
                      <MapPin style={{ width: 8, height: 8 }} />
                      {call.location || 'No address'}
                    </div>
                  </div>
                ))
              )
            )}

            {activeTab === 'pending' && (
              pendingCalls.length === 0 ? (
                <div className="flex items-center justify-center h-full text-rmpg-500 text-[10px]">
                  <div className="text-center">
                    <CheckCircle className="w-8 h-8 mx-auto mb-2 text-rmpg-600" />
                    <p>No pending calls</p>
                    <p className="text-[9px] text-rmpg-600 mt-0.5">All clear — no calls awaiting dispatch</p>
                  </div>
                </div>
              ) : (
                pendingCalls.map(call => (
                  <div
                    key={call.id}
                    onClick={() => setSelectedCall(call)}
                    className="px-3 py-2 cursor-pointer transition-colors border-b border-rmpg-700/50 hover:bg-surface-raised"
                    style={{
                      background: selectedCall?.id === call.id ? 'rgb(var(--sev-ok-rgb) / 0.08)' : 'transparent',
                      borderLeft: `3px solid ${prioColor(call.priority)}`,
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono font-bold text-amber-400">{call.call_number}</span>
                        <span
                          className="text-[8px] font-black px-1 rounded-sm"
                          style={{ background: prioColor(call.priority), color: 'var(--surface-base)' }}
                        >
                          {humanizePriority(call.priority)}
                        </span>
                      </div>
                      <button type="button"
                        onClick={(e) => { e.stopPropagation(); handleSelfDispatch(call.id); }}
                        disabled={dispatchingCallId === call.id}
                        className="flex items-center gap-1 px-2 py-0.5 text-[8px] font-bold uppercase bg-green-900/50 text-green-400 border border-green-700/50 hover:bg-green-800/50 disabled:opacity-40 transition-colors"
                      >
                        {dispatchingCallId === call.id
                          ? <Loader2 style={{ width: 8, height: 8 }} className="animate-spin" />
                          : <Send style={{ width: 8, height: 8 }} />
                        } Self-Dispatch
                      </button>
                    </div>
                    <div className="text-[10px] text-rmpg-100 font-semibold mt-0.5">
                      {formatIncidentType(call.incident_type)}
                    </div>
                    <div className="text-[9px] text-rmpg-400 flex items-center gap-1 mt-0.5">
                      <MapPin style={{ width: 8, height: 8 }} />
                      {call.location || 'No address'}
                    </div>
                    {call.description && (
                      <div className="text-[9px] text-rmpg-500 mt-0.5 truncate">{call.description}</div>
                    )}
                  </div>
                ))
              )
            )}

            {activeTab === 'messages' && (
              <MdtMessagesPanel userId={gps.unitId ? String(gps.unitId) : undefined} />
            )}

            {activeTab === 'ncic' && (
              <div className="h-full">
                <NcicQueryPanel
                  isOpen={true}
                  onClose={() => setActiveTab('my-calls')}
                  initialQuery={ncicQuery}
                  embedded={true}
                />
              </div>
            )}

            {activeTab === 'history' && (
              historyCalls.length === 0 ? (
                <div className="flex items-center justify-center h-full text-rmpg-500 text-[10px]">
                  <div className="text-center">
                    <History className="w-8 h-8 mx-auto mb-2 text-rmpg-600" />
                    <p>No cleared/closed calls</p>
                  </div>
                </div>
              ) : (
                historyCalls.map(call => (
                  <div
                    key={call.id}
                    onClick={() => setSelectedCall(call)}
                    className="px-3 py-2 cursor-pointer transition-colors border-b border-rmpg-700/50 hover:bg-surface-raised"
                    style={{
                      background: selectedCall?.id === call.id ? 'rgba(34,197,94,0.08)' : 'transparent',
                      borderLeft: `3px solid ${call.status === 'cleared' ? 'var(--spm-text-muted)' : 'var(--border-default)'}`,
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono font-bold text-rmpg-400">{call.call_number}</span>
                        <StatusBadge status={call.status} type="call_status" size="sm" />
                        <span
                          className="text-[8px] font-black px-1 rounded-sm"
                          style={{ background: prioColor(call.priority), color: 'var(--surface-base)' }}
                        >
                          {formatEnumValue(call.priority)}
                        </span>
                      </div>
                      <span className="text-[8px] font-mono text-rmpg-500">
                        {call.cleared_at ? safeTimeStr(call.cleared_at) : call.closed_at ? safeTimeStr(call.closed_at) : ''}
                      </span>
                    </div>
                    <div className="text-[10px] text-rmpg-300 font-semibold mt-0.5">
                      {formatIncidentType(call.incident_type)}
                    </div>
                    <div className="text-[9px] text-rmpg-500 flex items-center gap-1 mt-0.5">
                      <MapPin style={{ width: 8, height: 8 }} />
                      {call.location || 'No address'}
                    </div>
                    {call.disposition && (
                      <div className="text-[8px] text-rmpg-500 mt-0.5 font-mono uppercase">
                        Disp: {call.disposition}
                      </div>
                    )}
                  </div>
                ))
              )
            )}
          </div>
        </div>

        {/* ── RIGHT: Call Detail ── */}
        <div className={`${isMobile ? (selectedCall ? 'w-full' : 'hidden') : 'flex-1'} flex flex-col overflow-hidden`}>
          {selectedCall ? (
            <>
              {/* Call header */}
              <div
                className="px-4 py-2 flex items-center justify-between flex-shrink-0 border-b border-rmpg-700 bg-surface-sunken"
              >
                <div>
                  {isMobile && (
                    <button type="button"
                      onClick={() => setSelectedCall(null)}
                      className="text-rmpg-400 hover:text-rmpg-100 text-[10px] font-bold uppercase tracking-wider mb-1"
                    >
                      ◀ Back
                    </button>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-mono font-black text-green-400">
                      {selectedCall.call_number}
                    </span>
                    <StatusBadge status={selectedCall.status} type="call_status" size="sm" />
                    <span
                      className="text-[8px] font-black px-1 py-px rounded-sm"
                      style={{ background: prioColor(selectedCall.priority), color: 'var(--surface-base)' }}
                    >
                      {humanizePriority(selectedCall.priority)}
                    </span>
                  </div>
                  <div className="text-[11px] text-rmpg-100 font-semibold mt-0.5">
                    {formatIncidentType(selectedCall.incident_type)}
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-1">
                  <button type="button"
                    title="Send this call to your phone (MDT link)"
                    onClick={async () => {
                      const cc = selectedCall as any;
                      try {
                        await apiFetch('/mdt/send', { method: 'POST', body: JSON.stringify({
                          to: 'phone', type: 'call', payload: {
                            call_id: cc.id, call_number: cc.call_number,
                            address: cc.location_address ?? cc.address ?? '',
                            latitude: cc.latitude, longitude: cc.longitude,
                            incident_type: cc.incident_type,
                          },
                        }) });
                        addToast('Call sent to your phone', 'success');
                      } catch { addToast('Failed to send to phone', 'error'); }
                    }}
                    className="flex items-center gap-1 px-3 py-1.5 text-[9px] font-bold uppercase bg-surface-sunken/50 text-[var(--brand-gold)] border border-[rgb(var(--brand-gold-rgb)/0.4)] hover:bg-surface-raised/50 transition-colors"
                  >
                    <Send style={{ width: 10, height: 10 }} /> To phone
                  </button>
                  {selectedCall.status === 'dispatched' && (
                    <button type="button"
                      onClick={() => handleCallStatus(selectedCall.id, 'enroute')}
                      className="flex items-center gap-1 px-3 py-1.5 text-[9px] font-bold uppercase bg-surface-sunken/50 text-rmpg-400 border border-border-default/50 hover:bg-surface-raised/50 transition-colors"
                    >
                      <Navigation style={{ width: 10, height: 10 }} /> En Route
                    </button>
                  )}
                  {selectedCall.status === 'enroute' && (
                    <button type="button"
                      onClick={() => handleCallStatus(selectedCall.id, 'onscene')}
                      className="flex items-center gap-1 px-3 py-1.5 text-[9px] font-bold uppercase bg-purple-900/50 text-purple-400 border border-purple-700/50 hover:bg-purple-800/50 transition-colors"
                    >
                      <Eye style={{ width: 10, height: 10 }} /> On Scene
                    </button>
                  )}
                  {selectedCall.status === 'onscene' && (
                    <button type="button"
                      onClick={() => handleCallStatus(selectedCall.id, 'cleared')}
                      className="flex items-center gap-1 px-3 py-1.5 text-[9px] font-bold uppercase bg-rmpg-700/50 text-rmpg-300 border border-rmpg-600/50 hover:bg-rmpg-600/50 transition-colors"
                    >
                      <CheckCircle style={{ width: 10, height: 10 }} /> Clear
                    </button>
                  )}
                  {selectedCall.status === 'pending' && myUnit && (
                    <button type="button"
                      onClick={() => handleSelfDispatch(selectedCall.id)}
                      disabled={!!dispatchingCallId}
                      className="flex items-center gap-1 px-3 py-1.5 text-[9px] font-bold uppercase bg-green-900/50 text-green-400 border border-green-700/50 hover:bg-green-800/50 disabled:opacity-40 transition-colors"
                    >
                      {dispatchingCallId === selectedCall.id
                        ? <Loader2 style={{ width: 10, height: 10 }} className="animate-spin" />
                        : <Send style={{ width: 10, height: 10 }} />
                      } Accept
                    </button>
                  )}
                </div>
              </div>

              {/* Call details body */}
              <div className="flex-1 overflow-auto p-4 space-y-3">
                {/* ── Officer Safety Alert Banner ── */}
                {hasOfficerSafety && (
                  <div
                    className="flex items-center gap-2 p-2"
                    style={{
                      background: 'rgba(239,68,68,0.15)',
                      border: '2px solid var(--sev-critical)',
                      animation: 'officer-safety-flash 1s ease-in-out infinite',
                    }}
                  >
                    <AlertTriangle style={{ width: 14, height: 14, color: 'var(--sev-critical)' }} />
                    <span className="text-[10px] font-black uppercase tracking-wider text-red-400">{'\u26A0'} OFFICER SAFETY ALERT</span>
                    <div className="flex gap-2 ml-auto">
                      {selectedCall.officer_safety_caution && (
                        <span className="text-[8px] font-black text-red-300 uppercase px-1 py-px" style={{ background: 'rgb(var(--sev-critical-rgb) / 0.3)', border: '1px solid rgb(var(--sev-critical-rgb) / 0.6)' }}>CAUTION</span>
                      )}
                      {hasActiveWeapons(selectedCall.weapons_involved) && (
                        <span className="text-[8px] font-black text-red-300 uppercase px-1 py-px" style={{ background: 'rgb(var(--sev-critical-rgb) / 0.3)', border: '1px solid rgb(var(--sev-critical-rgb) / 0.6)' }}>WEAPONS: {selectedCall.weapons_involved}</span>
                      )}
                      {selectedCall.domestic_violence && (
                        <span className="text-[8px] font-black text-orange-300 uppercase px-1 py-px" style={{ background: 'rgb(var(--sev-warn-rgb) / 0.3)', border: '1px solid rgb(var(--sev-warn-rgb) / 0.6)' }}>DOMESTIC VIOLENCE</span>
                      )}
                    </div>
                  </div>
                )}

                {/* ── LOCATION section ── */}
                <div>
                  <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mb-1" style={{ letterSpacing: '0.1em' }}>Location</div>
                  <div className="text-[11px] text-rmpg-100 flex items-center gap-1.5">
                    <MapPin style={{ width: 11, height: 11, color: 'var(--sev-ok)' }} />
                    {selectedCall.location || 'No address'}
                  </div>
                  {selectedCall.cross_street && (
                    <div className="text-[9px] text-rmpg-400 ml-4">X-Street: {selectedCall.cross_street}</div>
                  )}
                  <div className="ml-4 mt-1"><ZsbBadge zoneId={selectedCall.zone_id} beatId={selectedCall.beat_id} dispatchCode={selectedCall.dispatch_code} sectionCode={selectedCall.sector_id} /></div>
                </div>

                {/* ── DESCRIPTION section ── */}
                {selectedCall.description && (
                  <div>
                    <div className="text-[9px] uppercase font-bold tracking-wider mb-1" style={{ color: 'var(--panel-header-color)', letterSpacing: '0.1em' }}>Description</div>
                    <div className="text-[10px] text-rmpg-200 p-2 bg-surface-sunken border border-rmpg-700">
                      {selectedCall.description}
                    </div>
                  </div>
                )}

                {/* Hazard flags */}
                {(selectedCall.weapons_involved && !['none', 'no', 'n/a', 'false', '0', ''].includes(String(selectedCall.weapons_involved).toLowerCase().trim())) || selectedCall.domestic_violence || selectedCall.injuries_reported ? (
                  <div className="flex items-center gap-2 p-2" style={{ background: 'rgb(var(--sev-critical-rgb) / 0.1)', border: '1px solid rgb(var(--sev-critical-rgb) / 0.5)' }}>
                    <AlertTriangle style={{ width: 12, height: 12, color: 'var(--sev-critical)' }} />
                    <div className="flex gap-2">
                      {hasActiveWeapons(selectedCall.weapons_involved) && (
                        <span className="text-[9px] font-bold text-red-400 uppercase">WEAPONS</span>
                      )}
                      {selectedCall.domestic_violence && (
                        <span className="text-[9px] font-bold text-orange-400 uppercase">DV</span>
                      )}
                      {selectedCall.injuries_reported && (
                        <span className="text-[9px] font-bold text-red-300 uppercase">INJURIES</span>
                      )}
                    </div>
                  </div>
                ) : null}
                {hasOfficerSafety && selectedCall.injuries_reported && (
                  <div className="flex items-center gap-2 p-2" style={{ background: 'rgb(var(--sev-critical-rgb) / 0.1)', border: '1px solid rgb(var(--sev-critical-rgb) / 0.5)' }}>
                    <AlertTriangle style={{ width: 12, height: 12, color: 'var(--sev-critical)' }} />
                    <span className="text-[9px] font-bold text-red-300 uppercase">INJURIES REPORTED</span>
                  </div>
                )}

                {/* ── SUBJECT / VEHICLE section ── */}
                {selectedCall.subject_description && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[9px] uppercase font-bold tracking-wider" style={{ color: 'var(--panel-header-color)', letterSpacing: '0.1em' }}>Subject Description</div>
                      <button type="button"
                        onClick={() => { setNcicQuery({ type: 'person', query: selectedCall.subject_description || '' }); setActiveTab('ncic'); }}
                        className="flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-bold uppercase bg-surface-sunken/40 text-rmpg-400 border border-border-default/50 hover:bg-surface-raised/50 transition-colors"
                        title="Run NCIC person query"
                      >
                        NCIC QH
                      </button>
                    </div>
                    <div className="text-[10px] text-rmpg-200">{selectedCall.subject_description}</div>
                  </div>
                )}
                {selectedCall.vehicle_description && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[9px] uppercase font-bold tracking-wider" style={{ color: 'var(--panel-header-color)', letterSpacing: '0.1em' }}>Vehicle Description</div>
                      <button type="button"
                        onClick={() => { setNcicQuery({ type: 'vehicle', query: selectedCall.vehicle_description || '' }); setActiveTab('ncic'); }}
                        className="flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-bold uppercase bg-surface-sunken/40 text-rmpg-400 border border-border-default/50 hover:bg-surface-raised/50 transition-colors"
                        title="Run NCIC vehicle query"
                      >
                        NCIC QV
                      </button>
                    </div>
                    <div className="text-[10px] text-rmpg-200">{selectedCall.vehicle_description}</div>
                  </div>
                )}

                {/* ── CALLER section ── */}
                {selectedCall.caller_name && (
                  <div>
                    <div className="text-[9px] uppercase font-bold tracking-wider mb-1" style={{ color: 'var(--panel-header-color)', letterSpacing: '0.1em' }}>Caller</div>
                    <div className="text-[10px] text-rmpg-200">
                      {selectedCall.caller_name}
                      {selectedCall.caller_phone && ` \u2014 ${selectedCall.caller_phone}`}
                    </div>
                  </div>
                )}

                {/* ── ASSIGNED UNITS section ── */}
                {selectedCall.assigned_units && selectedCall.assigned_units.length > 0 && (
                  <div>
                    <div className="text-[9px] uppercase font-bold tracking-wider mb-1" style={{ color: 'var(--panel-header-color)', letterSpacing: '0.1em' }}>Assigned Units</div>
                    <div className="flex gap-1 flex-wrap">
                      {selectedCall.assigned_units.map(u => (
                        <span
                          key={u}
                          className="text-[9px] font-mono font-bold px-1.5 py-0.5"
                          style={{
                            background: u === myUnit?.call_sign ? 'rgb(var(--sev-ok-rgb) / 0.2)' : 'var(--surface-base)',
                            color: u === myUnit?.call_sign ? 'var(--sev-ok)' : 'var(--spm-text-muted)',
                            border: `1px solid ${u === myUnit?.call_sign ? 'var(--sev-ok)' : 'var(--border-subtle)'}`,
                          }}
                        >
                          {u}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Premise history */}
                <PremiseHistory address={selectedCall.location} compact />

                {/* ── NOTES section with Add Note ── */}
                <div>
                  <div className="text-[9px] uppercase font-bold tracking-wider mb-1" style={{ color: 'var(--panel-header-color)', letterSpacing: '0.1em' }}>Notes</div>
                  {selectedCall.notes && selectedCall.notes.length > 0 ? (
                    <div className="space-y-1 mb-2">
                      {selectedCall.notes.map((note, i) => (
                        <div key={note.id || `${note.timestamp}-${i}`} className="text-[9px] text-rmpg-300 px-2 py-1 bg-surface-sunken border-l-2 border-l-rmpg-700">
                          <span className="text-rmpg-500">{safeTimeStr(note.timestamp)}</span>
                          {' \u2014 '}
                          {note.text}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[9px] text-rmpg-500 mb-2">No notes yet</div>
                  )}
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddNote()}
                      placeholder="Add note..."
                      className="flex-1 bg-surface-base border border-rmpg-600 text-white text-[9px] px-2 py-1 font-mono focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500/30 transition-colors"
                    />
                    <button type="button"
                      onClick={handleAddNote}
                      disabled={!noteText.trim() || addingNote}
                      className="px-2 py-1 text-[8px] font-bold uppercase bg-green-900/50 text-green-400 border border-green-700/50 hover:bg-green-800/50 disabled:opacity-40 transition-colors"
                    >
                      {addingNote ? '...' : 'Add Note'}
                    </button>
                  </div>
                </div>

                {/* Timer */}
                <div className="flex items-center gap-2 mt-3 text-[9px] text-rmpg-500">
                  <Clock style={{ width: 10, height: 10 }} />
                  <span>Created: {formatDateTime(selectedCall.created_at)}</span>
                  <span>{'\u2022'} Time in status: {formatTimer(getStatusElapsed(selectedCall))}</span>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-rmpg-500">
              <div className="text-center">
                <Monitor className="w-10 h-10 mx-auto mb-3 text-rmpg-600 opacity-60" />
                <p className="text-sm font-medium">Select a call to view details</p>
                <p className="text-[10px] text-rmpg-600 mt-1">or self-dispatch from the Pending queue</p>
                <div className="text-[8px] text-rmpg-600 mt-3 font-mono">MDT v5.3 ONLINE</div>
                <div className="text-[7px] text-rmpg-700 mt-2 font-mono">
                  F5=Enroute  F6=OnScene  F7=Clear  F8=NCIC  Esc=Close
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── STATUS BAR FOOTER ── */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-1 bg-surface-sunken border-t border-rmpg-700" style={{ minHeight: 26 }}>
        {/* Clock */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-bold text-white tracking-wider">{clockStr}</span>
        </div>

        {/* GPS status */}
        <div className="flex items-center gap-1.5">
          {gps.latitude ? (
            <>
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: 'var(--sev-ok)', boxShadow: '0 0 4px var(--sev-ok)' }}
              />
              <span className="text-[8px] font-mono text-green-400">
                {gps.latitude.toFixed(5)}, {gps.longitude?.toFixed(5)}
              </span>
            </>
          ) : (
            <>
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: 'var(--sev-critical)', boxShadow: '0 0 4px var(--sev-critical)' }}
              />
              <span className="text-[8px] font-mono text-red-400">NO GPS</span>
            </>
          )}
        </div>

        {/* Unit + status */}
        <div className="flex items-center gap-1.5">
          <Radio style={{ width: 9, height: 9, color: 'var(--spm-text-muted)' }} />
          <span className="text-[8px] font-mono font-bold text-rmpg-300">
            {myUnit?.call_sign || '---'}
          </span>
          {myUnit && (
            <span className="text-[8px] font-mono uppercase" style={{ color: UNIT_STATUSES.find(s => s.status === myUnit.status)?.color || 'var(--text-muted)' }}>
              {toDisplayLabel(myUnit.status)}
            </span>
          )}
        </div>

        {/* Call counts */}
        <div className="flex items-center gap-2">
          <span className="text-[8px] font-mono text-rmpg-400">
            ACT: <span className="text-green-400 font-bold">{activeCallCount}</span>
          </span>
          <span className="text-[8px] font-mono text-rmpg-400">
            PND: <span className="text-amber-400 font-bold">{pendingCallCount}</span>
          </span>
        </div>

        {/* Channel indicator */}
        <div className="flex items-center gap-1.5">
          <span className="text-[8px] font-mono font-bold text-rmpg-400">CH1 SECURE</span>
        </div>

        {/* MDT connection status — reflects actual WebSocket state */}
        <div className="flex items-center gap-1.5">
          <span
            className="w-2 h-2 rounded-full"
            style={{
              background: wsConnected ? 'var(--sev-ok)' : 'var(--sev-critical)',
              boxShadow: wsConnected
                ? '0 0 6px var(--sev-ok), 0 0 2px var(--sev-ok)'
                : '0 0 6px var(--sev-critical), 0 0 2px var(--sev-critical)',
              animation: wsConnected ? 'none' : 'officer-safety-flash 1.5s ease-in-out infinite',
            }}
          />
          <span
            className="text-[8px] font-mono font-bold uppercase tracking-wider"
            style={{ color: wsConnected ? 'var(--sev-ok)' : 'var(--sev-critical)' }}
          >
            {wsConnected ? 'MDT ONLINE' : 'MDT OFFLINE'}
          </span>
        </div>
      </div>

      {/* ── CSS for officer safety flash animation ── */}
      <style>{`
        @keyframes officer-safety-flash {
          0%, 100% { border-color: var(--sev-critical); background: rgb(var(--sev-critical-rgb) / 0.15); }
          50% { border-color: var(--sev-warn); background: rgb(var(--sev-warn-rgb) / 0.12); }
        }
      `}</style>
    </div>
  );
}
