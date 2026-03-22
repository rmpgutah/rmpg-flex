import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Radio,
  Mic,
  MicOff,
  Users,
  Volume2,
  AlertCircle,
  WifiOff,
  ShieldAlert,
  History,
  Search,
  Download,
  Phone,
  PhoneOff,
  PhoneCall,
  PhoneIncoming,
  VolumeX,
  Play,
  Square,
} from 'lucide-react';
import { useRadio } from '../hooks/useRadio';
import { usePrivateCall } from '../hooks/usePrivateCall';
import { useAuth } from '../context/AuthContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { useToast } from '../components/ToastProvider';

// ============================================================
// RMPG Flex — RadioPage
// Full-screen PTT two-way radio with channel selector,
// real-time audio streaming, and retro CAD styling.
// ============================================================

export default function RadioPage() {
  const {
    currentChannel,
    isTransmitting,
    activeSpeaker,
    channelUsers,
    transmissionLog,
    channelBusy,
    error,
    micSupported,
    liveTranscript,
    panicAlert,
    joinChannel,
    leaveChannel,
    startTransmit,
    stopTransmit,
    sendPage,
    emergencyOverride,
    startScan,
    stopScan,
    scanActive,
    scanChannels,
    incomingPage,
    setLinkedCall,
    linkedCallId,
    dismissPage,
    isConnected,
    radioChannels: RADIO_CHANNELS,
  } = useRadio();

  const {
    incomingCall,
    activeCall,
    isInCall,
    isRinging,
    ringingTarget,
    callDuration,
    isMuted: callMuted,
    error: callError,
    startCall,
    acceptCall,
    declineCall,
    endCall,
    toggleMute,
  } = usePrivateCall();

  const { user } = useAuth();
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  const pttRef = useRef<HTMLButtonElement>(null);

  // Track whether space is held down (prevent key-repeat)
  const spaceHeldRef = useRef(false);

  // Mobile sidebar drawer toggle
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);

  // ─── Keyboard PTT (Space bar) ──────────────────────────────
  useEffect(() => {
    if (!currentChannel) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // Block PTT during private calls
      if (isInCall) return;

      if ((e.code === 'Space' || e.key === 'F5' || e.keyCode === 279) && !spaceHeldRef.current) {
        e.preventDefault();
        spaceHeldRef.current = true;
        startTransmit();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if ((e.code === 'Space' || e.key === 'F5' || e.keyCode === 279) && spaceHeldRef.current) {
        e.preventDefault();
        spaceHeldRef.current = false;
        stopTransmit();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [currentChannel, startTransmit, stopTransmit, isInCall]);

  // Get the current channel info
  const channelInfo = RADIO_CHANNELS.find(c => c.id === currentChannel);

  // Is someone else transmitting (not us)?
  const otherSpeaking = activeSpeaker && activeSpeaker.userId !== Number(user?.id);

  // ─── Transcript History ──────────────────────────────────
  const [showHistory, setShowHistory] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<any[]>([]);
  const [historySearch, setHistorySearch] = useState('');
  const [historyChannel, setHistoryChannel] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);

  // ─── Audio Playback ───────────────────────────────────
  const [playingId, setPlayingId] = useState<string | number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const blobUrlRef = useRef<string | null>(null);

  const togglePlayback = useCallback(async (entryId: string | number) => {
    if (playingId === entryId) {
      // Stop current playback
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
      setPlayingId(null);
      return;
    }
    // Stop any existing playback and clean up previous blob
    if (audioRef.current) {
      audioRef.current.pause();
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }

    try {
      // Fetch audio with JWT auth header (new Audio(url) can't set headers)
      const token = localStorage.getItem('rmpg_token');
      const res = await fetch(`/api/comms/radio/audio/${entryId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        console.error('[Radio Playback] HTTP error:', res.status, res.statusText);
        throw new Error(`HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      blobUrlRef.current = blobUrl;

      const audio = new Audio(blobUrl);
      audio.onended = () => {
        setPlayingId(null);
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
          blobUrlRef.current = null;
        }
      };
      audio.onerror = (e) => {
        console.error('[Radio Playback] Audio element error:', e);
        setPlayingId(null);
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
          blobUrlRef.current = null;
        }
      };
      audioRef.current = audio;
      await audio.play();
      setPlayingId(entryId);
    } catch (err) {
      console.error('[Radio Playback] Failed:', err);
      addToast('Failed to play recording', 'error');
      setPlayingId(null);
    }
  }, [playingId]);

  // Cleanup audio + blob URLs on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (historyChannel) params.set('channel', historyChannel);
      if (historySearch) params.set('search', historySearch);
      const result = await apiFetch<{ data: any[]; total: number }>(`/comms/radio/transcripts?${params.toString()}`);
      setHistoryEntries(result.data || []);
    } catch {
      setHistoryEntries([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [historyChannel, historySearch]);

  useLiveSync('dispatch', fetchHistory);

  useEffect(() => {
    if (showHistory) fetchHistory();
  }, [showHistory, fetchHistory]);

  const exportHistoryCsv = () => {
    if (historyEntries.length === 0) return;
    const header = 'Timestamp,Channel,User,Duration(s),Transcript,Has Audio\n';
    const rows = historyEntries.map(e =>
      `"${e.transmitted_at}","${e.channel}","${e.full_name || e.username || ''}","${e.duration_seconds || ''}","${(e.transcript || '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}","${e.audio_file ? 'Yes' : 'No'}"`
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `radio-transcripts-${localToday()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── Format helpers ─────────────────────────────────────────
  const formatLogTime = (ts: number) => {
    if (!ts || ts < 1000000000000) return '--:--:--'; // Guard bogus timestamps
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const formatDuration = (sec: number) => {
    if (!sec || sec < 0 || sec > 3600) return ''; // Guard bogus durations
    if (sec < 60) return `${sec}s`;
    return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  };

  const displayName = (entry: { fullName?: string; username?: string }) => {
    return entry.fullName || entry.username || 'Unknown';
  };

  /** Format call duration as mm:ss */
  const formatCallDuration = (sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // ─── Shared sidebar content (users + log) ──────────────────
  const renderSidebarContent = () => (
    <>
      {/* Channel Users */}
      <div
        className="px-3 py-2"
        style={{
          borderBottom: '1px solid #1e3048',
          background: 'linear-gradient(180deg, #1a2636 0%, #141e2b 100%)',
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          <Users style={{ width: 12, height: 12, color: '#5a6e80' }} />
          <span className="text-[10px] font-mono font-bold tracking-wider text-rmpg-400">
            ON CHANNEL ({channelUsers.length})
          </span>
        </div>
        <div className="space-y-1 max-h-32 overflow-y-auto">
          {channelUsers.length === 0 ? (
            <div className="text-[10px] font-mono text-rmpg-600 italic">
              No users on channel
            </div>
          ) : (
            channelUsers.map((u) => {
              const isMe = u.userId === Number(user?.id);
              return (
                <div
                  key={u.userId}
                  className="flex items-center gap-2 py-0.5 group"
                >
                  <span
                    className="led-dot"
                    style={{
                      background: activeSpeaker?.userId === u.userId
                        ? '#ef4444'
                        : '#22c55e',
                      boxShadow: activeSpeaker?.userId === u.userId
                        ? '0 0 4px #ef4444'
                        : '0 0 4px #22c55e',
                    }}
                  />
                  <span className="text-[11px] font-mono text-rmpg-200 truncate flex-1">
                    {u.fullName || u.username || 'Unknown'}
                  </span>
                  <span className="text-[9px] font-mono text-rmpg-600 uppercase flex-shrink-0">
                    {u.role || ''}
                  </span>
                  {/* Call button — only show for other users, not ourselves */}
                  {!isMe && !isInCall && (
                    <button
                      onClick={() => startCall(u.userId)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 p-0.5 text-blue-400 hover:text-blue-300"
                      title={`Call ${u.fullName || u.username}`}
                    >
                      <Phone style={{ width: 11, height: 11 }} />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Transmission Log / History */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div
          className="px-3 py-2 flex items-center justify-between"
          style={{
            borderBottom: '1px solid #162236',
            background: 'linear-gradient(180deg, #1a2636 0%, #141e2b 100%)',
          }}
        >
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowHistory(false)}
              className="flex items-center gap-1 px-2 py-0.5 text-[9px] font-mono font-bold tracking-wider transition-colors"
              style={{
                color: !showHistory ? '#fff' : '#5a6e80',
                borderBottom: !showHistory ? '2px solid #1a5a9e' : '2px solid transparent',
              }}
            >
              <Radio style={{ width: 10, height: 10 }} /> LIVE
            </button>
            <button
              onClick={() => setShowHistory(true)}
              className="flex items-center gap-1 px-2 py-0.5 text-[9px] font-mono font-bold tracking-wider transition-colors"
              style={{
                color: showHistory ? '#fff' : '#5a6e80',
                borderBottom: showHistory ? '2px solid #3b82f6' : '2px solid transparent',
              }}
            >
              <History style={{ width: 10, height: 10 }} /> HISTORY
            </button>
          </div>
          {showHistory && (
            <button
              onClick={exportHistoryCsv}
              className="text-[8px] text-rmpg-500 hover:text-white flex items-center gap-0.5"
              title="Export CSV"
            >
              <Download style={{ width: 8, height: 8 }} /> CSV
            </button>
          )}
        </div>

        {/* History filters */}
        {showHistory && (
          <div className="px-3 py-1.5 flex items-center gap-1" style={{ borderBottom: '1px solid #162236', background: '#0d1520' }}>
            <Search style={{ width: 9, height: 9, color: '#5a6e80' }} />
            <input
              type="text"
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              placeholder="Search transcripts..."
              className="flex-1 bg-transparent text-[9px] text-white font-mono focus:outline-none"
            />
            <select
              value={historyChannel}
              onChange={(e) => setHistoryChannel(e.target.value)}
              className="bg-surface-base text-[8px] text-rmpg-300 border border-rmpg-700 px-1 py-0.5 font-mono"
            >
              <option value="">All Channels</option>
              {RADIO_CHANNELS.map(ch => (
                <option key={ch.id} value={ch.id}>{ch.label}</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-3 py-1">
          {!showHistory ? (
            /* Live transmission log */
            transmissionLog.length === 0 ? (
              <div className="text-[10px] font-mono text-rmpg-600 italic py-2">
                No transmissions yet
              </div>
            ) : (
              transmissionLog.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-2 py-1.5 border-b border-rmpg-800/50"
                >
                  <span className="text-[9px] font-mono text-rmpg-600 flex-shrink-0 mt-px">
                    {formatLogTime(entry.startedAt)}
                  </span>
                  <div className="min-w-0">
                    <span className="text-[10px] font-mono text-rmpg-300 truncate block">
                      {displayName(entry)}
                    </span>
                    <span className="text-[9px] font-mono text-rmpg-600">
                      {formatDuration(entry.duration)}
                      {entry.duration > 0 ? ' on ' : ''}
                      {(entry.channel || '').toUpperCase()}
                    </span>
                    {entry.transcript && (
                      <div className="text-[10px] font-mono text-rmpg-400 mt-0.5 leading-snug italic">
                        "{entry.transcript}"
                      </div>
                    )}
                  </div>
                  {entry.hasAudio && (
                    <span className="flex-shrink-0 mt-px" title="Audio recorded">
                      <Volume2 size={10} className="text-green-600" />
                    </span>
                  )}
                </div>
              ))
            )
          ) : (
            /* Persistent transcript history */
            historyLoading ? (
              <div className="text-[10px] font-mono text-rmpg-600 italic py-2">Loading...</div>
            ) : historyEntries.length === 0 ? (
              <div className="text-[10px] font-mono text-rmpg-600 italic py-2">
                No transcripts found
              </div>
            ) : (
              historyEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-2 py-1.5 border-b border-rmpg-800/50"
                >
                  <span className="text-[9px] font-mono text-rmpg-600 flex-shrink-0 mt-px">
                    {new Date(entry.transmitted_at).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-mono text-rmpg-300 truncate">
                        {entry.full_name || entry.username || 'Unknown'}
                      </span>
                      <span
                        className="text-[7px] font-black uppercase px-1 py-px"
                        style={{ background: '#1a5a9e', color: '#fff' }}
                      >
                        {(entry.channel || '').toUpperCase()}
                      </span>
                    </div>
                    {entry.duration_seconds > 0 && (
                      <span className="text-[9px] font-mono text-rmpg-600">
                        {formatDuration(entry.duration_seconds)}
                      </span>
                    )}
                    {entry.transcript && (
                      <div className="text-[10px] font-mono text-rmpg-400 mt-0.5 leading-snug italic">
                        "{entry.transcript}"
                      </div>
                    )}
                  </div>
                  {entry.audio_file && (
                    <button
                      onClick={() => togglePlayback(entry.id)}
                      className="flex-shrink-0 mt-px p-0.5 rounded hover:bg-rmpg-800 transition-colors"
                      title={playingId === entry.id ? 'Stop playback' : 'Play recording'}
                    >
                      {playingId === entry.id ? (
                        <Square size={12} className="text-red-400" />
                      ) : (
                        <Play size={12} className="text-green-400" />
                      )}
                    </button>
                  )}
                </div>
              ))
            )
          )}
        </div>
      </div>
    </>
  );

  return (
    <div className="h-full flex flex-col" style={{ background: '#141e2b' }}>

      {/* ─── HTTPS Warning Banner ────────────────────────────── */}
      {!micSupported && (
        <div
          className="flex items-center gap-3 px-4 py-3"
          style={{
            background: 'rgba(220, 38, 38, 0.15)',
            borderBottom: '1px solid #991b1b',
          }}
        >
          <ShieldAlert style={{ width: 18, height: 18, color: '#ef4444', flexShrink: 0 }} />
          <div>
            <div className="text-xs font-mono font-bold text-red-400">
              SECURE CONNECTION REQUIRED
            </div>
            <div className="text-[10px] font-mono text-rmpg-400 mt-0.5">
              Microphone access requires HTTPS. You can still listen to transmissions from other users,
              but you cannot transmit. Access via <span className="text-white">https://</span> to enable your microphone.
            </div>
          </div>
        </div>
      )}

      {/* ─── Panic Alert Banner ─────────────────────────────── */}
      {panicAlert && (
        <div
          className="flex items-center gap-3 px-4 py-3 animate-pulse"
          style={{
            background: 'rgba(239, 68, 68, 0.25)',
            borderBottom: '2px solid #ef4444',
          }}
        >
          <AlertCircle style={{ width: 20, height: 20, color: '#ef4444', flexShrink: 0 }} />
          <div className="flex-1">
            <div className="text-xs font-mono font-bold text-red-400 tracking-wider">
              ⚠ EMERGENCY BROADCAST — {panicAlert.user_name}
              {panicAlert.badge_number ? ` (${panicAlert.badge_number})` : ''}
              {panicAlert.unit_call_sign ? ` — ${panicAlert.unit_call_sign}` : ''}
            </div>
            {panicAlert.location_address && (
              <div className="text-[10px] font-mono text-red-300 mt-0.5">
                Location: {panicAlert.location_address}
              </div>
            )}
          </div>
          <div className="text-[9px] font-mono text-red-400 flex-shrink-0 uppercase tracking-widest">
            LIVE
          </div>
        </div>
      )}

      {/* ─── Incoming Page Banner ──────────────────────────────── */}
      {incomingPage && (
        <div
          className="flex items-center gap-3 px-4 py-2"
          style={{
            background: 'rgba(59, 130, 246, 0.15)',
            borderBottom: '2px solid #3b82f6',
            flexShrink: 0,
          }}
        >
          <Radio style={{ width: 16, height: 16, color: '#60a5fa', flexShrink: 0 }} />
          <div className="flex-1">
            <div className="text-[10px] font-mono font-bold text-blue-300 tracking-wider">
              PAGE FROM {incomingPage.from_full_name || incomingPage.from_username}
              {incomingPage.from_call_sign ? ` (${incomingPage.from_call_sign})` : ''}
            </div>
            {incomingPage.message && (
              <div className="text-[10px] font-mono text-blue-400/80 mt-0.5">
                {incomingPage.message}
              </div>
            )}
          </div>
          <button
            onClick={dismissPage}
            className="text-[9px] font-mono text-blue-400 hover:text-white px-2 py-0.5"
            style={{ border: '1px solid #3b82f680' }}
          >
            DISMISS
          </button>
        </div>
      )}

      {/* ─── Active Private Call Bar ────────────────────────── */}
      {(isInCall && activeCall) && (
        <div
          className="flex items-center gap-3 px-4 py-2"
          style={{
            background: 'linear-gradient(90deg, rgba(59, 130, 246, 0.2) 0%, rgba(59, 130, 246, 0.08) 100%)',
            borderBottom: '2px solid #3b82f6',
            flexShrink: 0,
          }}
        >
          <PhoneCall style={{ width: 16, height: 16, color: '#3b82f6', flexShrink: 0 }} />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-mono font-bold text-blue-300 truncate">
              PRIVATE CALL — {activeCall.partnerName}
            </div>
            <div className="text-[10px] font-mono text-blue-400/70">
              {formatCallDuration(callDuration)}
              {callMuted && ' — MUTED'}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={toggleMute}
              className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono font-bold transition-colors"
              style={{
                border: `1px solid ${callMuted ? '#ef4444' : '#2a3e58'}`,
                color: callMuted ? '#ef4444' : '#8a9aaa',
                background: callMuted ? 'rgba(239, 68, 68, 0.1)' : 'transparent',
              }}
            >
              {callMuted ? <VolumeX style={{ width: 12, height: 12 }} /> : <Mic style={{ width: 12, height: 12 }} />}
              {callMuted ? 'UNMUTE' : 'MUTE'}
            </button>
            <button
              onClick={endCall}
              className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono font-bold text-red-400 hover:text-red-300 transition-colors"
              style={{ border: '1px solid #ef4444', background: 'rgba(239, 68, 68, 0.1)' }}
            >
              <PhoneOff style={{ width: 12, height: 12 }} />
              END
            </button>
          </div>
        </div>
      )}

      {/* ─── Ringing Outgoing Call ──────────────────────────── */}
      {isRinging && ringingTarget && (
        <div
          className="flex items-center gap-3 px-4 py-2"
          style={{
            background: 'linear-gradient(90deg, rgba(59, 130, 246, 0.15) 0%, rgba(59, 130, 246, 0.05) 100%)',
            borderBottom: '1px solid #3b82f680',
            flexShrink: 0,
          }}
        >
          <Phone style={{ width: 14, height: 14, color: '#60a5fa', animation: 'radioPulse 1.5s ease infinite' }} />
          <span className="text-xs font-mono text-blue-300">
            Calling <strong>{ringingTarget.name}</strong>...
          </span>
          <button
            onClick={endCall}
            className="ml-auto text-[10px] font-mono text-red-400 hover:text-red-300 px-2 py-0.5"
            style={{ border: '1px solid #ef4444' }}
          >
            CANCEL
          </button>
        </div>
      )}

      {/* ─── Incoming Call Overlay ──────────────────────────── */}
      {incomingCall && (
        <div
          className="flex items-center gap-3 px-4 py-3"
          style={{
            background: 'linear-gradient(90deg, rgba(34, 197, 94, 0.2) 0%, rgba(34, 197, 94, 0.05) 100%)',
            borderBottom: '2px solid #22c55e',
            flexShrink: 0,
            animation: 'incomingCallPulse 2s ease-in-out infinite',
          }}
        >
          <PhoneIncoming style={{ width: 20, height: 20, color: '#22c55e', flexShrink: 0 }} />
          <div className="flex-1">
            <div className="text-xs font-mono font-bold text-green-300">
              INCOMING CALL
            </div>
            <div className="text-sm font-mono text-white font-bold">
              {incomingCall.callerName}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => acceptCall(incomingCall.callId)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-mono font-bold text-white transition-colors"
              style={{
                background: '#22c55e',
                border: '1px solid #16a34a',
              }}
            >
              <Phone style={{ width: 14, height: 14 }} />
              ACCEPT
            </button>
            <button
              onClick={() => declineCall(incomingCall.callId)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-mono font-bold text-white transition-colors"
              style={{
                background: '#ef4444',
                border: '1px solid #dc2626',
              }}
            >
              <PhoneOff style={{ width: 14, height: 14 }} />
              DECLINE
            </button>
          </div>
        </div>
      )}

      {/* ─── Private Call Error ──────────────────────────────── */}
      {callError && (
        <div
          className="flex items-center gap-2 px-4 py-1.5 text-[10px] font-mono text-amber-400"
          style={{ background: 'rgba(245, 158, 11, 0.08)', borderBottom: '1px solid #78350f' }}
        >
          <AlertCircle style={{ width: 12, height: 12, flexShrink: 0 }} />
          {callError}
        </div>
      )}

      {/* ─── No-channel state: channel selector only ─────────── */}
      {!currentChannel && (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-lg">
            {/* Header */}
            <div className="text-center mb-6">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Radio style={{ width: 24, height: 24, color: '#1a5a9e' }} />
                <span className="text-lg font-bold font-mono tracking-wider text-white">
                  RADIO
                </span>
              </div>
              <p className="text-xs font-mono text-rmpg-400">
                Select a channel to join
              </p>
              {!isConnected && (
                <div className="flex items-center justify-center gap-2 mt-2 text-red-400 text-xs font-mono">
                  <WifiOff style={{ width: 12, height: 12 }} />
                  DISCONNECTED — Radio unavailable
                </div>
              )}
            </div>

            {/* Channel grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {RADIO_CHANNELS.map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => joinChannel(ch.id)}
                  disabled={!isConnected}
                  className="group flex flex-col items-center p-4 transition-all duration-150 border"
                  style={{
                    background: 'linear-gradient(180deg, #1e3048 0%, #1a2636 100%)',
                    border: '1px solid #2a3e58',
                    opacity: isConnected ? 1 : 0.4,
                  }}
                  onMouseEnter={(e) => {
                    if (isConnected) {
                      e.currentTarget.style.borderColor = '#1a5a9e';
                      e.currentTarget.style.background = 'linear-gradient(180deg, #1e3050 0%, #1a2840 100%)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = '#2a3e58';
                    e.currentTarget.style.background = 'linear-gradient(180deg, #1e3048 0%, #1a2636 100%)';
                  }}
                >
                  <span className="text-sm font-bold font-mono tracking-wider text-white">
                    {ch.label}
                  </span>
                  <span className="text-[10px] font-mono text-rmpg-500 mt-1">
                    {ch.freq} MHz
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── Active channel view ────────────────────────────── */}
      {currentChannel && (
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* ── Channel Bar ─────────────────────────────────── */}
          <div
            className="flex items-center justify-between px-3 py-2"
            style={{
              background: 'linear-gradient(180deg, #1e3048 0%, #1a2636 100%)',
              borderBottom: '1px solid #1e3048',
              flexShrink: 0,
            }}
          >
            {/* Left — channel pills */}
            <div className="flex items-center gap-1 overflow-x-auto hide-scrollbar">
              {RADIO_CHANNELS.map((ch) => {
                const isActive = ch.id === currentChannel;
                return (
                  <button
                    key={ch.id}
                    onClick={() => {
                      if (!isActive) joinChannel(ch.id);
                    }}
                    className={`flex items-center gap-1.5 ${isMobile ? 'px-3.5 py-1.5 text-[11px]' : 'px-2.5 py-1 text-[10px]'} font-mono font-bold tracking-wider whitespace-nowrap transition-all border`}
                    style={{
                      background: isActive
                        ? 'rgba(26, 90, 158, 0.25)'
                        : 'transparent',
                      borderColor: isActive ? '#1a5a9e' : 'transparent',
                      color: isActive ? '#fff' : '#5a6e80',
                      minHeight: isMobile ? 36 : undefined,
                    }}
                  >
                    {isActive && <span className="led-dot led-green" />}
                    {ch.label}
                  </button>
                );
              })}
            </div>

            {/* Right — leave + scan buttons */}
            <div className="flex items-center gap-1 ml-2">
              <button
                onClick={leaveChannel}
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono font-bold text-rmpg-400 hover:text-red-400 transition-colors"
                style={{ border: '1px solid #2a3e58' }}
              >
                LEAVE
              </button>
              {/* Scan toggle */}
              <button
                onClick={() => {
                  if (scanActive) {
                    stopScan();
                  } else {
                    // Scan all channels except current
                    const others = RADIO_CHANNELS.filter(c => c.id !== currentChannel).map(c => c.id);
                    startScan(others);
                  }
                }}
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono font-bold transition-colors"
                style={{
                  border: `1px solid ${scanActive ? '#22c55e' : '#2a3e58'}`,
                  color: scanActive ? '#22c55e' : '#5a6e80',
                  background: scanActive ? 'rgba(34, 197, 94, 0.1)' : 'transparent',
                }}
              >
                {scanActive ? 'SCAN ON' : 'SCAN'}
              </button>
            </div>
          </div>

          {/* ── Main Content ────────────────────────────────── */}
          <div className={`flex-1 flex ${isMobile ? 'flex-col' : 'flex-row'} overflow-hidden`}>

            {/* ── Left Panel: Radio Display ─────────────────── */}
            <div className={`flex flex-col items-center justify-center ${isMobile ? 'flex-1' : 'flex-[2]'} p-4`} style={{ position: isMobile ? 'relative' : undefined }}>

              {/* Channel frequency display */}
              <div
                className="w-full max-w-sm mb-6 p-4 text-center"
                style={{
                  background: '#0a0f0a',
                  border: '2px solid #1e3048',
                  boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.5)',
                }}
              >
                <div className="text-[10px] font-mono text-green-700 mb-1 tracking-widest">
                  CHANNEL
                </div>
                <div
                  className="text-2xl font-bold font-mono tracking-widest"
                  style={{ color: '#33ff33', textShadow: '0 0 10px rgba(51, 255, 51, 0.4)' }}
                >
                  {channelInfo?.label || currentChannel.toUpperCase()}
                </div>
                <div
                  className="text-sm font-mono mt-1"
                  style={{ color: '#33ff33', opacity: 0.6 }}
                >
                  {channelInfo?.freq || '---'} MHz
                </div>
              </div>

              {/* Active speaker indicator */}
              <div className="w-full max-w-sm mb-6 text-center" style={{ minHeight: 48 }}>
                {activeSpeaker ? (
                  <div className="flex items-center justify-center gap-3">
                    {/* Animated waveform bars */}
                    <div className="flex items-end gap-0.5 h-5">
                      {[0, 1, 2, 3, 4].map(i => (
                        <div
                          key={i}
                          className="w-1 bg-red-500"
                          style={{
                            animation: `radioWave 0.6s ease-in-out ${i * 0.1}s infinite alternate`,
                          }}
                        />
                      ))}
                    </div>
                    <div>
                      <div className="text-sm font-bold font-mono text-red-400">
                        {activeSpeaker.fullName || activeSpeaker.username || 'Unknown'}
                      </div>
                      <div className="text-[10px] font-mono text-rmpg-500">
                        TRANSMITTING
                      </div>
                    </div>
                    <div className="flex items-end gap-0.5 h-5">
                      {[0, 1, 2, 3, 4].map(i => (
                        <div
                          key={i}
                          className="w-1 bg-red-500"
                          style={{
                            animation: `radioWave 0.6s ease-in-out ${i * 0.12}s infinite alternate`,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-[10px] font-mono text-rmpg-500 tracking-wider">
                    CHANNEL CLEAR
                  </div>
                )}
              </div>

              {/* PTT Button */}
              <button
                ref={pttRef}
                onMouseDown={() => startTransmit()}
                onMouseUp={() => stopTransmit()}
                onMouseLeave={() => { if (isTransmitting) stopTransmit(); }}
                onTouchStart={(e) => { e.preventDefault(); startTransmit(); }}
                onTouchEnd={(e) => { e.preventDefault(); stopTransmit(); }}
                disabled={!isConnected || !micSupported || (channelBusy && !isTransmitting) || isInCall}
                className="relative flex items-center justify-center select-none"
                style={{
                  width: isMobile ? 180 : 160,
                  height: isMobile ? 180 : 160,
                  borderRadius: '50%',
                  background: isInCall
                    ? 'radial-gradient(circle, #1e3048 0%, #141e2b 70%, #0d1520 100%)'
                    : !micSupported
                      ? 'radial-gradient(circle, #2a3e58 0%, #1a2636 70%, #0d1520 100%)'
                      : isTransmitting
                        ? 'radial-gradient(circle, #dc2626 0%, #991b1b 70%, #450a0a 100%)'
                        : otherSpeaking
                          ? 'radial-gradient(circle, #b89030 0%, #6a5010 70%, #3a2a06 100%)'
                          : 'radial-gradient(circle, #2a4a2a 0%, #1a3a1a 70%, #0a2a0a 100%)',
                  border: isInCall
                    ? '4px solid #3b82f680'
                    : !micSupported
                      ? '4px solid #2a3e58'
                      : isTransmitting
                        ? '4px solid #ff4444'
                        : otherSpeaking
                          ? '4px solid #d4a030'
                          : '4px solid #2a5a2a',
                  boxShadow: isTransmitting
                    ? '0 0 30px rgba(217, 48, 48, 0.5), inset 0 2px 8px rgba(0,0,0,0.5)'
                    : otherSpeaking
                      ? '0 0 20px rgba(212, 160, 48, 0.3), inset 0 2px 8px rgba(0,0,0,0.5)'
                      : '0 0 20px rgba(34, 90, 34, 0.3), inset 0 2px 8px rgba(0,0,0,0.5)',
                  cursor: (!isConnected || !micSupported || (channelBusy && !isTransmitting) || isInCall) ? 'not-allowed' : 'pointer',
                  opacity: (!isConnected || !micSupported || isInCall) ? 0.4 : 1,
                  transition: 'all 0.15s ease',
                  touchAction: 'none',
                }}
              >
                {/* Pulse ring when transmitting */}
                {isTransmitting && (
                  <div
                    className="absolute inset-[-8px] rounded-full"
                    style={{
                      border: '2px solid rgba(217, 48, 48, 0.4)',
                      animation: 'radioPulse 1.2s ease-out infinite',
                    }}
                  />
                )}

                <div className="flex flex-col items-center">
                  {isInCall ? (
                    <PhoneCall style={{ width: 32, height: 32, color: '#60a5fa' }} />
                  ) : !micSupported ? (
                    <MicOff style={{ width: 32, height: 32, color: '#5a6e80' }} />
                  ) : isTransmitting ? (
                    <Mic style={{ width: 32, height: 32, color: '#fff' }} />
                  ) : otherSpeaking ? (
                    <Volume2 style={{ width: 32, height: 32, color: '#d4a030' }} />
                  ) : (
                    <Mic style={{ width: 32, height: 32, color: '#66cc66' }} />
                  )}
                  <span
                    className="text-[10px] font-mono font-bold tracking-wider mt-2"
                    style={{
                      color: isInCall ? '#60a5fa'
                        : !micSupported ? '#5a6e80'
                        : isTransmitting ? '#fff'
                        : otherSpeaking ? '#d4a030'
                        : '#66cc66',
                    }}
                  >
                    {isInCall ? 'IN CALL' : !micSupported ? 'NO MIC' : isTransmitting ? 'TX' : otherSpeaking ? 'RX' : 'PTT'}
                  </span>
                </div>
              </button>

              {/* Hint text */}
              <div className="mt-4 text-center">
                {isInCall ? (
                  <span className="text-[10px] font-mono text-blue-400">
                    PTT disabled during private call
                  </span>
                ) : !micSupported ? (
                  <span className="text-[10px] font-mono text-rmpg-500">
                    HTTPS required for microphone — listening only
                  </span>
                ) : isTransmitting ? (
                  <span className="text-[10px] font-mono text-red-400 animate-pulse">
                    TRANSMITTING — Release to stop
                  </span>
                ) : otherSpeaking ? (
                  <span className="text-[10px] font-mono text-yellow-500">
                    {activeSpeaker?.fullName || activeSpeaker?.username || 'Unknown'} is speaking
                  </span>
                ) : (
                  <span className="text-[10px] font-mono text-rmpg-500">
                    {isMobile ? 'Hold PTT button or press hardware key' : 'Hold PTT or SPACE to talk'}
                  </span>
                )}
              </div>

              {/* Error display */}
              {error && (
                <div className="flex items-center gap-2 mt-3 px-3 py-2 text-xs font-mono text-red-400 border border-red-900 bg-red-950/30 max-w-sm">
                  <AlertCircle style={{ width: 14, height: 14, flexShrink: 0 }} />
                  <span className="break-words">{error}</span>
                </div>
              )}

              {/* Floating sidebar toggle on mobile */}
              {isMobile && currentChannel && (
                <button
                  onClick={() => setShowMobileSidebar(true)}
                  className="absolute bottom-4 right-4 flex items-center gap-1 px-3 py-2 text-[10px] font-mono font-bold z-30"
                  style={{
                    background: 'rgba(26, 90, 158, 0.3)',
                    border: '1px solid #1a5a9e',
                    color: '#4a9ede',
                  }}
                >
                  <Users style={{ width: 12, height: 12 }} />
                  {channelUsers.length}
                </button>
              )}
            </div>

            {/* ── Right Sidebar: Users + Log ──────────────── */}
            {isMobile ? (
              showMobileSidebar ? (
                <div
                  className="absolute inset-0 z-40 flex flex-col"
                  style={{ background: '#0d1520' }}
                >
                  <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid #1e3048' }}>
                    <span className="text-[10px] font-mono font-bold text-rmpg-400 tracking-wider">CHANNEL INFO</span>
                    <button
                      onClick={() => setShowMobileSidebar(false)}
                      className="text-[10px] font-mono text-rmpg-400 hover:text-white px-2 py-1"
                      style={{ border: '1px solid #2a3e58' }}
                    >
                      CLOSE
                    </button>
                  </div>
                  {renderSidebarContent()}
                </div>
              ) : null
            ) : (
              <div
                className="flex flex-col w-72 border-l border-rmpg-700"
                style={{ background: '#0d1520', flexShrink: 0 }}
              >
                {renderSidebarContent()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── CSS Animations ────────────────────────────────── */}
      <style>{`
        @keyframes radioWave {
          0% { height: 4px; }
          100% { height: 20px; }
        }
        @keyframes radioPulse {
          0% {
            transform: scale(1);
            opacity: 0.6;
          }
          100% {
            transform: scale(1.3);
            opacity: 0;
          }
        }
        @keyframes incomingCallPulse {
          0%, 100% { background: linear-gradient(90deg, rgba(34, 197, 94, 0.2) 0%, rgba(34, 197, 94, 0.05) 100%); }
          50% { background: linear-gradient(90deg, rgba(34, 197, 94, 0.35) 0%, rgba(34, 197, 94, 0.15) 100%); }
        }
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}
