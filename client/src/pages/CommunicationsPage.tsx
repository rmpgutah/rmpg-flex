import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  MessageSquare,
  AlertTriangle,
  Activity,
  Send,
  Plus,
  Clock,
  X,
  SendHorizontal,
  Loader2,
  Archive,
  RotateCcw,
  Trash2,
  Search,
  Reply,
  Inbox,
  ArrowLeft,
} from 'lucide-react';
import type {
  Message,
  BOLO,
  ActivityLogEntry,
  BOLOType,
  CallPriority,
  MessagePriority,
  ActivityAction,
} from '../types';
import StatusBadge from '../components/StatusBadge';
import { toDisplayLabel } from '../utils/formatters';
import PanelTitleBar from '../components/PanelTitleBar';
import RmpgLogo from '../components/RmpgLogo';
import PrintButton from '../components/PrintButton';
import ActivityFeed from '../components/ActivityFeed';
import FormModal from '../components/FormModal';
import ConfirmDialog from '../components/ConfirmDialog';
import { apiFetch, apiUploadFiles } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { usePersistedTab } from '../hooks/usePersistedState';
import { formatShortTime, formatDateTime } from '../utils/dateUtils';
import { useAuth } from '../context/AuthContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../components/ToastProvider';
import ExportButton from '../components/ExportButton';

// ============================================================
// Backend -> Frontend Mappers
// ============================================================

/** Raw message row from GET /api/comms/messages */
interface RawMessage {
  id: number;
  from_user_id: number;
  to_user_id: number | null;
  channel: string;
  content: string;
  priority: string;
  read_at: string | null;
  created_at: string;
  from_name: string | null;
  from_badge: string | null;
  to_name: string | null;
  subject: string | null;
  parent_id: number | null;
  thread_id: number | null;
}

function mapMessage(raw: RawMessage): Message {
  const priorityMap: Record<string, MessagePriority> = {
    routine: 'normal',
    urgent: 'urgent',
    emergency: 'emergency',
  };
  return {
    id: String(raw.id),
    from_user_id: String(raw.from_user_id),
    from_user_name: raw.from_name || 'Unknown',
    to_user_id: raw.to_user_id ? String(raw.to_user_id) : undefined,
    to_user_name: raw.channel === 'broadcast' ? 'All Units' : (raw.to_name || undefined),
    subject: raw.subject || (raw.content.length > 60 ? raw.content.slice(0, 60) + '...' : raw.content),
    body: raw.content,
    priority: priorityMap[raw.priority] || 'normal',
    is_read: raw.read_at !== null,
    is_broadcast: raw.channel === 'broadcast',
    parent_id: raw.parent_id ? String(raw.parent_id) : undefined,
    thread_id: raw.thread_id ? String(raw.thread_id) : undefined,
    created_at: raw.created_at,
  };
}

/** Raw BOLO row from GET /api/comms/bolos */
interface RawBOLO {
  id: number;
  bolo_number: string;
  type: string;
  status: string;
  title: string;
  description: string | null;
  subject_description: string | null;
  vehicle_description: string | null;
  photo_url: string | null;
  priority: string;
  issued_by: number;
  expires_at: string | null;
  created_at: string;
  issued_by_name: string | null;
}

function mapBOLO(raw: RawBOLO): BOLO {
  return {
    id: String(raw.id),
    bolo_number: raw.bolo_number,
    type: raw.type as BOLO['type'],
    status: raw.status as BOLO['status'],
    title: raw.title,
    description: raw.description || '',
    priority: raw.priority as CallPriority,
    subject_description: raw.subject_description || undefined,
    vehicle_description: raw.vehicle_description || undefined,
    issued_by: raw.issued_by_name || 'Unknown',
    issued_at: raw.created_at,
    photo_url: raw.photo_url || undefined,
    expires_at: raw.expires_at || undefined,
    created_at: raw.created_at,
    updated_at: raw.created_at,
  };
}

/** Raw activity row from GET /api/comms/activity-feed */
interface RawActivity {
  id: number;
  user_id: number | null;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  details: string | null;
  ip_address: string | null;
  created_at: string;
  user_name: string | null;
  badge_number: string | null;
  user_role: string | null;
}

function mapActivity(raw: RawActivity): ActivityLogEntry {
  return {
    id: String(raw.id),
    action: (raw.action || 'system') as ActivityAction,
    description: raw.details || '',
    user_id: raw.user_id ? String(raw.user_id) : undefined,
    user_name: raw.user_name || undefined,
    entity_type: raw.entity_type || undefined,
    entity_id: raw.entity_id ? String(raw.entity_id) : undefined,
    timestamp: raw.created_at,
  };
}

// ============================================================
// Thread grouping
// ============================================================

interface MessageThread {
  threadId: string;
  subject: string;
  participants: string[];
  messages: Message[];
  lastMessage: Message;
  hasUnread: boolean;
  unreadCount: number;
  highestPriority: MessagePriority;
  isBroadcast: boolean;
}

function groupMessagesIntoThreads(messages: Message[]): MessageThread[] {
  const threadMap = new Map<string, Message[]>();

  for (const msg of messages) {
    // Thread key: use thread_id if present, otherwise use own id (standalone message)
    const key = msg.thread_id || msg.id;
    const existing = threadMap.get(key) || [];
    existing.push(msg);
    threadMap.set(key, existing);
  }

  const threads: MessageThread[] = [];
  for (const [threadId, msgs] of threadMap) {
    // Sort messages in thread chronologically (oldest first for display)
    const sorted = [...msgs].sort((a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    const firstMsg = sorted[0];
    const lastMsg = sorted[sorted.length - 1];

    // Collect unique participant names
    const participantSet = new Set<string>();
    for (const m of sorted) {
      participantSet.add(m.from_user_name);
      if (m.to_user_name) participantSet.add(m.to_user_name);
    }

    // Determine highest priority in thread
    const priorityRank: Record<string, number> = { emergency: 3, urgent: 2, normal: 1 };
    let highestPriority: MessagePriority = 'normal';
    for (const m of sorted) {
      if ((priorityRank[m.priority] || 0) > (priorityRank[highestPriority] || 0)) {
        highestPriority = m.priority;
      }
    }

    threads.push({
      threadId,
      subject: firstMsg.subject || '(No Subject)',
      participants: Array.from(participantSet),
      messages: sorted,
      lastMessage: lastMsg,
      hasUnread: sorted.some((m) => !m.is_read),
      unreadCount: sorted.filter((m) => !m.is_read).length,
      highestPriority,
      isBroadcast: firstMsg.is_broadcast,
    });
  }

  // Sort threads by last message date (newest first)
  threads.sort((a, b) =>
    new Date(b.lastMessage.created_at).getTime() - new Date(a.lastMessage.created_at).getTime()
  );

  return threads;
}

// ============================================================
// Component
// ============================================================

type Panel = 'messages' | 'bolos' | 'activity';

const timeAgo = (date: string) => {
  const ms = Date.now() - new Date(date).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

export default function CommunicationsPage() {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const { addToast } = useToast();

  // --- Panel state ---
  const [activePanel, setActivePanel] = usePersistedTab('rmpg_comms_tab', 'messages' as Panel, ['messages', 'bolos', 'activity'] as const);

  // --- Search ---
  const [searchQuery, setSearchQuery] = useState('');

  // --- Messages state ---
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [showCompose, setShowCompose] = useState(false);
  const [composeSending, setComposeSending] = useState(false);

  // Compose form
  const [composeTo, setComposeTo] = useState('');
  const [composePriority, setComposePriority] = useState<string>('routine');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeContent, setComposeContent] = useState('');

  // Reply
  const [replyText, setReplyText] = useState('');
  const [replySending, setReplySending] = useState(false);
  const threadEndRef = useRef<HTMLDivElement>(null);

  // --- BOLOs state ---
  const [bolos, setBolos] = useState<BOLO[]>([]);
  const [bolosLoading, setBolosLoading] = useState(false);
  const [showNewBOLO, setShowNewBOLO] = useState(false);
  const [boloSubmitting, setBoloSubmitting] = useState(false);

  // BOLO form
  const [boloTitle, setBoloTitle] = useState('');
  const [boloType, setBoloType] = useState<BOLOType>('person');
  const [boloPriority, setBoloPriority] = useState<CallPriority>('P3');
  const [boloDescription, setBoloDescription] = useState('');
  const [boloSubjectDescription, setBoloSubjectDescription] = useState('');
  const [boloVehicleDescription, setBoloVehicleDescription] = useState('');
  const [boloPhotoFile, setBoloPhotoFile] = useState<File | null>(null);
  const [boloPhotoPreview, setBoloPhotoPreview] = useState<string | null>(null);

  // BOLO resolve / cancel
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<BOLO | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  // --- Officers state (for dynamic recipient list) ---
  const [officers, setOfficers] = useState<{ id: number; full_name: string }[]>([]);

  // --- Error state ---
  const [error, setError] = useState<string | null>(null);

  // --- Activity state ---
  const [activities, setActivities] = useState<ActivityLogEntry[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [activitiesTotal, setActivitiesTotal] = useState(0);
  const [activitiesLoadingMore, setActivitiesLoadingMore] = useState(false);

  // --- Upgrade: BOLO Stats state ---
  const [boloStats, setBoloStats] = useState<{
    byCategory: { category: string; count: number; active_count: number }[];
    byPriority: { priority: string; count: number }[];
    totalActive: number;
    expiringSoon: number;
    avgLifespanHours: number | null;
  } | null>(null);

  // --- Upgrade: Message priority stats ---
  const [msgPriorityStats, setMsgPriorityStats] = useState<{
    byPriority: { priority: string; total: number; read_count: number; avg_read_time_minutes: number | null }[];
    byChannel: { channel: string; count: number }[];
  } | null>(null);

  // ============================================================
  // Threading
  // ============================================================

  const threads = useMemo(() => groupMessagesIntoThreads(messages), [messages]);

  const selectedThread = useMemo(() => {
    if (!selectedThreadId) return null;
    return threads.find((t) => t.threadId === selectedThreadId) || null;
  }, [threads, selectedThreadId]);

  // ============================================================
  // Data fetching
  // ============================================================

  const fetchMessages = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setMessagesLoading(true);
    try {
      const res = await apiFetch<{ data: RawMessage[]; unreadCount: number }>('/comms/messages?limit=200');
      setMessages((Array.isArray(res?.data) ? res.data : []).map(mapMessage));
    } catch {
      if (!options?.silent) setError('Failed to load messages. Please try again.');
    } finally {
      if (!options?.silent) setMessagesLoading(false);
    }
  }, []);

  const fetchBolos = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setBolosLoading(true);
    try {
      const res = await apiFetch<RawBOLO[]>('/comms/bolos');
      setBolos((Array.isArray(res) ? res : []).map(mapBOLO));
    } catch {
      if (!options?.silent) setError('Failed to load BOLOs. Please try again.');
    } finally {
      if (!options?.silent) setBolosLoading(false);
    }
  }, []);

  const ACTIVITY_PAGE_SIZE = 50;

  const fetchActivity = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setActivitiesLoading(true);
    try {
      const res = await apiFetch<{ data: RawActivity[]; total: number; limit: number; offset: number }>(
        `/comms/activity-feed?limit=${ACTIVITY_PAGE_SIZE}&offset=0`
      );
      setActivities((Array.isArray(res?.data) ? res.data : []).map(mapActivity));
      setActivitiesTotal(res.total || 0);
    } catch {
      if (!options?.silent) setError('Failed to load activity feed. Please try again.');
    } finally {
      if (!options?.silent) setActivitiesLoading(false);
    }
  }, []);

  const loadMoreActivity = useCallback(async () => {
    setActivitiesLoadingMore(true);
    try {
      const res = await apiFetch<{ data: RawActivity[]; total: number; limit: number; offset: number }>(
        `/comms/activity-feed?limit=${ACTIVITY_PAGE_SIZE}&offset=${activities.length}`
      );
      setActivities((prev) => [...prev, ...(Array.isArray(res?.data) ? res.data : []).map(mapActivity)]);
      setActivitiesTotal(res.total || 0);
    } catch {
      setError('Failed to load more activity. Please try again.');
    } finally {
      setActivitiesLoadingMore(false);
    }
  }, [activities.length]);

  // Fetch data when the active panel changes
  useEffect(() => {
    if (activePanel === 'messages') fetchMessages();
    else if (activePanel === 'bolos') fetchBolos();
    else if (activePanel === 'activity') fetchActivity();
  }, [activePanel, fetchMessages, fetchBolos, fetchActivity]);

  // Initial load for messages (default panel) + officers list + stats
  useEffect(() => {
    fetchMessages();
    apiFetch<any[]>('/personnel')
      .then((data) => setOfficers((Array.isArray(data) ? data : []).map((u: any) => ({ id: u.id, full_name: u.full_name }))))
      .catch((err) => { console.warn('[CommunicationsPage] fetch personnel failed:', err); });
    // Fetch BOLO stats
    apiFetch<any>('/comms/bolos/stats')
      .then((data) => { if (data) setBoloStats(data); })
      .catch(() => { /* stats optional */ });
    // Fetch message priority stats
    apiFetch<any>('/comms/messages/priority-stats')
      .then((data) => { if (data) setMsgPriorityStats(data); })
      .catch(() => { /* stats optional */ });
  }, [fetchMessages]);

  // Scroll to bottom of thread when selected or new messages arrive
  useEffect(() => {
    if (selectedThread) {
      const timer = setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      return () => clearTimeout(timer);
    }
  }, [selectedThread?.messages.length]);

  // Live sync — auto-refresh when any device modifies comms data (silent to avoid unmounting UI)
  const refreshComms = useCallback(() => {
    if (activePanel === 'messages') fetchMessages();
    else if (activePanel === 'bolos') fetchBolos();
    else if (activePanel === 'activity') fetchActivity();
  }, [activePanel, fetchMessages, fetchBolos, fetchActivity]);
  const silentRefreshComms = useCallback(() => {
    if (activePanel === 'messages') fetchMessages({ silent: true });
    else if (activePanel === 'bolos') fetchBolos({ silent: true });
    else if (activePanel === 'activity') fetchActivity({ silent: true });
  }, [activePanel, fetchMessages, fetchBolos, fetchActivity]);
  useLiveSync('dispatch', silentRefreshComms);

  // ============================================================
  // Actions
  // ============================================================

  // --- Mark thread messages as read ---
  const markThreadAsRead = useCallback(async (thread: MessageThread) => {
    const unreadIds = thread.messages.filter((m) => !m.is_read).map((m) => m.id);
    if (unreadIds.length === 0) return;
    try {
      await Promise.all(
        unreadIds.map((id) => apiFetch(`/comms/messages/${id}/read`, { method: 'PUT' }))
      );
      setMessages((prev) =>
        prev.map((m) => (unreadIds.includes(m.id) ? { ...m, is_read: true } : m))
      );
    } catch {
      setError('Failed to mark messages as read.');
    }
  }, []);

  const handleSelectThread = useCallback(
    (thread: MessageThread) => {
      setSelectedThreadId(thread.threadId);
      setReplyText('');
      markThreadAsRead(thread);
    },
    [markThreadAsRead]
  );

  // --- Compose message ---
  const handleComposeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!composeContent.trim()) return;
    setComposeSending(true);
    try {
      const isBroadcast = composeTo === 'broadcast';
      await apiFetch('/comms/messages', {
        method: 'POST',
        body: JSON.stringify({
          to_user_id: isBroadcast ? undefined : (composeTo || undefined),
          channel: isBroadcast ? 'broadcast' : 'direct',
          content: composeContent.trim(),
          subject: composeSubject.trim() || undefined,
          priority: composePriority,
        }),
      });
      setShowCompose(false);
      setComposeTo('');
      setComposePriority('routine');
      setComposeSubject('');
      setComposeContent('');
      fetchMessages({ silent: true });
      addToast('Message sent', 'success');
    } catch {
      addToast('Failed to send message', 'error');
    } finally {
      setComposeSending(false);
    }
  };

  // --- Reply to thread ---
  const handleReply = async () => {
    if (!selectedThread || !replyText.trim()) return;
    setReplySending(true);
    try {
      const firstMsg = selectedThread.messages[0];
      const lastMsg = selectedThread.lastMessage;
      await apiFetch('/comms/messages', {
        method: 'POST',
        body: JSON.stringify({
          to_user_id: lastMsg.from_user_id === String(user?.id) ? firstMsg.from_user_id : lastMsg.from_user_id,
          channel: firstMsg.is_broadcast ? 'broadcast' : 'direct',
          content: replyText.trim(),
          subject: `Re: ${selectedThread.subject.replace(/^(Re:\s*)+/i, '')}`,
          parent_id: lastMsg.id,
          priority: 'routine',
        }),
      });
      setReplyText('');
      fetchMessages({ silent: true });
      addToast('Reply sent', 'success');
    } catch {
      addToast('Failed to send reply', 'error');
    } finally {
      setReplySending(false);
    }
  };

  // --- Delete Message ---
  const handleDeleteMessage = async (msgId: string) => {
    if (!window.confirm('Delete this message? This cannot be undone.')) return;
    try {
      await apiFetch(`/comms/messages/${msgId}`, { method: 'DELETE' });
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
      addToast('Message deleted', 'success');
    } catch {
      addToast('Failed to delete message', 'error');
    }
  };

  // --- Create BOLO ---
  const handleCreateBOLO = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!boloTitle.trim()) return;
    setBoloSubmitting(true);
    try {
      let photo_url: string | undefined;
      if (boloPhotoFile) {
        const uploaded = await apiUploadFiles([boloPhotoFile], 'bolo');
        if (uploaded.length > 0) photo_url = uploaded[0].file_id;
      }
      await apiFetch('/comms/bolos', {
        method: 'POST',
        body: JSON.stringify({
          type: boloType,
          title: boloTitle.trim(),
          description: boloDescription.trim() || undefined,
          subject_description: boloSubjectDescription.trim() || undefined,
          vehicle_description: boloVehicleDescription.trim() || undefined,
          priority: boloPriority,
          photo_url,
        }),
      });
      setShowNewBOLO(false);
      setBoloTitle('');
      setBoloType('person');
      setBoloPriority('P3');
      setBoloDescription('');
      setBoloSubjectDescription('');
      setBoloVehicleDescription('');
      setBoloPhotoFile(null);
      setBoloPhotoPreview(null);
      fetchBolos({ silent: true });
      addToast('BOLO created', 'success');
    } catch {
      addToast('Failed to create BOLO', 'error');
    } finally {
      setBoloSubmitting(false);
    }
  };

  const handleBoloPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setBoloPhotoFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setBoloPhotoPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleResolveBOLO = async (boloId: string) => {
    setResolvingId(boloId);
    try {
      await apiFetch(`/comms/bolos/${boloId}`, { method: 'PUT', body: JSON.stringify({ status: 'resolved' }) });
      fetchBolos({ silent: true });
      addToast('BOLO resolved', 'success');
    } catch {
      addToast('Failed to resolve BOLO', 'error');
    } finally {
      setResolvingId(null);
    }
  };

  const handleCancelBOLO = async () => {
    if (!cancelTarget) return;
    setCancelLoading(true);
    try {
      await apiFetch(`/comms/bolos/${cancelTarget.id}`, { method: 'DELETE' });
      setCancelTarget(null);
      fetchBolos({ silent: true });
      addToast('BOLO cancelled', 'success');
    } catch {
      addToast('Failed to cancel BOLO', 'error');
    } finally {
      setCancelLoading(false);
    }
  };

  const handleArchiveBOLO = async (boloId: string) => {
    try {
      await apiFetch(`/comms/bolos/${boloId}/archive`, { method: 'POST' });
      fetchBolos({ silent: true });
      addToast('BOLO archived', 'success');
    } catch {
      addToast('Failed to archive BOLO', 'error');
    }
  };

  const handleUnarchiveBOLO = async (boloId: string) => {
    try {
      await apiFetch(`/comms/bolos/${boloId}/unarchive`, { method: 'POST' });
      fetchBolos({ silent: true });
      addToast('BOLO unarchived', 'success');
    } catch {
      addToast('Failed to unarchive BOLO', 'error');
    }
  };

  // ============================================================
  // Derived
  // ============================================================

  const unreadCount = messages.filter((m) => !m.is_read).length;
  const activeBoloCount = bolos.filter((b) => b.status === 'active').length;
  const threadCount = threads.length;

  const filteredThreads = useMemo(() => {
    if (!searchQuery.trim()) return threads;
    const q = searchQuery.toLowerCase();
    return threads.filter((t) =>
      t.subject.toLowerCase().includes(q) ||
      t.participants.some((p) => p.toLowerCase().includes(q)) ||
      t.messages.some((m) => m.body.toLowerCase().includes(q))
    );
  }, [threads, searchQuery]);

  const panels: { id: Panel; label: string; icon: React.ElementType; badge?: number }[] = [
    { id: 'messages', label: 'Inbox', icon: Inbox, badge: unreadCount || undefined },
    { id: 'bolos', label: 'BOLOs', icon: AlertTriangle, badge: activeBoloCount || undefined },
    { id: 'activity', label: 'Activity Feed', icon: Activity },
  ];

  // ============================================================
  // Spinner helper
  // ============================================================

  const Spinner = ({ label }: { label?: string }) => (
    <div className="flex-1 flex flex-col items-center justify-center py-20 gap-2">
      <Loader2 className="w-6 h-6 animate-spin text-brand-400" role="status" aria-label="Loading" />
      {label && <p className="text-[10px] text-rmpg-500">{label}</p>}
    </div>
  );

  // ============================================================
  // Render helpers
  // ============================================================

  const currentUserId = String(user?.id || '');

  const getInitials = (name: string) => {
    if (!name) return '??';
    const parts = name.split(' ').filter(Boolean);
    return parts.length > 1 ? `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase() : name.slice(0, 2).toUpperCase();
  };

  // ============================================================
  // Render
  // ============================================================

  // Set document title
  useEffect(() => { document.title = 'Communications \u2014 RMPG Flex'; }, []);

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Portal Header */}
      <div className="panel-beveled bg-surface-base overflow-hidden">
        <div className="flex items-center gap-4 px-4 py-2.5 relative">
          <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, #0e3359, #1a5a9e 30%, #1a5a9e 70%, #0e3359)' }} />
          <RmpgLogo height={64} />
          <div className="flex-1">
            <h1 className="text-sm font-bold tracking-wider uppercase" style={{ color: '#d0d0d0' }}>Communications Center</h1>
            <p className="text-[9px] tracking-wide" style={{ color: '#3a5070' }}>Rocky Mountain Protective Group, LLC</p>
          </div>
        </div>
      </div>

      {/* Header */}
      <PanelTitleBar title="COMMUNICATIONS" icon={MessageSquare}>
        {activePanel === 'messages' && (
          <>
            <div className="flex items-center gap-1 px-2 py-0.5 panel-inset" style={{ background: '#0d1520' }}>
              <Search className="w-3 h-3 text-rmpg-500" />
              <input
                type="text"
                placeholder="Search conversations..." aria-label="Search conversations"
                autoComplete="off"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-transparent border-none outline-none text-xs text-white placeholder-rmpg-500"
                style={{ minWidth: '120px', maxWidth: '180px' }}
              />
              {searchQuery && (
                <button type="button" onClick={() => setSearchQuery('')} className="text-rmpg-500 hover:text-white">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <button type="button" onClick={() => setShowCompose(true)} className="toolbar-btn toolbar-btn-primary print:hidden">
              <Plus className="w-3.5 h-3.5" /> Compose
            </button>
            {/* Feature 30: Emergency broadcast button */}
            <button type="button"
              onClick={async () => {
                const msg = prompt('Emergency broadcast message to ALL units:');
                if (!msg) return;
                try {
                  await apiFetch('/comms/emergency-broadcast', {
                    method: 'POST',
                    body: JSON.stringify({ content: msg, subject: 'EMERGENCY BROADCAST' }),
                  });
                  addToast('Emergency broadcast sent to all units', 'success');
                } catch (err: any) { addToast(err?.message || 'Failed to send emergency broadcast', 'error'); }
              }}
              className="toolbar-btn text-red-400 border-red-700/50 hover:bg-red-900/30"
              title="Emergency Broadcast to ALL units"
            >
              <AlertTriangle className="w-3.5 h-3.5" /> Emergency
            </button>
          </>
        )}
        {activePanel === 'bolos' && (
          <button type="button" onClick={() => setShowNewBOLO(!showNewBOLO)} className="toolbar-btn toolbar-btn-danger">
            <Plus className="w-3.5 h-3.5" /> New BOLO
          </button>
        )}
        <ExportButton exportUrl="/api/comms/export/csv" exportFilename="communications.csv" />
        <PrintButton />
      </PanelTitleBar>

      {/* Panel Tabs */}
      <div className="px-4 py-2 border-b border-rmpg-600 flex items-center gap-4" style={{ background: '#0d1520' }}>
        <div className="flex gap-1">
          {panels.map((panel) => {
            const Icon = panel.icon;
            return (
              <button type="button"
                key={panel.id}
                onClick={() => { setActivePanel(panel.id); setSelectedThreadId(null); }}
                className={`
                  flex items-center gap-2 px-3 py-1.5 text-xs font-medium transition-colors
                  ${activePanel === panel.id
                    ? 'bg-rmpg-700 text-white border border-rmpg-600'
                    : 'text-rmpg-300 hover:text-white hover:bg-rmpg-700/50'
                  }
                `}
              >
                <Icon className="w-3.5 h-3.5" />
                {panel.label}
                {panel.badge ? (
                  <span className="px-1.5 py-0.5 text-[10px] font-bold bg-red-600 text-white">
                    {panel.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Stats */}
        <div className="flex items-center gap-3 ml-auto text-[9px] font-mono">
          {activePanel === 'messages' && (
            <>
              <span className="text-rmpg-400">Conversations: <strong className="text-white">{threadCount}</strong></span>
              {unreadCount > 0 && (
                <span className="flex items-center gap-1 text-red-400 font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> {unreadCount} unread
                </span>
              )}
              {/* Upgrade: Message priority breakdown */}
              {msgPriorityStats && msgPriorityStats.byPriority.length > 0 && (
                <span className="text-rmpg-500 text-[9px]">
                  {msgPriorityStats.byPriority.map(p => (
                    <span key={p.priority} className={`mr-2 ${p.priority === 'emergency' ? 'text-red-400' : p.priority === 'urgent' ? 'text-amber-400' : 'text-rmpg-400'}`}>
                      {p.priority}: {p.total}
                    </span>
                  ))}
                </span>
              )}
            </>
          )}
          {activePanel === 'bolos' && (
            <>
              <span className="text-rmpg-400">Total: <strong className="text-amber-400">{bolos.length}</strong></span>
              {activeBoloCount > 0 && (
                <span className="flex items-center gap-1 text-red-400 font-bold">
                  <AlertTriangle className="w-2.5 h-2.5" /> {activeBoloCount} active
                </span>
              )}
            </>
          )}
          <span className="text-rmpg-400 flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" />
            {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
          </span>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mx-4 mt-2 px-3 py-2 bg-red-900/40 border border-red-700/50 text-red-300 text-xs flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-red-400 hover:text-red-300">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden flex">
        {/* ═══════════════════════════════════════════════════════ */}
        {/* Messages Panel — Email-style threaded inbox            */}
        {/* ═══════════════════════════════════════════════════════ */}
        {activePanel === 'messages' && (
          <>
            {messagesLoading ? (
              <Spinner label="Loading messages..." />
            ) : (
              <>
                {/* Thread List (left pane) */}
                <div className={`${selectedThread ? (isMobile ? 'hidden' : 'w-[340px] flex-shrink-0') : 'w-full'} border-r border-rmpg-600 overflow-y-auto`}>
                  {filteredThreads.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-rmpg-400">
                      <Inbox className="w-8 h-8 mb-2" />
                      <p className="text-sm">{searchQuery ? 'No matching conversations' : 'No messages'}</p>
                      <button type="button" onClick={() => setShowCompose(true)} className="toolbar-btn toolbar-btn-primary mt-3">
                        <Plus className="w-3.5 h-3.5" /> Compose Message
                      </button>
                    </div>
                  ) : (
                    filteredThreads.map((thread) => {
                      const isSelected = selectedThreadId === thread.threadId;
                      const msgCount = thread.messages.length;
                      const lastMsg = thread.lastMessage;

                      return (
                        <div
                          key={thread.threadId}
                          onClick={() => handleSelectThread(thread)}
                          className={`
                            px-3 py-2.5 border-b border-rmpg-600/30 cursor-pointer transition-colors
                            ${isSelected ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : 'border-l-2 border-l-transparent hover:bg-surface-raised'}
                            ${thread.hasUnread ? 'bg-surface-base/50' : ''}
                          `}
                        >
                          {/* Row 1: Participants + timestamp */}
                          <div className="flex items-center justify-between mb-0.5">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              {thread.hasUnread && <div className="w-2 h-2 rounded-full bg-brand-400 flex-shrink-0" />}
                              <span className={`text-xs truncate ${thread.hasUnread ? 'font-bold text-white' : 'font-medium text-rmpg-200'}`}>
                                {thread.participants.filter((p) => p !== user?.full_name).join(', ') || thread.participants[0]}
                              </span>
                              {thread.isBroadcast && (
                                <span className="text-[9px] px-1 py-0.5 bg-brand-900/30 text-brand-400 border border-brand-700/30 flex-shrink-0">ALL</span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                              {thread.highestPriority === 'emergency' && (
                                <span className="px-1 py-0.5 text-[9px] font-bold bg-red-900/50 text-red-400 border border-red-700/50 animate-pulse">!</span>
                              )}
                              {thread.highestPriority === 'urgent' && (
                                <span className="px-1 py-0.5 text-[9px] font-bold bg-red-900/30 text-red-400 border border-red-700/30">!</span>
                              )}
                              <span className="text-[10px] text-rmpg-500 font-mono">
                                {formatShortTime(lastMsg.created_at)}
                              </span>
                            </div>
                          </div>

                          {/* Row 2: Subject + message count */}
                          <div className="flex items-center gap-2">
                            <p className={`text-xs truncate flex-1 ${thread.hasUnread ? 'font-bold text-white' : 'font-medium text-rmpg-300'}`}>
                              {thread.subject}
                            </p>
                            {msgCount > 1 && (
                              <span className="text-[9px] font-mono px-1.5 py-0.5 bg-rmpg-700/50 text-rmpg-300 flex-shrink-0">{msgCount}</span>
                            )}
                          </div>

                          {/* Row 3: Body preview */}
                          <p className="text-[11px] text-rmpg-500 truncate mt-0.5">
                            {lastMsg.from_user_name}: {lastMsg.body}
                          </p>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Thread Detail (right pane) — email conversation view */}
                {selectedThread && (
                  <div className={`${isMobile ? 'w-full' : 'flex-1'} flex flex-col overflow-hidden animate-slide-in-right`}>
                    {/* Thread header */}
                    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-rmpg-600 flex-shrink-0" style={{ background: '#0d1520' }}>
                      <button type="button"
                        onClick={() => setSelectedThreadId(null)}
                        className="p-1 hover:bg-rmpg-700 text-rmpg-400 transition-colors"
                        title="Back to inbox"
                      >
                        <ArrowLeft className="w-4 h-4" />
                      </button>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-bold text-white truncate">{selectedThread.subject}</h3>
                        <p className="text-[10px] text-rmpg-400 truncate">
                          {selectedThread.participants.join(', ')} &mdash; {selectedThread.messages.length} message{selectedThread.messages.length > 1 ? 's' : ''}
                        </p>
                      </div>
                      {selectedThread.highestPriority !== 'normal' && (
                        <span className={`px-1.5 py-0.5 text-[10px] font-bold border ${
                          selectedThread.highestPriority === 'emergency'
                            ? 'bg-red-900/50 text-red-400 border-red-700/50 animate-pulse'
                            : 'bg-red-900/30 text-red-400 border-red-700/30'
                        }`}>
                          {selectedThread.highestPriority.toUpperCase()}
                        </span>
                      )}
                      <button type="button" onClick={() => setSelectedThreadId(null)} className="p-1 hover:bg-rmpg-700 text-rmpg-400">
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Messages in thread */}
                    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                      {selectedThread.messages.map((msg, idx) => {
                        const isOwnMessage = msg.from_user_id === currentUserId;

                        return (
                          <div key={msg.id} className="group">
                            {/* Message bubble */}
                            <div className={`panel-beveled p-3 ${isOwnMessage ? 'ml-8 bg-brand-900/10 border-brand-700/20' : 'mr-8 bg-surface-base'}`}>
                              {/* Message header */}
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  {/* Avatar */}
                                  <div
                                    className="w-6 h-6 flex items-center justify-center text-[9px] font-bold flex-shrink-0"
                                    style={{
                                      background: isOwnMessage ? 'linear-gradient(135deg, #1e40af, #3b82f6)' : 'linear-gradient(135deg, #124070, #1a5a9e)',
                                      color: '#fff',
                                      border: isOwnMessage ? '1px solid #60a5fa' : '1px solid #3b8ad4',
                                      borderRadius: 2,
                                    }}
                                  >
                                    {getInitials(msg.from_user_name)}
                                  </div>
                                  <div>
                                    <span className="text-xs font-bold text-white">{msg.from_user_name}</span>
                                    {msg.to_user_name && (
                                      <span className="text-[10px] text-rmpg-400 ml-1.5">
                                        to {msg.to_user_name}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] text-rmpg-500 font-mono">{formatDateTime(msg.created_at)}</span>
                                  {msg.from_user_id === currentUserId && (
                                    <button type="button"
                                      onClick={(e) => { e.stopPropagation(); handleDeleteMessage(msg.id); }}
                                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-900/30 text-rmpg-500 hover:text-red-400 transition-all"
                                      title="Delete message"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Message body */}
                              <div className="text-sm text-rmpg-200 leading-relaxed whitespace-pre-wrap pl-8">
                                {msg.body}
                              </div>
                              {/* Feature 16: Acknowledge button for broadcast messages */}
                              {msg.is_broadcast && msg.from_user_id !== currentUserId && (
                                <div className="pl-8 mt-2 flex items-center gap-2">
                                  <button type="button"
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      try {
                                        await apiFetch(`/comms/messages/${msg.id}/acknowledge`, { method: 'PUT' });
                                        addToast('Message acknowledged', 'success');
                                      } catch { addToast('Failed to acknowledge', 'error'); }
                                    }}
                                    className="text-[9px] px-2 py-0.5 border border-green-700/50 bg-green-900/20 text-green-400 hover:bg-green-900/40 transition-colors"
                                    title="Acknowledge this message"
                                  >
                                    ACK
                                  </button>
                                </div>
                              )}
                              {/* Feature 11: Read receipt indicator for own messages */}
                              {msg.from_user_id === currentUserId && msg.is_read && (
                                <div className="pl-8 mt-1">
                                  <span className="text-[9px] text-green-500">Read</span>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      <div ref={threadEndRef} />
                    </div>

                    {/* Reply compose area */}
                    <div className="px-4 py-3 border-t border-rmpg-600 flex-shrink-0" style={{ background: '#0d1520' }}>
                      <div className="flex items-center gap-2 mb-2">
                        <Reply className="w-3.5 h-3.5 text-rmpg-400" />
                        <span className="text-[10px] text-rmpg-400 font-medium">
                          Reply to {selectedThread.participants.filter((p) => p !== user?.full_name).join(', ') || 'thread'}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <textarea
                          className="textarea-dark flex-1"
                          rows={2}
                          placeholder="Write your reply..."
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                              e.preventDefault();
                              handleReply();
                            }
                          }}
                          disabled={replySending}
                        />
                        <div className="flex flex-col gap-1">
                          <button type="button"
                            className="toolbar-btn toolbar-btn-primary h-full"
                            onClick={handleReply}
                            disabled={replySending || !replyText.trim()}
                            title="Send reply (Ctrl+Enter)"
                          >
                            {replySending ? <Loader2 className="w-4 h-4 animate-spin" role="status" aria-label="Loading" /> : <Send className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                      <span className="text-[9px] text-rmpg-600 mt-1 block">Ctrl+Enter to send</span>
                    </div>
                  </div>
                )}

                {/* Empty state when no thread selected (full width) */}
                {!selectedThread && filteredThreads.length > 0 && (
                  <div className="hidden" /> // Thread list takes full width
                )}
              </>
            )}
          </>
        )}

        {/* BOLOs Panel */}
        {activePanel === 'bolos' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* New BOLO Form */}
            {showNewBOLO && (
              <form onSubmit={handleCreateBOLO} className="bg-surface-base border border-red-700/40 p-4 animate-fade-in">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-red-400 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" /> Create New BOLO
                  </h3>
                  <button type="button" onClick={() => setShowNewBOLO(false)} className="text-rmpg-300 hover:text-white">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] text-rmpg-300 uppercase font-semibold mb-1 block">Title:</label>
                    <input type="text" className="input-dark min-h-[36px]" placeholder="BOLO title" value={boloTitle} onChange={(e) => setBoloTitle(e.target.value)} required />
                  </div>
                  <div>
                    <label className="text-[10px] text-rmpg-300 uppercase font-semibold mb-1 block">Type:</label>
                    <select className="select-dark" value={boloType} onChange={(e) => setBoloType(e.target.value as BOLOType)}>
                      <option value="person">Person</option>
                      <option value="vehicle">Vehicle</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-rmpg-300 uppercase font-semibold mb-1 block">Priority:</label>
                    <select className="select-dark" value={boloPriority} onChange={(e) => setBoloPriority(e.target.value as CallPriority)}>
                      <option value="P1">P1 - Emergency</option>
                      <option value="P2">P2 - Urgent</option>
                      <option value="P3">P3 - Routine</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-rmpg-300 uppercase font-semibold mb-1 block">Subject Description:</label>
                    <input type="text" className="input-dark min-h-[36px]" placeholder="Subject description" value={boloSubjectDescription} onChange={(e) => setBoloSubjectDescription(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-[10px] text-rmpg-300 uppercase font-semibold mb-1 block">Vehicle Description:</label>
                    <input type="text" className="input-dark min-h-[36px]" placeholder="Vehicle description" value={boloVehicleDescription} onChange={(e) => setBoloVehicleDescription(e.target.value)} />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] text-rmpg-300 uppercase font-semibold mb-1 block">Description:</label>
                    <textarea className="textarea-dark" rows={3} placeholder="Detailed description..." value={boloDescription} onChange={(e) => setBoloDescription(e.target.value)} />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] text-rmpg-300 uppercase font-semibold mb-1 block">Photo (optional):</label>
                    <div className="flex items-center gap-4">
                      <input type="file" accept="image/*" className="text-xs text-rmpg-300 file:mr-3 file:py-1 file:px-3 file:border file:border-rmpg-600 file:bg-rmpg-700 file:text-rmpg-200 file:text-xs file:cursor-pointer hover:file:bg-rmpg-600" onChange={handleBoloPhotoChange} />
                      {boloPhotoPreview && (
                        <div className="relative">
                          <img src={boloPhotoPreview} alt="Preview" className="w-16 h-16 object-cover border border-rmpg-600" />
                          <button type="button" className="absolute -top-1 -right-1 bg-red-600 rounded-full p-0.5" onClick={() => { setBoloPhotoFile(null); setBoloPhotoPreview(null); }}>
                            <X className="w-3 h-3 text-white" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <button type="button" onClick={() => setShowNewBOLO(false)} className="toolbar-btn">Cancel</button>
                  <button type="submit" className="toolbar-btn toolbar-btn-danger" disabled={boloSubmitting}>
                    {boloSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" role="status" aria-label="Loading" /> : <AlertTriangle className="w-3.5 h-3.5" />} Issue BOLO
                  </button>
                </div>
              </form>
            )}

            {/* Upgrade: BOLO Statistics Panel */}
            {boloStats && !showNewBOLO && (
              <div className="panel-beveled p-3 bg-surface-raised mb-2">
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="w-3.5 h-3.5 text-brand-blue" />
                  <span className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">BOLO Dashboard</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="bg-surface-sunken p-2 text-center">
                    <div className="text-lg font-bold text-red-400">{boloStats.totalActive}</div>
                    <div className="text-[9px] text-rmpg-400 uppercase">Active</div>
                  </div>
                  <div className="bg-surface-sunken p-2 text-center">
                    <div className="text-lg font-bold text-amber-400">{boloStats.expiringSoon}</div>
                    <div className="text-[9px] text-rmpg-400 uppercase">Expiring 24h</div>
                  </div>
                  {boloStats.byCategory.slice(0, 2).map((cat) => (
                    <div key={cat.category} className="bg-surface-sunken p-2 text-center">
                      <div className="text-lg font-bold text-rmpg-200">{cat.active_count}</div>
                      <div className="text-[9px] text-rmpg-400 uppercase">{cat.category}</div>
                    </div>
                  ))}
                </div>
                {boloStats.avgLifespanHours != null && (
                  <div className="text-[9px] text-rmpg-500 mt-1">Avg lifespan: {boloStats.avgLifespanHours}h</div>
                )}
                <div className="flex gap-1 mt-2">
                  <button
                    type="button"
                    className="toolbar-btn text-[10px]"
                    onClick={async () => {
                      try {
                        const r = await apiFetch<any>('/comms/bolos/expire-check', { method: 'POST' });
                        addToast(`Expired ${r?.expired || 0} BOLOs`, 'success');
                        fetchBolos();
                        apiFetch<any>('/comms/bolos/stats').then(d => d && setBoloStats(d)).catch(() => {});
                      } catch { addToast('Expire check failed', 'error'); }
                    }}
                  >
                    <Clock className="w-3 h-3" /> Check Expirations
                  </button>
                  <button
                    type="button"
                    className="toolbar-btn text-[10px]"
                    onClick={async () => {
                      try {
                        const r = await apiFetch<any>('/comms/bolos/auto-archive', { method: 'POST', body: JSON.stringify({ days_expired: 7 }) });
                        addToast(`Archived ${r?.archived || 0} expired BOLOs`, 'success');
                        fetchBolos();
                      } catch { addToast('Auto-archive failed', 'error'); }
                    }}
                  >
                    <Archive className="w-3 h-3" /> Auto-Archive Expired
                  </button>
                </div>
              </div>
            )}

            {bolosLoading ? (
              <Spinner label="Loading BOLOs..." />
            ) : bolos.length === 0 && !showNewBOLO ? (
              <div className="flex flex-col items-center justify-center py-20 text-rmpg-400">
                <AlertTriangle className="w-8 h-8 mb-2" />
                <p className="text-sm">No BOLOs</p>
              </div>
            ) : (
              bolos.map((bolo) => (
                <div
                  key={bolo.id}
                  className={`panel-beveled p-4 bg-surface-base ${bolo.priority === 'P1' ? 'border-red-700/50 animate-emergency-pulse' : bolo.priority === 'P2' ? 'border-amber-700/40' : ''}`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <AlertTriangle className={`w-5 h-5 ${bolo.priority === 'P1' ? 'text-red-400' : bolo.priority === 'P2' ? 'text-amber-400' : 'text-brand-400'}`} />
                      <div>
                        <h4 className="text-sm font-bold text-white">{bolo.title}</h4>
                        <p className="text-[10px] text-rmpg-400"><span className="font-mono text-green-400">{bolo.bolo_number}</span> | Issued by {bolo.issued_by}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={bolo.priority} type="priority" size="sm" />
                      <span className={`px-2 py-0.5 text-[10px] font-bold uppercase ${bolo.status === 'active' ? 'bg-red-900/50 text-red-400 border border-red-700/50' : 'bg-rmpg-700 text-rmpg-300'}`}>
                        {toDisplayLabel(bolo.status)}
                      </span>
                    </div>
                  </div>
                  {/* Feature 13: BOLO expiration tracking */}
                  {bolo.expires_at && bolo.status === 'active' && (
                    <div className="mb-2 flex items-center gap-2">
                      <Clock className="w-3 h-3 text-amber-400" />
                      <span className={`text-[10px] font-mono ${new Date(bolo.expires_at) <= new Date() ? 'text-red-400 font-bold' : 'text-amber-400'}`}>
                        {new Date(bolo.expires_at) <= new Date() ? 'EXPIRED' : `Expires: ${formatDateTime(bolo.expires_at)}`}
                      </span>
                    </div>
                  )}
                  <p className="text-sm text-rmpg-200 mb-3 leading-relaxed">{bolo.description}</p>
                  {bolo.photo_url && (
                    <div className="mb-3">
                      <img src={`/api/uploads/${bolo.photo_url}`} alt="BOLO Photo" className="max-w-[200px] max-h-[200px] object-cover border border-rmpg-600 cursor-pointer hover:opacity-80 transition-opacity" onClick={() => window.open(`/api/uploads/${bolo.photo_url}`, '_blank', 'noopener,noreferrer')} />
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                    {bolo.subject_name && (
                      <div><label className="text-[10px] text-rmpg-400 uppercase">Subject:</label><p className="text-rmpg-200 font-medium">{bolo.subject_name}</p></div>
                    )}
                    {bolo.vehicle_description && (
                      <div><label className="text-[10px] text-rmpg-400 uppercase">Vehicle:</label><p className="text-rmpg-200">{bolo.vehicle_description}</p></div>
                    )}
                    {bolo.subject_description && (
                      <div><label className="text-[10px] text-rmpg-400 uppercase">Description:</label><p className="text-rmpg-200">{bolo.subject_description}</p></div>
                    )}
                    {bolo.last_known_location && (
                      <div><label className="text-[10px] text-rmpg-400 uppercase">Last Known Location:</label><p className="text-rmpg-200">{bolo.last_known_location}</p></div>
                    )}
                  </div>
                  {bolo.status === 'active' && (
                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-rmpg-600">
                      <button type="button" className="toolbar-btn" onClick={() => handleResolveBOLO(bolo.id)} disabled={resolvingId === bolo.id}>
                        {resolvingId === bolo.id && <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" />} Mark Resolved
                      </button>
                      <button type="button" className="toolbar-btn text-amber-400" onClick={() => handleArchiveBOLO(bolo.id)}>
                        <Archive className="w-3 h-3" /> Archive
                      </button>
                      <button type="button" className="toolbar-btn text-red-400" onClick={() => setCancelTarget(bolo)}>Cancel BOLO</button>
                    </div>
                  )}
                  {bolo.status !== 'active' && (
                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-rmpg-600">
                      <button type="button" className="toolbar-btn text-green-400" onClick={() => handleUnarchiveBOLO(bolo.id)}>
                        <RotateCcw className="w-3 h-3" /> Unarchive
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Activity Feed Panel */}
        {activePanel === 'activity' && (
          <div className="flex-1 overflow-hidden p-4">
            <div className="panel-beveled h-full flex flex-col bg-surface-base">
              <div className="px-4 py-3 border-b border-rmpg-600 flex items-center gap-2">
                <Activity className="w-4 h-4 text-brand-400" />
                <span className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">Real-Time Activity Feed</span>
                {!activitiesLoading && (
                  <span className="text-xs text-rmpg-400">({activities.length} of {activitiesTotal} entries)</span>
                )}
              </div>
              <div className="flex-1 overflow-y-auto">
                {activitiesLoading ? (
                  <Spinner label="Loading activity..." />
                ) : (
                  <>
                    <ActivityFeed entries={activities} maxHeight="100%" showDate />
                    {activities.length < activitiesTotal && (
                      <div className="flex justify-center py-3 border-t border-rmpg-700/50">
                        <button type="button" onClick={loadMoreActivity} disabled={activitiesLoadingMore} className="toolbar-btn">
                          {activitiesLoadingMore ? (
                            <><Loader2 className="w-3.5 h-3.5 animate-spin" role="status" aria-label="Loading" /> Loading...</>
                          ) : (
                            <>Load More ({activitiesTotal - activities.length} remaining)</>
                          )}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Compose Modal */}
      <FormModal
        isOpen={showCompose}
        onClose={() => setShowCompose(false)}
        onSubmit={handleComposeSubmit}
        title="New Message"
        icon={SendHorizontal}
        submitLabel="Send Message"
        isSubmitting={composeSending}
        maxWidth="max-w-lg"
      >
        <div>
          <label className="text-[10px] text-rmpg-300 uppercase font-semibold mb-1 block">To:</label>
          <select className="select-dark" value={composeTo} onChange={(e) => setComposeTo(e.target.value)} required>
            <option value="">Select recipient...</option>
            <option value="broadcast">All Units (Broadcast)</option>
            {officers.map((o) => (
              <option key={o.id} value={String(o.id)}>{o.full_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-rmpg-300 uppercase font-semibold mb-1 block">Priority:</label>
          <select className={`select-dark ${composePriority === 'emergency' ? 'border-red-500 text-red-400' : composePriority === 'urgent' ? 'border-amber-500 text-amber-400' : ''}`} value={composePriority} onChange={(e) => setComposePriority(e.target.value)}>
            <option value="routine">Normal</option>
            <option value="urgent">Urgent</option>
            <option value="emergency">Emergency</option>
          </select>
          {/* Feature 12: Priority visual indicator */}
          {composePriority === 'emergency' && (
            <p className="text-[9px] text-red-400 mt-0.5 font-bold animate-pulse">EMERGENCY: This will trigger an alert to all officers</p>
          )}
          {composePriority === 'urgent' && (
            <p className="text-[9px] text-amber-400 mt-0.5">Urgent priority message</p>
          )}
        </div>
        <div>
          <label className="text-[10px] text-rmpg-300 uppercase font-semibold mb-1 block">Subject:</label>
          <input type="text" className="input-dark min-h-[36px]" placeholder="Message subject..." value={composeSubject} onChange={(e) => setComposeSubject(e.target.value)} required />
        </div>
        <div>
          <label className="text-[10px] text-rmpg-300 uppercase font-semibold mb-1 block">Message:</label>
          <textarea className="textarea-dark" rows={5} placeholder="Type your message..." value={composeContent} onChange={(e) => setComposeContent(e.target.value)} required />
        </div>
        {/* Feature 26: Save as Draft button */}
        <button
          type="button"
          onClick={async () => {
            if (!composeContent.trim()) { addToast('Cannot save empty draft', 'error'); return; }
            try {
              await apiFetch('/comms/drafts', {
                method: 'POST',
                body: JSON.stringify({
                  to_user_id: composeTo === 'broadcast' ? null : composeTo || null,
                  channel: composeTo === 'broadcast' ? 'broadcast' : 'direct',
                  content: composeContent,
                  subject: composeSubject,
                  priority: composePriority,
                }),
              });
              addToast('Draft saved', 'success');
              setShowCompose(false);
            } catch (err: any) { addToast(err?.message || 'Failed to save draft', 'error'); }
          }}
          className="toolbar-btn text-rmpg-400 hover:text-white"
        >
          Save as Draft
        </button>
      </FormModal>

      {/* Cancel BOLO Confirm Dialog */}
      <ConfirmDialog
        isOpen={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={handleCancelBOLO}
        title="Cancel BOLO"
        message={cancelTarget ? `Are you sure you want to cancel BOLO ${cancelTarget.bolo_number} "${cancelTarget.title}"? This action cannot be undone.` : ''}
        confirmLabel="Cancel BOLO"
        confirmVariant="danger"
        isLoading={cancelLoading}
      />
    </div>
  );
}
