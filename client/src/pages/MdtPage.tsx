// ============================================================
// RMPG Flex — Mobile Data Terminal (MDT) Page
// Officer-facing terminal for viewing assigned calls, changing
// unit status, self-dispatching to pending calls, and managing
// field operations. Mirrors the Spillman Flex MDT interface.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  Monitor,
  Radio,
  Navigation,
  Eye,
  CheckCircle,
  MapPin,
  Clock,
  Send,
  RefreshCw,
  AlertTriangle,
  ChevronRight,
  MessageSquare,
  Shield,
  FileText,
  Loader2,
} from 'lucide-react';
import type { CallForService, Unit, CallStatus } from '../types';
import { apiFetch } from '../hooks/useApi';
import { useIsMobile } from '../hooks/useIsMobile';
import { useGpsTracking } from '../hooks/useGpsTracking';
import { useLiveSync } from '../hooks/useLiveSync';
import { formatIncidentType } from '../utils/caseNumbers';
import { formatTimer, getStatusElapsed, isActiveStatus } from '../utils/dispatchTimers';
import StatusBadge from '../components/StatusBadge';
import PremiseHistory from '../components/PremiseHistory';
import NcicQueryPanel from '../components/NcicQueryPanel';

// ── Helpers ────────────────────────────────────────────────

function mapDbCall(raw: any): CallForService {
  return {
    ...raw,
    id: String(raw.id),
    assigned_units: (() => {
      try { return JSON.parse(raw.assigned_unit_ids || '[]').map(String); } catch { return []; }
    })(),
    notes: (() => {
      try { return JSON.parse(raw.notes || '[]'); } catch { return []; }
    })(),
  };
}

// ── Quick Status Buttons ────────────────────────────────────

const UNIT_STATUSES = [
  { label: 'AVAIL', status: 'available', color: '#22c55e' },
  { label: 'BUSY', status: 'busy', color: '#ef4444' },
  { label: 'OFF', status: 'off_duty', color: '#6b7280' },
] as const;

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
  useLiveSync('dispatch', fetchMessages);

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
    } catch (err) {
      console.error('Send message failed:', err);
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
      case 'emergency': return { color: '#ef4444', bg: 'rgba(239,68,68,0.1)' };
      case 'urgent':    return { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' };
      default:          return { color: '#22c55e', bg: 'transparent' };
    }
  };

  const channelBadge = (ch: string) => {
    const colors: Record<string, string> = { dispatch: '#3b82f6', broadcast: '#a855f7', direct: '#22c55e', zone: '#f59e0b' };
    return (
      <span
        className="text-[7px] font-black uppercase px-1 py-px"
        style={{ background: colors[ch] || '#666', color: '#000' }}
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
                className="px-3 py-2 border-b border-rmpg-800/50 cursor-pointer transition-colors hover:bg-white/[0.02]"
                style={{
                  background: ps.bg,
                  borderLeft: msg.read_at ? '3px solid transparent' : `3px solid ${ps.color}`,
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    {channelBadge(msg.channel)}
                    <span className="text-[10px] font-bold text-white">{msg.from_name || 'System'}</span>
                    {msg.from_badge && (
                      <span className="text-[8px] text-rmpg-500 font-mono">#{msg.from_badge}</span>
                    )}
                  </div>
                  <span className="text-[8px] text-rmpg-500 font-mono">
                    {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                {msg.subject && (
                  <div className="text-[9px] text-rmpg-300 font-semibold mt-0.5">{msg.subject}</div>
                )}
                <div className="text-[10px] text-rmpg-200 mt-0.5">{msg.content}</div>
                {msg.priority !== 'routine' && (
                  <span
                    className="text-[7px] font-black uppercase px-1 py-px mt-1 inline-block"
                    style={{ background: ps.color, color: '#000' }}
                  >
                    {msg.priority}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Compose bar */}
      <div className="flex-shrink-0 p-2 border-t border-rmpg-700/50" style={{ background: '#111' }}>
        <div className="flex items-center gap-1 mb-1">
          {(['dispatch', 'broadcast'] as const).map(ch => (
            <button
              key={ch}
              onClick={() => setComposeChannel(ch)}
              className="text-[8px] font-bold uppercase px-1.5 py-0.5 transition-colors"
              style={{
                background: composeChannel === ch ? '#3b82f6' : 'transparent',
                color: composeChannel === ch ? '#000' : '#666',
                border: `1px solid ${composeChannel === ch ? '#3b82f6' : '#333'}`,
              }}
            >
              {ch}
            </button>
          ))}
          <select
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
          <input
            type="text"
            value={composeText}
            onChange={(e) => setComposeText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Type message..."
            className="flex-1 bg-surface-base border border-rmpg-600 text-white text-[10px] px-2 py-1 focus:border-green-500 focus:outline-none"
          />
          <button
            onClick={handleSend}
            disabled={!composeText.trim()}
            className="px-3 py-1 text-[9px] font-bold uppercase bg-green-900/50 text-green-400 border border-green-700/50 hover:bg-green-800/50 disabled:opacity-40"
          >
            <Send style={{ width: 10, height: 10 }} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────

export default function MdtPage() {
  const isMobile = useIsMobile();
  const gps = useGpsTracking();
  const [myUnit, setMyUnit] = useState<Unit | null>(null);
  const [myCalls, setMyCalls] = useState<CallForService[]>([]);
  const [pendingCalls, setPendingCalls] = useState<CallForService[]>([]);
  const [selectedCall, setSelectedCall] = useState<CallForService | null>(null);
  const [activeTab, setActiveTab] = useState<'my-calls' | 'pending' | 'messages' | 'ncic'>('my-calls');
  const [ncicQuery, setNcicQuery] = useState<{ type: 'person' | 'vehicle' | 'warrant'; query: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [msgUnread, setMsgUnread] = useState(0);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [showFiForm, setShowFiForm] = useState(false);
  const [fiData, setFiData] = useState({ subject_name: '', location: '', reason: '', narrative: '' });
  const [fiSubmitting, setFiSubmitting] = useState(false);

  // ── Shift Report PDF ──
  const handleGenerateShiftReport = async () => {
    setGeneratingReport(true);
    try {
      const userId = localStorage.getItem('rmpg_user_id') || '';
      const today = new Date().toISOString().slice(0, 10);
      const data = await apiFetch<any>(`/reports/shift-activity/${userId}?date=${today}`);
      // Generate a text-based report and download as PDF-like text file
      const lines: string[] = [
        '═══════════════════════════════════════════════════════',
        '              RMPG FLEX — END OF SHIFT REPORT',
        '═══════════════════════════════════════════════════════',
        '',
        `Officer: ${data.officer?.full_name || 'N/A'}  Badge: ${data.officer?.badge_number || 'N/A'}`,
        `Date: ${data.date}  Unit: ${myUnit?.call_sign || 'N/A'}`,
        '',
        `───── SUMMARY ─────────────────────────────────────────`,
        `Calls Handled: ${data.summary.totalCalls}`,
        `Incidents Filed: ${data.summary.totalIncidents}`,
        `Patrol Scans: ${data.summary.totalScans}`,
        `Citations: ${data.summary.totalCitations}`,
        `Field Interviews: ${data.summary.totalFieldInterviews}`,
        '',
      ];

      if (data.calls.length > 0) {
        lines.push('───── CALLS FOR SERVICE ────────────────────────────────');
        data.calls.forEach((c: any) => {
          lines.push(`  ${c.call_number}  ${c.incident_type?.toUpperCase()}  ${c.priority}  ${c.status}`);
          lines.push(`    Location: ${c.location_address || 'N/A'}`);
          lines.push(`    Time: ${new Date(c.created_at).toLocaleTimeString()}`);
          lines.push('');
        });
      }

      if (data.incidents.length > 0) {
        lines.push('───── INCIDENT REPORTS ─────────────────────────────────');
        data.incidents.forEach((i: any) => {
          lines.push(`  ${i.incident_number}  ${i.incident_type?.toUpperCase()}  ${i.status}`);
          lines.push(`    Location: ${i.location_address || 'N/A'}`);
          lines.push('');
        });
      }

      if (data.scans.length > 0) {
        lines.push('───── PATROL SCANS ────────────────────────────────────');
        data.scans.forEach((s: any) => {
          lines.push(`  ${new Date(s.scanned_at).toLocaleTimeString()}  ${s.checkpoint_name || 'Unknown'}`);
        });
        lines.push('');
      }

      lines.push('═══════════════════════════════════════════════════════');
      lines.push(`Generated: ${new Date().toLocaleString()}`);

      const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `shift-report-${data.date}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to generate shift report:', err);
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
          officer_id: localStorage.getItem('rmpg_user_id') || '',
          call_id: selectedCall?.id || undefined,
        }),
      });
      setFiData({ subject_name: '', location: '', reason: '', narrative: '' });
      setShowFiForm(false);
    } catch (err) {
      console.error('Failed to submit FI:', err);
    }
    setFiSubmitting(false);
  };

  // ── Data Fetching ──
  const fetchData = useCallback(async () => {
    try {
      const [callsRaw, unitsRaw, msgResult] = await Promise.all([
        apiFetch<any[]>('/dispatch/calls?limit=100'),
        apiFetch<any[]>('/dispatch/units'),
        apiFetch<{ unreadCount: number }>('/comms/messages?limit=1'),
      ]);

      setMsgUnread(msgResult?.unreadCount || 0);

      const callsArray: any[] = Array.isArray((callsRaw as any)?.data) ? (callsRaw as any).data : Array.isArray(callsRaw) ? callsRaw : [];
      const allCalls = callsArray.map(mapDbCall);
      const allUnits = Array.isArray(unitsRaw) ? unitsRaw : [];

      // Find my unit via GPS hook's unit ID
      const unit = allUnits.find((u: any) => u.id === gps.unitId) || null;
      setMyUnit(unit ? { ...unit, id: String(unit.id) } as Unit : null);

      // My calls: calls where my unit is assigned
      if (unit) {
        const myUnitId = String(unit.id);
        setMyCalls(allCalls.filter(c =>
          isActiveStatus(c.status) && c.assigned_units?.includes(myUnitId)
        ));
      } else {
        setMyCalls([]);
      }

      // Pending calls (available for self-dispatch)
      setPendingCalls(allCalls.filter(c => c.status === 'pending'));

    } catch (err) {
      console.error('MDT fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [gps.unitId]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useLiveSync('dispatch', fetchData);

  // ── Unit Status Change ──
  const handleUnitStatus = async (newStatus: string) => {
    if (!myUnit) return;
    try {
      await apiFetch(`/dispatch/units/${myUnit.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus }),
      });
      fetchData();
    } catch (err) {
      console.error('Status change failed:', err);
    }
  };

  // ── Call Status Change ──
  const handleCallStatus = async (callId: string, newStatus: CallStatus) => {
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
    }
  };

  // ── Self-Dispatch ──
  const handleSelfDispatch = async (callId: string) => {
    if (!myUnit) return;
    try {
      await apiFetch(`/dispatch/calls/${callId}/assign-unit`, {
        method: 'POST',
        body: JSON.stringify({ unit_id: myUnit.id }),
      });
      fetchData();
    } catch (err) {
      console.error('Self-dispatch failed:', err);
    }
  };

  // ── Priority Color ──
  const prioColor = (p: string) => {
    switch (p) {
      case 'P1': return '#ef4444';
      case 'P2': return '#f97316';
      case 'P3': return '#eab308';
      default: return '#6b7280';
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-surface-base">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-green-500 animate-spin mx-auto mb-3" />
          <p className="text-rmpg-400 text-xs uppercase tracking-wider font-bold">Loading MDT...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-surface-base text-white overflow-hidden">
      {/* ── TOP BAR: Unit Identity & Status ─────────────── */}
      <div
        className={`${isMobile ? 'flex flex-col gap-1.5 px-3 py-2' : 'flex items-center justify-between px-4 py-2'} flex-shrink-0`}
        style={{ background: '#0c0c0c', borderBottom: '1px solid #222' }}
      >
        <div className="flex items-center gap-3">
          <Monitor style={{ width: 16, height: 16, color: '#22c55e' }} />
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
            <span className="text-[8px] text-rmpg-500 font-mono">
              {gps.latitude ? `${gps.latitude.toFixed(4)}, ${gps.longitude?.toFixed(4)}` : 'NO GPS'}
            </span>
          )}
        </div>

        {/* Quick status buttons + actions */}
        <div className={`flex items-center gap-1 ${isMobile ? 'overflow-x-auto' : ''}`}>
          <button
            onClick={() => setShowFiForm(!showFiForm)}
            className={`px-2 py-1 text-[9px] font-bold uppercase tracking-wider transition-colors border mr-0.5 ${
              showFiForm ? 'border-purple-500 text-purple-400 bg-purple-900/20' : 'border-rmpg-600 text-rmpg-400 hover:text-white hover:border-purple-500'
            }`}
            title="Quick Field Interview"
          >
            FI
          </button>
          <button
            onClick={handleGenerateShiftReport}
            disabled={generatingReport}
            className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider transition-colors border border-rmpg-600 text-rmpg-400 hover:text-white hover:border-brand-500 mr-1"
            title="Generate End-of-Shift Report"
          >
            {generatingReport ? <Loader2 style={{ width: 10, height: 10 }} className="animate-spin" /> : <FileText style={{ width: 10, height: 10 }} />}
          </button>
          {UNIT_STATUSES.map(({ label, status, color }) => (
            <button
              key={status}
              onClick={() => handleUnitStatus(status)}
              disabled={!myUnit}
              className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider transition-colors"
              style={{
                background: myUnit?.status === status ? color : 'transparent',
                color: myUnit?.status === status ? '#000' : color,
                border: `1px solid ${color}`,
                opacity: myUnit ? 1 : 0.4,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Quick FI Form ── */}
      {showFiForm && (
        <div className="px-4 py-2 flex-shrink-0 border-b border-purple-700/50" style={{ background: 'rgba(147, 51, 234, 0.08)' }}>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[9px] font-bold text-purple-400 uppercase tracking-wider">Quick Field Interview</span>
            {selectedCall && <span className="text-[8px] text-rmpg-400">Linked to {selectedCall.call_number}</span>}
          </div>
          <div className={`grid ${isMobile ? 'grid-cols-1' : 'grid-cols-4'} gap-2`}>
            <input
              type="text"
              className="input-dark text-[10px]"
              placeholder="Subject Name *"
              value={fiData.subject_name}
              onChange={(e) => setFiData(prev => ({ ...prev, subject_name: e.target.value }))}
            />
            <input
              type="text"
              className="input-dark text-[10px]"
              placeholder={gps.latitude ? `Location (auto: ${gps.latitude.toFixed(4)})` : 'Location'}
              value={fiData.location}
              onChange={(e) => setFiData(prev => ({ ...prev, location: e.target.value }))}
            />
            <input
              type="text"
              className="input-dark text-[10px]"
              placeholder="Reason for contact"
              value={fiData.reason}
              onChange={(e) => setFiData(prev => ({ ...prev, reason: e.target.value }))}
            />
            <div className="flex items-center gap-1">
              <input
                type="text"
                className="input-dark text-[10px] flex-1"
                placeholder="Brief narrative"
                value={fiData.narrative}
                onChange={(e) => setFiData(prev => ({ ...prev, narrative: e.target.value }))}
              />
              <button
                onClick={handleSubmitFi}
                disabled={!fiData.subject_name.trim() || fiSubmitting}
                className="px-2 py-1 text-[9px] font-bold uppercase bg-purple-700 text-white border border-purple-600 hover:bg-purple-600 disabled:opacity-40"
              >
                {fiSubmitting ? '...' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MAIN CONTENT ────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        {/* ── LEFT: Call List ── */}
        <div className={`${isMobile ? (selectedCall ? 'hidden' : 'w-full') : 'w-2/5'} flex flex-col border-r border-rmpg-700/50 overflow-hidden`}>
          {/* Tabs */}
          <div className="flex border-b border-rmpg-700/50 flex-shrink-0 overflow-x-auto" style={{ background: '#111' }}>
            {(['my-calls', 'pending', 'messages', 'ncic'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="flex-1 px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider transition-colors whitespace-nowrap"
                style={{
                  background: activeTab === tab ? '#141e2b' : 'transparent',
                  color: activeTab === tab ? (tab === 'ncic' ? '#22d3ee' : '#fff') : '#666',
                  borderBottom: activeTab === tab ? `2px solid ${tab === 'ncic' ? '#22d3ee' : '#22c55e'}` : '2px solid transparent',
                }}
              >
                {tab === 'my-calls' ? `My Calls (${myCalls.length})` :
                 tab === 'pending' ? `Pending (${pendingCalls.length})` :
                 tab === 'messages' ? `Messages${msgUnread > 0 ? ` (${msgUnread})` : ''}` :
                 'NCIC'}
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
                    className="px-3 py-2 cursor-pointer transition-colors border-b border-rmpg-800/50"
                    style={{
                      background: selectedCall?.id === call.id ? 'rgba(34,197,94,0.08)' : 'transparent',
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
                    <div className="text-[10px] text-white font-semibold mt-0.5">
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
                  <p>No pending calls</p>
                </div>
              ) : (
                pendingCalls.map(call => (
                  <div
                    key={call.id}
                    onClick={() => setSelectedCall(call)}
                    className="px-3 py-2 cursor-pointer transition-colors border-b border-rmpg-800/50"
                    style={{
                      background: selectedCall?.id === call.id ? 'rgba(34,197,94,0.08)' : 'transparent',
                      borderLeft: `3px solid ${prioColor(call.priority)}`,
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono font-bold text-amber-400">{call.call_number}</span>
                        <span
                          className="text-[8px] font-black px-1"
                          style={{ background: prioColor(call.priority), color: '#fff' }}
                        >
                          {call.priority}
                        </span>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleSelfDispatch(call.id); }}
                        className="flex items-center gap-1 px-2 py-0.5 text-[8px] font-bold uppercase bg-green-900/50 text-green-400 border border-green-700/50 hover:bg-green-800/50 transition-colors"
                      >
                        <Send style={{ width: 8, height: 8 }} /> Self-Dispatch
                      </button>
                    </div>
                    <div className="text-[10px] text-white font-semibold mt-0.5">
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
          </div>
        </div>

        {/* ── RIGHT: Call Detail ── */}
        <div className={`${isMobile ? (selectedCall ? 'w-full' : 'hidden') : 'flex-1'} flex flex-col overflow-hidden`}>
          {selectedCall ? (
            <>
              {/* Call header */}
              <div
                className="px-4 py-2 flex items-center justify-between flex-shrink-0"
                style={{ borderBottom: '1px solid #222', background: '#111' }}
              >
                <div>
                  {isMobile && (
                    <button
                      onClick={() => setSelectedCall(null)}
                      className="text-rmpg-400 hover:text-white text-[10px] font-bold uppercase tracking-wider mb-1"
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
                      className="text-[8px] font-black px-1 py-px"
                      style={{ background: prioColor(selectedCall.priority), color: '#fff' }}
                    >
                      {selectedCall.priority}
                    </span>
                  </div>
                  <div className="text-[11px] text-white font-semibold mt-0.5">
                    {formatIncidentType(selectedCall.incident_type)}
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-1">
                  {selectedCall.status === 'dispatched' && (
                    <button
                      onClick={() => handleCallStatus(selectedCall.id, 'enroute')}
                      className="flex items-center gap-1 px-3 py-1.5 text-[9px] font-bold uppercase bg-blue-900/50 text-blue-400 border border-blue-700/50 hover:bg-blue-800/50 transition-colors"
                    >
                      <Navigation style={{ width: 10, height: 10 }} /> En Route
                    </button>
                  )}
                  {selectedCall.status === 'enroute' && (
                    <button
                      onClick={() => handleCallStatus(selectedCall.id, 'onscene')}
                      className="flex items-center gap-1 px-3 py-1.5 text-[9px] font-bold uppercase bg-purple-900/50 text-purple-400 border border-purple-700/50 hover:bg-purple-800/50 transition-colors"
                    >
                      <Eye style={{ width: 10, height: 10 }} /> On Scene
                    </button>
                  )}
                  {selectedCall.status === 'onscene' && (
                    <button
                      onClick={() => handleCallStatus(selectedCall.id, 'cleared')}
                      className="flex items-center gap-1 px-3 py-1.5 text-[9px] font-bold uppercase bg-gray-700/50 text-rmpg-300 border border-rmpg-600/50 hover:bg-gray-600/50 transition-colors"
                    >
                      <CheckCircle style={{ width: 10, height: 10 }} /> Clear
                    </button>
                  )}
                  {selectedCall.status === 'pending' && myUnit && (
                    <button
                      onClick={() => handleSelfDispatch(selectedCall.id)}
                      className="flex items-center gap-1 px-3 py-1.5 text-[9px] font-bold uppercase bg-green-900/50 text-green-400 border border-green-700/50 hover:bg-green-800/50 transition-colors"
                    >
                      <Send style={{ width: 10, height: 10 }} /> Accept
                    </button>
                  )}
                </div>
              </div>

              {/* Call details body */}
              <div className="flex-1 overflow-auto p-4 space-y-3">
                {/* Location */}
                <div>
                  <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mb-1">Location</div>
                  <div className="text-[11px] text-white flex items-center gap-1.5">
                    <MapPin style={{ width: 11, height: 11, color: '#22c55e' }} />
                    {selectedCall.location || 'No address'}
                  </div>
                  {selectedCall.cross_street && (
                    <div className="text-[9px] text-rmpg-400 ml-4">X-Street: {selectedCall.cross_street}</div>
                  )}
                </div>

                {/* Description */}
                {selectedCall.description && (
                  <div>
                    <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mb-1">Description</div>
                    <div className="text-[10px] text-rmpg-200 p-2" style={{ background: '#111', border: '1px solid #222' }}>
                      {selectedCall.description}
                    </div>
                  </div>
                )}

                {/* Hazard flags */}
                {(selectedCall.weapons_involved || selectedCall.domestic_violence || selectedCall.injuries_reported) && (
                  <div className="flex items-center gap-2 p-2" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid #991b1b' }}>
                    <AlertTriangle style={{ width: 12, height: 12, color: '#ef4444' }} />
                    <div className="flex gap-2">
                      {selectedCall.weapons_involved && (
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
                )}

                {/* Subject / Vehicle descriptions with NCIC buttons */}
                {selectedCall.subject_description && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">Subject Description</div>
                      <button
                        onClick={() => { setNcicQuery({ type: 'person', query: selectedCall.subject_description || '' }); setActiveTab('ncic'); }}
                        className="flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-bold uppercase bg-cyan-900/40 text-cyan-400 border border-cyan-700/50 hover:bg-cyan-800/50 transition-colors"
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
                      <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">Vehicle Description</div>
                      <button
                        onClick={() => { setNcicQuery({ type: 'vehicle', query: selectedCall.vehicle_description || '' }); setActiveTab('ncic'); }}
                        className="flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-bold uppercase bg-cyan-900/40 text-cyan-400 border border-cyan-700/50 hover:bg-cyan-800/50 transition-colors"
                        title="Run NCIC vehicle query"
                      >
                        NCIC QV
                      </button>
                    </div>
                    <div className="text-[10px] text-rmpg-200">{selectedCall.vehicle_description}</div>
                  </div>
                )}

                {/* Caller info */}
                {selectedCall.caller_name && (
                  <div>
                    <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mb-1">Caller</div>
                    <div className="text-[10px] text-rmpg-200">
                      {selectedCall.caller_name}
                      {selectedCall.caller_phone && ` — ${selectedCall.caller_phone}`}
                    </div>
                  </div>
                )}

                {/* Assigned units */}
                {selectedCall.assigned_units && selectedCall.assigned_units.length > 0 && (
                  <div>
                    <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mb-1">Assigned Units</div>
                    <div className="flex gap-1 flex-wrap">
                      {selectedCall.assigned_units.map(u => (
                        <span
                          key={u}
                          className="text-[9px] font-mono font-bold px-1.5 py-0.5"
                          style={{
                            background: u === myUnit?.call_sign ? 'rgba(34,197,94,0.2)' : '#222',
                            color: u === myUnit?.call_sign ? '#22c55e' : '#999',
                            border: `1px solid ${u === myUnit?.call_sign ? '#16a34a' : '#333'}`,
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

                {/* Notes / Timeline */}
                {selectedCall.notes && selectedCall.notes.length > 0 && (
                  <div>
                    <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mb-1">Notes</div>
                    <div className="space-y-1">
                      {selectedCall.notes.slice(-5).map((note, i) => (
                        <div key={i} className="text-[9px] text-rmpg-300 px-2 py-1" style={{ background: '#111', borderLeft: '2px solid #333' }}>
                          <span className="text-rmpg-500">{new Date(note.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          {' — '}
                          {note.text}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Timer */}
                <div className="flex items-center gap-2 mt-3 text-[9px] text-rmpg-500">
                  <Clock style={{ width: 10, height: 10 }} />
                  <span>Created: {new Date(selectedCall.created_at).toLocaleString()}</span>
                  <span>• Time in status: {formatTimer(getStatusElapsed(selectedCall))}</span>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-rmpg-500">
              <div className="text-center">
                <Monitor className="w-10 h-10 mx-auto mb-3 text-rmpg-600" />
                <p className="text-sm">Select a call to view details</p>
                <p className="text-[10px] text-rmpg-600 mt-1">or self-dispatch from the Pending queue</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
