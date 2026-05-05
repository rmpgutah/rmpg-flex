import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Radio,
  Mic,
  MicOff,
  Users,
  Volume2,
  AlertCircle,
  WifiOff,
  ShieldAlert,
  Search,
  Download,
  Phone,
  PhoneOff,
  PhoneCall,
  PhoneIncoming,
  VolumeX,
  Play,
  Square,
  Antenna,
  Activity,
  ScanLine,
  LogOut,
} from 'lucide-react';
import { useRadio } from '../hooks/useRadio';
import { usePrivateCall } from '../hooks/usePrivateCall';
import { useAuth } from '../context/AuthContext';
import { apiFetch, apiFetchBlob } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { useToast } from '../components/ToastProvider';
import { localToday, safeTimeStr } from '../utils/dateUtils';

// ============================================================
// RMPG Flex — RadioPage (v2 redesign)
// Single-screen operator console: channels · PTT · comms log.
// No side tabs, no pop-open drawers — everything in-tab.
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
    panicAlert,
    joinChannel,
    leaveChannel,
    startTransmit,
    stopTransmit,
    startScan,
    stopScan,
    scanActive,
    incomingPage,
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
  const { addToast } = useToast();
  const pttRef = useRef<HTMLButtonElement>(null);
  const spaceHeldRef = useRef(false);

  // ─── Keyboard PTT (Space bar) ──────────────────────────────
  useEffect(() => {
    if (!currentChannel) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
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

  const channelInfo = RADIO_CHANNELS.find(c => c.id === currentChannel);
  const otherSpeaking = activeSpeaker && activeSpeaker.userId !== Number(user?.id);

  // ─── Comms Log (history) ─────────────────────────────────
  const [historyEntries, setHistoryEntries] = useState<any[]>([]);
  const [historySearch, setHistorySearch] = useState('');
  const [historyChannel, setHistoryChannel] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);

  // ─── Audio Playback (Web Audio API — see prior notes for Safari/Opus) ───
  const [playingId, setPlayingId] = useState<string | number | null>(null);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playbackStartCtxTimeRef = useRef(0);
  const playbackOffsetRef = useRef(0);
  const playbackBufferRef = useRef<AudioBuffer | null>(null);
  const playbackTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPlaybackInternal = useCallback(() => {
    if (audioSourceRef.current) {
      try { audioSourceRef.current.stop(); } catch { /* ok */ }
      try { audioSourceRef.current.disconnect(); } catch { /* ok */ }
      audioSourceRef.current = null;
    }
    if (playbackTimerRef.current) {
      clearInterval(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
    setPlayingId(null);
    setPlaybackTime(0);
    setPlaybackDuration(0);
    playbackOffsetRef.current = 0;
    playbackBufferRef.current = null;
  }, []);

  const togglePlayback = useCallback(async (entry: any) => {
    const entryId = entry?.id ?? entry;
    if (playingId === entryId) {
      stopPlaybackInternal();
      return;
    }
    stopPlaybackInternal();
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
    try {
      const rawBlob = await apiFetchBlob(`/comms/radio/audio/${entryId}`);
      const arrayBuffer = await rawBlob.arrayBuffer();
      const ctx = audioCtxRef.current!;
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      const serverDur = typeof entry?.duration === 'number' && entry.duration > 0
        ? entry.duration : audioBuffer.duration;
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      audioSourceRef.current = source;
      playbackBufferRef.current = audioBuffer;
      playbackOffsetRef.current = 0;
      playbackStartCtxTimeRef.current = ctx.currentTime;
      source.onended = () => {
        if (audioSourceRef.current === source) stopPlaybackInternal();
      };
      source.start(0);
      setPlaybackTime(0);
      setPlaybackDuration(audioBuffer.duration || serverDur);
      setPlayingId(entryId);
      playbackTimerRef.current = setInterval(() => {
        const elapsed = (ctx.currentTime - playbackStartCtxTimeRef.current) + playbackOffsetRef.current;
        setPlaybackTime(Math.min(elapsed, audioBuffer.duration));
      }, 100);
    } catch (err: any) {
      console.error('[Radio Playback] Failed:', err);
      const name = err?.name || 'Error';
      const msg = err?.message || String(err);
      addToast(`Playback failed: ${name} — ${msg.slice(0, 100)}`, 'error');
      stopPlaybackInternal();
    }
  }, [playingId, addToast, stopPlaybackInternal]);

  const seekPlayback = useCallback((seconds: number) => {
    const ctx = audioCtxRef.current;
    const buffer = playbackBufferRef.current;
    if (!ctx || !buffer) return;
    const clamped = Math.max(0, Math.min(seconds, buffer.duration));
    if (audioSourceRef.current) {
      const old = audioSourceRef.current;
      old.onended = null;
      try { old.stop(); } catch { /* ok */ }
      try { old.disconnect(); } catch { /* ok */ }
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => {
      if (audioSourceRef.current === source) stopPlaybackInternal();
    };
    source.start(0, clamped);
    audioSourceRef.current = source;
    playbackOffsetRef.current = clamped;
    playbackStartCtxTimeRef.current = ctx.currentTime;
    setPlaybackTime(clamped);
  }, [stopPlaybackInternal]);

  const downloadRecording = useCallback(async (entry: any) => {
    try {
      const rawBlob = await apiFetchBlob(`/comms/radio/audio/${entry.id}`);
      const blob = rawBlob.type.startsWith('audio/') ? rawBlob : new Blob([rawBlob], { type: 'audio/webm' });
      const url = URL.createObjectURL(blob);
      const ts = (entry.transmitted_at || '').replace(/[:\s]/g, '-');
      const who = (entry.username || 'unit').replace(/[^a-z0-9_-]/gi, '');
      const chan = (entry.channel || 'radio').replace(/[^a-z0-9_-]/gi, '');
      const a = document.createElement('a');
      a.href = url;
      a.download = `radio-${chan}-${who}-${ts}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      addToast('Failed to download recording', 'error');
    }
  }, [addToast]);

  useEffect(() => {
    return () => {
      if (audioSourceRef.current) {
        try { audioSourceRef.current.stop(); } catch { /* ok */ }
        try { audioSourceRef.current.disconnect(); } catch { /* ok */ }
        audioSourceRef.current = null;
      }
      if (playbackTimerRef.current) {
        clearInterval(playbackTimerRef.current);
        playbackTimerRef.current = null;
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
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
  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const exportHistoryCsv = () => {
    if (historyEntries.length === 0) return;
    const header = 'Timestamp,Channel,User,Duration(s),Transcript,Has Audio\n';
    const rows = historyEntries.map(e =>
      `"${e.transmitted_at}","${e.channel}","${e.full_name || e.username || ''}","${e.duration || ''}","${(e.transcript || '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}","${e.audio_file ? 'Yes' : 'No'}"`
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
    if (!ts || ts < 1000000000000) return '--:--:--';
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  const formatDuration = (sec: number) => {
    if (!sec || sec < 0 || sec > 3600) return '';
    if (sec < 60) return `${sec}s`;
    return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  };
  const formatCallDuration = (sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  useEffect(() => { document.title = 'Radio Communications — RMPG Flex'; }, []);

  // ────────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col" style={{ background: '#0a0a0a' }}>

      {/* ─── Banner stack (always above grid) ─── */}
      {!micSupported && (
        <div className="flex items-center gap-3 px-4 py-2" style={{ background: 'rgba(220, 38, 38, 0.15)', borderBottom: '1px solid #991b1b' }}>
          <ShieldAlert style={{ width: 16, height: 16, color: '#ef4444', flexShrink: 0 }} />
          <div className="text-[10px] font-mono">
            <span className="font-bold text-red-400">SECURE CONNECTION REQUIRED</span>
            <span className="text-rmpg-400 ml-2">Microphone access requires HTTPS — listening only.</span>
          </div>
        </div>
      )}

      {panicAlert && (
        <div className="flex items-center gap-3 px-4 py-2 animate-pulse" style={{ background: 'rgba(239, 68, 68, 0.25)', borderBottom: '2px solid #ef4444' }}>
          <AlertCircle style={{ width: 18, height: 18, color: '#ef4444', flexShrink: 0 }} />
          <div className="flex-1">
            <div className="text-[11px] font-mono font-bold text-red-400 tracking-wider">
              ⚠ EMERGENCY BROADCAST — {panicAlert.user_name}
              {panicAlert.badge_number ? ` (${panicAlert.badge_number})` : ''}
              {panicAlert.unit_call_sign ? ` — ${panicAlert.unit_call_sign}` : ''}
            </div>
            {panicAlert.location_address && (
              <div className="text-[10px] font-mono text-red-300 mt-0.5">{panicAlert.location_address}</div>
            )}
          </div>
          <span className="text-[9px] font-mono text-red-400 uppercase tracking-widest">LIVE</span>
        </div>
      )}

      {incomingPage && (
        <div className="flex items-center gap-3 px-4 py-2" style={{ background: 'rgba(136,136,136,0.15)', borderBottom: '1px solid #888888' }}>
          <Radio style={{ width: 14, height: 14, color: '#aaa', flexShrink: 0 }} />
          <div className="flex-1 text-[10px] font-mono">
            <span className="font-bold text-gray-300">PAGE FROM {incomingPage.from_full_name || incomingPage.from_username}</span>
            {incomingPage.from_call_sign ? <span className="text-gray-400"> ({incomingPage.from_call_sign})</span> : null}
            {incomingPage.message && <span className="text-gray-500 ml-2">— {incomingPage.message}</span>}
          </div>
          <button type="button" onClick={dismissPage} className="text-[9px] font-mono text-gray-400 hover:text-white px-2 py-0.5" style={{ border: '1px solid #88888880' }}>
            DISMISS
          </button>
        </div>
      )}

      {(isInCall && activeCall) && (
        <div className="flex items-center gap-3 px-4 py-2" style={{ background: 'linear-gradient(90deg, rgba(136,136,136,0.2), rgba(136,136,136,0.05))', borderBottom: '2px solid #888888' }}>
          <PhoneCall style={{ width: 14, height: 14, color: '#888' }} />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-mono font-bold text-gray-200 truncate">PRIVATE CALL — {activeCall.partnerName}</div>
            <div className="text-[10px] font-mono text-gray-400/70">
              {formatCallDuration(callDuration)}{callMuted && ' — MUTED'}
            </div>
          </div>
          <button type="button" onClick={toggleMute} className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono font-bold" style={{ border: `1px solid ${callMuted ? '#ef4444' : '#2e2e2e'}`, color: callMuted ? '#ef4444' : '#888', background: callMuted ? 'rgba(239,68,68,0.1)' : 'transparent' }}>
            {callMuted ? <VolumeX style={{ width: 11, height: 11 }} /> : <Mic style={{ width: 11, height: 11 }} />}
            {callMuted ? 'UNMUTE' : 'MUTE'}
          </button>
          <button type="button" onClick={endCall} className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono font-bold text-red-400" style={{ border: '1px solid #ef4444', background: 'rgba(239,68,68,0.1)' }}>
            <PhoneOff style={{ width: 11, height: 11 }} /> END
          </button>
        </div>
      )}

      {isRinging && ringingTarget && (
        <div className="flex items-center gap-3 px-4 py-2" style={{ background: 'rgba(136,136,136,0.1)', borderBottom: '1px solid #88888880' }}>
          <Phone style={{ width: 12, height: 12, color: '#aaa', animation: 'radioPulse 1.5s ease infinite' }} />
          <span className="text-[11px] font-mono text-gray-300 flex-1">Calling <strong>{ringingTarget.name}</strong>…</span>
          <button type="button" onClick={endCall} className="text-[10px] font-mono text-red-400 px-2 py-0.5" style={{ border: '1px solid #ef4444' }}>CANCEL</button>
        </div>
      )}

      {incomingCall && (
        <div className="flex items-center gap-3 px-4 py-3" style={{ background: 'rgba(34,197,94,0.18)', borderBottom: '2px solid #22c55e', animation: 'incomingCallPulse 2s ease-in-out infinite' }}>
          <PhoneIncoming style={{ width: 18, height: 18, color: '#22c55e' }} />
          <div className="flex-1">
            <div className="text-[10px] font-mono font-bold text-green-300 tracking-wider">INCOMING CALL</div>
            <div className="text-sm font-mono font-bold text-white">{incomingCall.callerName}</div>
          </div>
          <button type="button" onClick={() => acceptCall(incomingCall.callId)} className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-mono font-bold text-white" style={{ background: '#22c55e', border: '1px solid #16a34a' }}>
            <Phone style={{ width: 12, height: 12 }} /> ACCEPT
          </button>
          <button type="button" onClick={() => declineCall(incomingCall.callId)} className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-mono font-bold text-white" style={{ background: '#ef4444', border: '1px solid #dc2626' }}>
            <PhoneOff style={{ width: 12, height: 12 }} /> DECLINE
          </button>
        </div>
      )}

      {callError && (
        <div className="flex items-center gap-2 px-4 py-1.5 text-[10px] font-mono text-amber-400" style={{ background: 'rgba(245,158,11,0.08)', borderBottom: '1px solid #78350f' }}>
          <AlertCircle style={{ width: 12, height: 12 }} /> {callError}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════ */}
      {/*  HEADER STRIP — connection state + active channel info  */}
      {/* ═══════════════════════════════════════════════════════ */}
      <div
        className="flex items-center justify-between px-4 py-2 flex-shrink-0"
        style={{
          background: 'linear-gradient(180deg, #1a1a1a 0%, #111 100%)',
          borderBottom: '1px solid #2b2b2b',
        }}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Antenna style={{ width: 14, height: 14, color: '#d4a017' }} />
            <span className="text-[11px] font-mono font-bold tracking-[0.2em] text-white">RMPG RADIO</span>
          </div>
          <span className="text-[10px] font-mono" style={{ color: '#444' }}>│</span>
          <div className="flex items-center gap-1.5">
            <span className="led-dot" style={{ background: isConnected ? '#22c55e' : '#ef4444', boxShadow: `0 0 4px ${isConnected ? '#22c55e' : '#ef4444'}` }} />
            <span className="text-[10px] font-mono tracking-wider" style={{ color: isConnected ? '#22c55e' : '#ef4444' }}>
              {isConnected ? 'CONNECTED' : 'OFFLINE'}
            </span>
          </div>
          {currentChannel && channelInfo && (
            <>
              <span className="text-[10px] font-mono" style={{ color: '#444' }}>│</span>
              <span className="text-[10px] font-mono text-rmpg-500">CH</span>
              <span className="text-[11px] font-mono font-bold text-white tracking-wider">{channelInfo.label}</span>
              <span className="text-[10px] font-mono" style={{ color: '#666' }}>{channelInfo.freq} MHz</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {currentChannel && (
            <>
              <button
                type="button"
                onClick={() => {
                  if (scanActive) stopScan();
                  else startScan(RADIO_CHANNELS.filter(c => c.id !== currentChannel).map(c => c.id));
                }}
                className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono font-bold tracking-wider transition-colors"
                style={{
                  border: `1px solid ${scanActive ? '#22c55e' : '#2e2e2e'}`,
                  color: scanActive ? '#22c55e' : '#888',
                  background: scanActive ? 'rgba(34,197,94,0.1)' : 'transparent',
                }}
              >
                <ScanLine style={{ width: 11, height: 11 }} />
                {scanActive ? 'SCAN ON' : 'SCAN'}
              </button>
              <button
                type="button"
                onClick={leaveChannel}
                className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono font-bold tracking-wider text-rmpg-400 hover:text-red-400 transition-colors"
                style={{ border: '1px solid #2a2a2a' }}
              >
                <LogOut style={{ width: 11, height: 11 }} />
                LEAVE
              </button>
            </>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════ */}
      {/*  3-COLUMN GRID (stacks on mobile)                       */}
      {/* ═══════════════════════════════════════════════════════ */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-[220px_1fr_380px] overflow-hidden">

        {/* ── LEFT: Channels + On-Channel Users ─────────────── */}
        <aside
          className="flex flex-col overflow-hidden"
          style={{ background: '#0d0d0d', borderRight: '1px solid #1f1f1f' }}
        >
          {/* CHANNELS */}
          <div className="flex-shrink-0">
            <SectionHeader icon={<Radio style={{ width: 11, height: 11, color: '#d4a017' }} />} label={`CHANNELS · ${RADIO_CHANNELS.length}`} />
            <div className="px-1.5 py-1.5 space-y-0.5 overflow-y-auto" style={{ maxHeight: '50vh' }}>
              {RADIO_CHANNELS.map((ch) => {
                const isActive = ch.id === currentChannel;
                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => joinChannel(ch.id)}
                    disabled={!isConnected}
                    className="w-full flex items-center gap-2 px-2 py-1.5 transition-colors text-left"
                    style={{
                      background: isActive ? 'linear-gradient(90deg, rgba(212,160,23,0.18), transparent)' : 'transparent',
                      borderLeft: isActive ? '2px solid #d4a017' : '2px solid transparent',
                      opacity: isConnected ? 1 : 0.4,
                      cursor: isConnected ? 'pointer' : 'not-allowed',
                    }}
                    onMouseEnter={(e) => { if (!isActive && isConnected) e.currentTarget.style.background = '#161616'; }}
                    onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span className="led-dot" style={{
                      background: isActive ? '#22c55e' : '#333',
                      boxShadow: isActive ? '0 0 4px #22c55e' : 'none',
                    }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-mono font-bold tracking-wider" style={{ color: isActive ? '#fff' : '#999' }}>
                        {ch.label}
                      </div>
                      <div className="text-[9px] font-mono" style={{ color: isActive ? '#d4a01799' : '#555' }}>
                        {ch.freq} MHz
                      </div>
                    </div>
                    {isActive && (
                      <span className="text-[8px] font-mono font-bold tracking-widest" style={{ color: '#d4a017' }}>ACTIVE</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ON CHANNEL */}
          <div className="flex-1 flex flex-col overflow-hidden border-t" style={{ borderColor: '#1f1f1f' }}>
            <SectionHeader
              icon={<Users style={{ width: 11, height: 11, color: '#d4a017' }} />}
              label={`ON CHANNEL · ${channelUsers.length}`}
            />
            <div className="flex-1 overflow-y-auto px-1.5 py-1.5">
              {!currentChannel ? (
                <div className="px-2 text-[10px] font-mono italic text-rmpg-600">No channel joined</div>
              ) : channelUsers.length === 0 ? (
                <div className="px-2 text-[10px] font-mono italic text-rmpg-600">Waiting for units…</div>
              ) : (
                channelUsers.map((u) => {
                  const isMe = u.userId === Number(user?.id);
                  const isSpeaking = activeSpeaker?.userId === u.userId;
                  return (
                    <div key={u.userId} className="group flex items-center gap-2 px-2 py-1 hover:bg-[#161616]">
                      <span className="led-dot" style={{
                        background: isSpeaking ? '#ef4444' : '#22c55e',
                        boxShadow: `0 0 4px ${isSpeaking ? '#ef4444' : '#22c55e'}`,
                      }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-mono text-white truncate">
                          {u.fullName || u.username || 'Unknown'}
                          {isMe && <span className="text-[8px] font-mono text-[#d4a017] ml-1">YOU</span>}
                        </div>
                        {u.role && (
                          <div className="text-[8px] font-mono uppercase tracking-wider text-rmpg-600">{u.role}</div>
                        )}
                      </div>
                      {!isMe && !isInCall && (
                        <button
                          type="button"
                          onClick={() => startCall(u.userId)}
                          aria-label={`Call ${u.fullName || u.username}`}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-rmpg-400 hover:text-[#d4a017]"
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
        </aside>

        {/* ── CENTER: Console (frequency · speaker · PTT) ──── */}
        <main className="flex flex-col overflow-y-auto" style={{ background: 'radial-gradient(ellipse at center top, #131313 0%, #0a0a0a 60%)' }}>
          {!currentChannel ? (
            <EmptyConsole isConnected={isConnected} />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center px-6 py-8 gap-6 min-h-full">

              {/* CRT FREQUENCY DISPLAY */}
              <div
                className="w-full max-w-md p-5 text-center relative"
                style={{
                  background: 'linear-gradient(180deg, #050a05 0%, #020602 100%)',
                  border: '2px solid #1a2a1a',
                  boxShadow: 'inset 0 2px 12px rgba(0,0,0,0.7), 0 0 30px rgba(51,255,51,0.04)',
                }}
              >
                <div className="absolute top-1.5 left-2 text-[8px] font-mono tracking-[0.3em]" style={{ color: '#1a5a1a' }}>
                  ◉ ON AIR
                </div>
                <div className="absolute top-1.5 right-2 text-[8px] font-mono tracking-[0.3em]" style={{ color: '#1a5a1a' }}>
                  CH-{(RADIO_CHANNELS.findIndex(c => c.id === currentChannel) + 1).toString().padStart(2, '0')}
                </div>
                <div className="text-[9px] font-mono tracking-[0.4em] mt-1" style={{ color: '#1a5a1a' }}>
                  CHANNEL
                </div>
                <div
                  className="text-4xl font-bold font-mono tracking-[0.15em] mt-1"
                  style={{ color: '#33ff33', textShadow: '0 0 12px rgba(51, 255, 51, 0.5)' }}
                >
                  {channelInfo?.label || currentChannel.toUpperCase()}
                </div>
                <div
                  className="text-base font-mono mt-2 tracking-widest"
                  style={{ color: '#33ff33', opacity: 0.55 }}
                >
                  {channelInfo?.freq || '---'} MHz
                </div>

                {/* Status line below frequency */}
                <div className="mt-3 pt-2 border-t border-[#0c1c0c] text-[9px] font-mono tracking-[0.3em]" style={{ color: activeSpeaker ? '#ef4444' : '#1a5a1a' }}>
                  {activeSpeaker ? '── TRAFFIC ──' : '── CHANNEL CLEAR ──'}
                </div>
              </div>

              {/* ACTIVE SPEAKER */}
              <div className="w-full max-w-md min-h-[56px] flex items-center justify-center">
                {activeSpeaker ? (
                  <div className="flex items-center justify-center gap-4 w-full px-3 py-2" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.4)' }}>
                    <Waveform color="#ef4444" />
                    <div className="text-center">
                      <div className="text-sm font-bold font-mono text-red-400 tracking-wider">
                        {activeSpeaker.fullName || activeSpeaker.username || 'Unknown'}
                      </div>
                      <div className="text-[9px] font-mono text-red-400/70 tracking-[0.3em]">TRANSMITTING</div>
                    </div>
                    <Waveform color="#ef4444" reverse />
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-[10px] font-mono tracking-[0.3em] text-rmpg-600">
                    <Activity style={{ width: 11, height: 11 }} />
                    STANDBY · NO TRAFFIC
                  </div>
                )}
              </div>

              {/* PTT BUTTON */}
              <button
                type="button"
                ref={pttRef}
                onMouseDown={() => startTransmit()}
                onMouseUp={() => stopTransmit()}
                onMouseLeave={() => { if (isTransmitting) stopTransmit(); }}
                onTouchStart={(e) => { e.preventDefault(); startTransmit(); }}
                onTouchEnd={(e) => { e.preventDefault(); stopTransmit(); }}
                disabled={!isConnected || !micSupported || (channelBusy && !isTransmitting) || isInCall}
                aria-label="Push to talk"
                className="relative flex items-center justify-center select-none"
                style={{
                  width: 200,
                  height: 200,
                  borderRadius: '50%',
                  background: isInCall
                    ? 'radial-gradient(circle at 30% 30%, #2b2b2b 0%, #141414 60%, #0c0c0c 100%)'
                    : !micSupported
                      ? 'radial-gradient(circle at 30% 30%, #2a2a2a 0%, #181818 60%, #0c0c0c 100%)'
                      : isTransmitting
                        ? 'radial-gradient(circle at 30% 30%, #ff5050 0%, #c41e1e 50%, #5a0a0a 100%)'
                        : otherSpeaking
                          ? 'radial-gradient(circle at 30% 30%, #d4a017 0%, #8a6810 60%, #3a2c06 100%)'
                          : 'radial-gradient(circle at 30% 30%, #33aa33 0%, #1e7a1e 50%, #0a3a0a 100%)',
                  border: isInCall
                    ? '5px solid #88888880'
                    : !micSupported
                      ? '5px solid #2a2a2a'
                      : isTransmitting
                        ? '5px solid #ff6060'
                        : otherSpeaking
                          ? '5px solid #d4a017'
                          : '5px solid #2a8a2a',
                  boxShadow: isTransmitting
                    ? '0 0 40px rgba(255, 64, 64, 0.6), inset 0 4px 12px rgba(0,0,0,0.5), inset 0 -2px 8px rgba(255,255,255,0.1)'
                    : otherSpeaking
                      ? '0 0 28px rgba(212, 160, 23, 0.4), inset 0 4px 12px rgba(0,0,0,0.5)'
                      : '0 0 24px rgba(34, 170, 34, 0.35), inset 0 4px 12px rgba(0,0,0,0.5), inset 0 -2px 8px rgba(255,255,255,0.08)',
                  cursor: (!isConnected || !micSupported || (channelBusy && !isTransmitting) || isInCall) ? 'not-allowed' : 'pointer',
                  opacity: (!isConnected || !micSupported || isInCall) ? 0.4 : 1,
                  transition: 'all 0.12s ease',
                  touchAction: 'none',
                  transform: isTransmitting ? 'scale(0.97)' : 'scale(1)',
                }}
              >
                {isTransmitting && (
                  <div
                    className="absolute inset-[-12px] rounded-full pointer-events-none"
                    style={{ border: '2px solid rgba(255, 64, 64, 0.5)', animation: 'radioPulse 1.2s ease-out infinite' }}
                  />
                )}
                <div className="flex flex-col items-center gap-1">
                  {isInCall ? (
                    <PhoneCall style={{ width: 36, height: 36, color: '#aaa' }} />
                  ) : !micSupported ? (
                    <MicOff style={{ width: 36, height: 36, color: '#666' }} />
                  ) : isTransmitting ? (
                    <Mic style={{ width: 36, height: 36, color: '#fff' }} />
                  ) : otherSpeaking ? (
                    <Volume2 style={{ width: 36, height: 36, color: '#fff' }} />
                  ) : (
                    <Mic style={{ width: 36, height: 36, color: '#eaffea' }} />
                  )}
                  <span className="text-[11px] font-mono font-black tracking-[0.3em]" style={{ color: '#fff' }}>
                    {isInCall ? 'IN CALL' : !micSupported ? 'NO MIC' : isTransmitting ? 'TX' : otherSpeaking ? 'RX' : 'PTT'}
                  </span>
                </div>
              </button>

              {/* HINT */}
              <div className="text-center min-h-[18px]">
                {isInCall ? (
                  <span className="text-[10px] font-mono text-gray-400 tracking-wider">PTT DISABLED — PRIVATE CALL ACTIVE</span>
                ) : !micSupported ? (
                  <span className="text-[10px] font-mono text-rmpg-500 tracking-wider">HTTPS REQUIRED — LISTENING ONLY</span>
                ) : isTransmitting ? (
                  <span className="text-[10px] font-mono text-red-400 tracking-wider animate-pulse">▮ TRANSMITTING — RELEASE TO STOP</span>
                ) : otherSpeaking ? (
                  <span className="text-[10px] font-mono text-[#d4a017] tracking-wider">
                    {activeSpeaker?.fullName || activeSpeaker?.username || 'Unknown'} HAS THE FLOOR
                  </span>
                ) : (
                  <span className="text-[10px] font-mono text-rmpg-500 tracking-wider">
                    HOLD <kbd className="px-1.5 py-0.5 mx-1 text-white" style={{ background: '#1a1a1a', border: '1px solid #333' }}>SPACE</kbd> OR PTT TO TALK
                  </span>
                )}
              </div>

              {error && (
                <div className="flex items-center gap-2 px-3 py-2 text-xs font-mono text-red-400 max-w-md" style={{ border: '1px solid #7f1d1d', background: 'rgba(127,29,29,0.2)' }}>
                  <AlertCircle style={{ width: 14, height: 14, flexShrink: 0 }} />
                  <span className="break-words">{error}</span>
                </div>
              )}
            </div>
          )}
        </main>

        {/* ── RIGHT: Comms Log (LIVE + HISTORY, both visible) ── */}
        <aside
          className="flex flex-col overflow-hidden"
          style={{ background: '#0d0d0d', borderLeft: '1px solid #1f1f1f' }}
        >
          {/* Search + filter bar */}
          <div className="flex-shrink-0 px-2 py-2 flex items-center gap-1.5" style={{ background: 'linear-gradient(180deg, #181818, #141414)', borderBottom: '1px solid #1f1f1f' }}>
            <Search style={{ width: 11, height: 11, color: '#666' }} />
            <input
              type="text"
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              placeholder="Search transcripts…"
              aria-label="Search transcripts"
              className="flex-1 bg-transparent text-[10px] text-white font-mono focus:outline-none placeholder:text-rmpg-600 min-w-0"
            />
            <select
              value={historyChannel}
              onChange={(e) => setHistoryChannel(e.target.value)}
              aria-label="Filter by channel"
              className="bg-[#0a0a0a] text-[9px] text-rmpg-300 font-mono px-1 py-0.5"
              style={{ border: '1px solid #2a2a2a' }}
            >
              <option value="">ALL</option>
              {RADIO_CHANNELS.map(ch => (
                <option key={ch.id} value={ch.id}>{ch.label}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={exportHistoryCsv}
              disabled={historyEntries.length === 0}
              aria-label="Export CSV"
              title="Export CSV"
              className="p-1 text-rmpg-400 hover:text-[#d4a017] disabled:opacity-30"
            >
              <Download style={{ width: 11, height: 11 }} />
            </button>
          </div>

          {/* LIVE feed (in-memory transmissions) */}
          <div className="flex-shrink-0" style={{ borderBottom: '1px solid #1f1f1f' }}>
            <SectionHeader
              icon={<span className="led-dot" style={{ background: '#ef4444', boxShadow: '0 0 4px #ef4444' }} />}
              label={`LIVE · ${transmissionLog.length}`}
            />
            <div className="px-2 py-1 max-h-[28vh] overflow-y-auto">
              {transmissionLog.length === 0 ? (
                <div className="px-1 py-1 text-[10px] font-mono italic text-rmpg-600">No live traffic</div>
              ) : (
                transmissionLog.slice().reverse().map((entry) => (
                  <div key={entry.id} className="flex items-start gap-2 py-1 border-b" style={{ borderColor: '#171717' }}>
                    <span className="text-[9px] font-mono text-rmpg-600 tabular-nums flex-shrink-0 mt-px">
                      {formatLogTime(entry.startedAt)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] font-mono text-rmpg-200 truncate">
                          {entry.fullName || entry.username || 'Unknown'}
                        </span>
                        <span className="text-[8px] font-mono font-bold tracking-wider px-1" style={{ background: '#1a1a1a', color: '#d4a017' }}>
                          {(entry.channel || '').toUpperCase()}
                        </span>
                      </div>
                      {entry.transcript && (
                        <div className="text-[10px] font-mono text-rmpg-400 italic mt-0.5 leading-snug">
                          "{entry.transcript}"
                        </div>
                      )}
                    </div>
                    {entry.hasAudio && (
                      <Volume2 size={10} className="text-green-600 flex-shrink-0 mt-px" />
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* HISTORY (persistent transcripts) */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <SectionHeader
              icon={<Activity style={{ width: 11, height: 11, color: '#d4a017' }} />}
              label={`HISTORY · ${historyEntries.length}`}
            />
            <div className="flex-1 overflow-y-auto px-2 py-1">
              {historyLoading ? (
                <div className="px-1 py-2 text-[10px] font-mono italic text-rmpg-600">Loading transcripts…</div>
              ) : historyEntries.length === 0 ? (
                <div className="px-1 py-2 text-[10px] font-mono italic text-rmpg-600">No archived transmissions</div>
              ) : (
                historyEntries.map((entry) => (
                  <div key={entry.id} className="py-1.5 border-b" style={{ borderColor: '#171717' }}>
                    <div className="flex items-start gap-2">
                      <span className="text-[9px] font-mono text-rmpg-600 tabular-nums flex-shrink-0 mt-px">
                        {safeTimeStr(entry.transmitted_at)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="text-[10px] font-mono text-rmpg-200 truncate">
                            {entry.full_name || entry.username || 'Unknown'}
                          </span>
                          <span className="text-[8px] font-mono font-bold tracking-wider px-1" style={{ background: '#1a1a1a', color: '#d4a017' }}>
                            {(entry.channel || '').toUpperCase()}
                          </span>
                          {entry.duration > 0 && (
                            <span className="text-[8px] font-mono text-rmpg-600">{formatDuration(entry.duration)}</span>
                          )}
                        </div>
                        {entry.transcript && (
                          <div className="text-[10px] font-mono text-rmpg-400 italic mt-0.5 leading-snug">
                            "{entry.transcript}"
                          </div>
                        )}
                      </div>
                      {entry.audio_file && (
                        <div className="flex items-center gap-0.5 flex-shrink-0 mt-px">
                          <button
                            type="button"
                            onClick={() => togglePlayback(entry)}
                            className="p-1 hover:bg-[#1a1a1a] transition-colors"
                            title={playingId === entry.id ? 'Stop playback' : 'Play recording'}
                            aria-label={playingId === entry.id ? 'Stop playback' : 'Play recording'}
                          >
                            {playingId === entry.id ? (
                              <Square size={11} className="text-red-400" />
                            ) : (
                              <Play size={11} className="text-green-400" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => downloadRecording(entry)}
                            className="p-1 hover:bg-[#1a1a1a] transition-colors"
                            title="Download recording"
                            aria-label={`Download recording from ${entry.full_name || entry.username || 'unit'}`}
                          >
                            <Download size={11} className="text-rmpg-500" />
                          </button>
                        </div>
                      )}
                    </div>
                    {playingId === entry.id && playbackDuration > 0 && (
                      <div className="flex items-center gap-2 mt-1.5 pl-[52px] pr-1">
                        <span className="text-[9px] font-mono text-rmpg-500 tabular-nums w-[34px] text-right">
                          {formatDuration(Math.floor(playbackTime))}
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={playbackDuration}
                          step={0.1}
                          value={playbackTime}
                          onChange={(e) => seekPlayback(Number(e.target.value))}
                          aria-label="Seek within recording"
                          className="flex-1 h-[3px] accent-[#d4a017] bg-[#222] cursor-pointer"
                        />
                        <span className="text-[9px] font-mono text-rmpg-500 tabular-nums w-[34px]">
                          {formatDuration(Math.floor(playbackDuration))}
                        </span>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* ─── CSS ─────────────────────────────────────────────── */}
      <style>{`
        @keyframes radioWave {
          0% { height: 4px; }
          100% { height: 22px; }
        }
        @keyframes radioPulse {
          0% { transform: scale(1); opacity: 0.6; }
          100% { transform: scale(1.35); opacity: 0; }
        }
        @keyframes incomingCallPulse {
          0%, 100% { background: rgba(34, 197, 94, 0.18); }
          50% { background: rgba(34, 197, 94, 0.32); }
        }
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Sub-components (file-local; no separate exports)
// ════════════════════════════════════════════════════════════

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div
      className="flex items-center gap-1.5 px-3 py-1.5 flex-shrink-0"
      style={{
        background: 'linear-gradient(180deg, #1a1a1a 0%, #141414 100%)',
        borderBottom: '1px solid #1f1f1f',
      }}
    >
      {icon}
      <span className="text-[9px] font-mono font-bold tracking-[0.2em] text-rmpg-300">
        {label}
      </span>
    </div>
  );
}

function Waveform({ color, reverse = false }: { color: string; reverse?: boolean }) {
  const bars = reverse ? [4, 3, 2, 1, 0] : [0, 1, 2, 3, 4];
  return (
    <div className="flex items-end gap-0.5 h-6">
      {bars.map(i => (
        <div
          key={i}
          className="w-1"
          style={{
            background: color,
            animation: `radioWave 0.6s ease-in-out ${i * 0.1}s infinite alternate`,
          }}
        />
      ))}
    </div>
  );
}

function EmptyConsole({ isConnected }: { isConnected: boolean }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 gap-4 text-center">
      <div
        className="w-24 h-24 rounded-full flex items-center justify-center"
        style={{
          background: 'radial-gradient(circle at 30% 30%, #1a1a1a 0%, #0a0a0a 70%)',
          border: '3px solid #1f1f1f',
          boxShadow: 'inset 0 4px 12px rgba(0,0,0,0.6)',
        }}
      >
        <Antenna style={{ width: 36, height: 36, color: '#333' }} />
      </div>
      <div>
        <div className="text-sm font-mono font-bold tracking-[0.3em] text-rmpg-300">
          NO CHANNEL JOINED
        </div>
        <div className="text-[10px] font-mono text-rmpg-600 mt-1 tracking-wider">
          Select a channel from the left to begin
        </div>
      </div>
      {!isConnected && (
        <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-mono text-red-400" style={{ border: '1px solid #7f1d1d', background: 'rgba(127,29,29,0.15)' }}>
          <WifiOff style={{ width: 12, height: 12 }} />
          DISCONNECTED — Radio service unavailable
        </div>
      )}
    </div>
  );
}
