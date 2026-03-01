import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Radio,
  Mic,
  MicOff,
  Users,
  Volume2,
  VolumeX,
  AlertCircle,
  AlertTriangle,
  WifiOff,
  ShieldAlert,
  History,
  Search,
  Download,
  Signal,
  Battery,
  Zap,
  Lock,
  Bell,
  PhoneCall,
  Hash,
} from 'lucide-react';
import { useRadio } from '../hooks/useRadio';
import { useAuth } from '../context/AuthContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { apiFetch } from '../hooks/useApi';
import { playDtmfTone } from '../utils/radioTones';
import RadioVuMeter from '../components/RadioVuMeter';

// ============================================================
// RMPG Flex — RadioPage
// Motorola APX-Style PTT Two-Way Radio
//
// Redesigned to mimic a real Motorola APX control head display
// with LCD channel readout, signal/battery indicators, LED
// status lights, and squelch-open audio effects.
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
    joinChannel,
    leaveChannel,
    startTransmit,
    stopTransmit,
    isConnected,
    radioChannels: RADIO_CHANNELS,
    // Volume / FX
    masterVolume,
    isMuted,
    fxEnabled,
    setMasterVolume,
    toggleMute,
    toggleFx,
    getAnalyser,
    // Signal strength
    signalLatency,
    signalBars,
    signalLabel,
    signalColor,
    // Emergency
    emergencyActive,
    emergencyUser,
    startEmergency,
    cancelEmergency,
    acknowledgeEmergency,
    // Radio Check
    sendRadioCheck,
    radioCheckResponses,
    // Selcall
    sendSelcall,
    acknowledgeSelcall,
    selcallAlert,
  } = useRadio();

  const { user } = useAuth();
  const isMobile = useIsMobile();
  const pttRef = useRef<HTMLButtonElement>(null);

  // Track whether space is held down (prevent key-repeat)
  const spaceHeldRef = useRef(false);

  // Signal strength now comes from real WebSocket latency measurement in useRadio()
  // (previously simulated with random fluctuation)

  // DTMF keypad visibility toggle
  const [showDtmf, setShowDtmf] = useState(false);

  // Emergency arm state (two-click activation)
  const [emergencyArmed, setEmergencyArmed] = useState(false);
  const emergencyArmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Radio check waiting state
  const [radioCheckWaiting, setRadioCheckWaiting] = useState(false);
  useEffect(() => {
    if (radioCheckResponses.length > 0) setRadioCheckWaiting(false);
  }, [radioCheckResponses]);

  // Analyser ref for VU meter
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  useEffect(() => {
    try {
      setAnalyserNode(getAnalyser());
    } catch { /* bus not ready yet */ }
  }, [getAnalyser]);

  // TX timer display
  const [txTimer, setTxTimer] = useState(0);
  const txTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (isTransmitting) {
      setTxTimer(0);
      txTimerRef.current = setInterval(() => setTxTimer(prev => prev + 1), 1000);
    } else {
      if (txTimerRef.current) {
        clearInterval(txTimerRef.current);
        txTimerRef.current = null;
      }
    }
    return () => { if (txTimerRef.current) clearInterval(txTimerRef.current); };
  }, [isTransmitting]);

  // ─── Keyboard PTT (Space bar) ──────────────────────────────
  useEffect(() => {
    if (!currentChannel) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.code === 'Space' && !spaceHeldRef.current) {
        e.preventDefault();
        spaceHeldRef.current = true;
        startTransmit();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && spaceHeldRef.current) {
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
  }, [currentChannel, startTransmit, stopTransmit]);

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

  useEffect(() => {
    if (showHistory) fetchHistory();
  }, [showHistory, fetchHistory]);

  const exportHistoryCsv = () => {
    if (historyEntries.length === 0) return;
    const header = 'Timestamp,Channel,User,Duration(s),Transcript\n';
    const rows = historyEntries.map(e =>
      `"${e.transmitted_at}","${e.channel}","${e.full_name || e.username || ''}","${e.duration_seconds || ''}","${(e.transcript || '').replace(/"/g, '""')}"`
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `radio-transcripts-${new Date().toISOString().split('T')[0]}.csv`;
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

  const formatTxTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const displayName = (entry: { fullName?: string; username?: string }) => {
    return entry.fullName || entry.username || 'Unknown';
  };

  // Current time display
  const [clockTime, setClockTime] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setClockTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="h-full flex flex-col" style={{ background: '#111111' }}>

      {/* ─── HTTPS Warning Banner ────────────────────────────── */}
      {!micSupported && (
        <div
          className="flex items-center gap-3 px-4 py-3"
          style={{
            background: 'rgba(188, 16, 16, 0.15)',
            borderBottom: '1px solid #6e0a0a',
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

      {/* ─── No-channel state: channel selector ─────────────── */}
      {!currentChannel && (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-lg">
            {/* APX-style header */}
            <div className="text-center mb-6">
              <div
                className="inline-flex items-center gap-2 px-6 py-3 mb-3"
                style={{
                  background: 'linear-gradient(180deg, #1a1a1a 0%, #0d0d0d 100%)',
                  border: '2px solid #2a2a2a',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.5), inset 0 1px 0 #333',
                }}
              >
                <Radio style={{ width: 20, height: 20, color: '#bc1010' }} />
                <span className="text-base font-bold font-mono tracking-[0.3em] text-white">
                  APX RADIO
                </span>
              </div>
              <p className="text-[10px] font-mono text-rmpg-500 tracking-wider">
                SELECT ZONE / CHANNEL
              </p>
              {!isConnected && (
                <div className="flex items-center justify-center gap-2 mt-2 text-red-400 text-xs font-mono">
                  <WifiOff style={{ width: 12, height: 12 }} />
                  DISCONNECTED
                </div>
              )}
            </div>

            {/* Channel grid — styled like APX zone selector */}
            <div className="grid grid-cols-2 gap-2">
              {RADIO_CHANNELS.map((ch, idx) => (
                <button
                  key={ch.id}
                  onClick={() => joinChannel(ch.id)}
                  disabled={!isConnected}
                  className="group relative flex flex-col items-center p-4 transition-all duration-100"
                  style={{
                    background: 'linear-gradient(180deg, #1e1e1e 0%, #151515 100%)',
                    border: '1px solid #303030',
                    opacity: isConnected ? 1 : 0.4,
                  }}
                  onMouseEnter={(e) => {
                    if (isConnected) {
                      e.currentTarget.style.borderColor = '#bc1010';
                      e.currentTarget.style.background = 'linear-gradient(180deg, #251515 0%, #1a1010 100%)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = '#303030';
                    e.currentTarget.style.background = 'linear-gradient(180deg, #1e1e1e 0%, #151515 100%)';
                  }}
                >
                  <span className="text-[9px] font-mono text-rmpg-600 mb-1">
                    CH {(idx + 1).toString().padStart(2, '0')}
                  </span>
                  <span className="text-sm font-bold font-mono tracking-wider text-white">
                    {ch.label}
                  </span>
                  <span className="text-[10px] font-mono text-rmpg-500 mt-0.5">
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

          {/* ── Top Status Bar — APX control head style ──────── */}
          <div
            className="flex items-center justify-between px-3 py-1.5"
            style={{
              background: 'linear-gradient(180deg, #1a1a1a 0%, #111 100%)',
              borderBottom: '2px solid #252525',
              flexShrink: 0,
            }}
          >
            {/* Left — LED indicators */}
            <div className="flex items-center gap-3">
              {/* TX LED */}
              <div className="flex items-center gap-1">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{
                    background: isTransmitting ? '#ef4444' : '#3a1515',
                    boxShadow: isTransmitting ? '0 0 6px #ef4444' : 'none',
                    transition: 'all 0.1s',
                  }}
                />
                <span className="text-[8px] font-mono font-bold" style={{ color: isTransmitting ? '#ef4444' : '#555' }}>TX</span>
              </div>
              {/* RX LED */}
              <div className="flex items-center gap-1">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{
                    background: otherSpeaking ? '#22c55e' : '#153315',
                    boxShadow: otherSpeaking ? '0 0 6px #22c55e' : 'none',
                    transition: 'all 0.1s',
                  }}
                />
                <span className="text-[8px] font-mono font-bold" style={{ color: otherSpeaking ? '#22c55e' : '#555' }}>RX</span>
              </div>
              {/* BUSY LED */}
              <div className="flex items-center gap-1">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{
                    background: channelBusy && !isTransmitting ? '#f59e0b' : '#332b15',
                    boxShadow: channelBusy && !isTransmitting ? '0 0 6px #f59e0b' : 'none',
                    transition: 'all 0.1s',
                  }}
                />
                <span className="text-[8px] font-mono font-bold" style={{ color: channelBusy && !isTransmitting ? '#f59e0b' : '#555' }}>BSY</span>
              </div>
            </div>

            {/* Center — Clock */}
            <span className="text-[10px] font-mono text-rmpg-400">
              {clockTime.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>

            {/* Right — Signal + Latency + Battery */}
            <div className="flex items-center gap-3">
              {/* Signal bars (real latency-based) */}
              <div className="flex items-center gap-0.5" title={`${signalLatency}ms — ${signalLabel}`}>
                <Signal style={{ width: 10, height: 10, color: '#707070' }} />
                <div className="flex items-end gap-px h-3">
                  {[1,2,3,4,5].map(i => (
                    <div
                      key={i}
                      className="w-[3px]"
                      style={{
                        height: `${i * 20}%`,
                        background: i <= signalBars ? signalColor : '#2a2a2a',
                        transition: 'background 0.3s',
                      }}
                    />
                  ))}
                </div>
                <span className="text-[7px] font-mono" style={{ color: signalColor }}>
                  {signalLatency > 0 ? `${signalLatency}ms` : ''}
                </span>
              </div>
              {/* Battery */}
              <div className="flex items-center gap-0.5">
                <Battery style={{ width: 12, height: 12, color: '#22c55e' }} />
                <span className="text-[8px] font-mono text-green-500">98%</span>
              </div>
              {/* Encrypted indicator */}
              <div className="flex items-center gap-0.5">
                <Lock style={{ width: 8, height: 8, color: '#3b82f6' }} />
                <span className="text-[8px] font-mono text-blue-400">ENC</span>
              </div>
              {/* FX indicator */}
              <button
                onClick={toggleFx}
                className="flex items-center gap-0.5 px-1 py-0.5 transition-colors"
                style={{
                  border: '1px solid',
                  borderColor: fxEnabled ? '#3b82f6' : '#333',
                  background: fxEnabled ? 'rgba(59,130,246,0.1)' : 'transparent',
                }}
                title={fxEnabled ? 'Radio FX: ON — Click to disable' : 'Radio FX: OFF — Click to enable'}
              >
                <span className="text-[7px] font-mono font-bold" style={{ color: fxEnabled ? '#60a5fa' : '#555' }}>
                  FX
                </span>
              </button>
            </div>
          </div>

          {/* ── Channel Tab Bar ──────────────────────────────── */}
          <div
            className="flex items-center justify-between px-2 py-1"
            style={{
              background: '#161616',
              borderBottom: '1px solid #252525',
              flexShrink: 0,
            }}
          >
            <div className="flex items-center gap-0.5 overflow-x-auto hide-scrollbar">
              {RADIO_CHANNELS.map((ch, idx) => {
                const isActive = ch.id === currentChannel;
                return (
                  <button
                    key={ch.id}
                    onClick={() => { if (!isActive) joinChannel(ch.id); }}
                    className="flex items-center gap-1 px-2 py-0.5 text-[9px] font-mono font-bold tracking-wider whitespace-nowrap transition-all"
                    style={{
                      background: isActive ? 'rgba(188, 16, 16, 0.2)' : 'transparent',
                      borderBottom: isActive ? '2px solid #bc1010' : '2px solid transparent',
                      color: isActive ? '#fff' : '#555',
                    }}
                  >
                    {isActive && <span className="w-1.5 h-1.5 rounded-full bg-green-500" style={{ boxShadow: '0 0 3px #22c55e' }} />}
                    {ch.label}
                  </button>
                );
              })}
            </div>
            <button
              onClick={leaveChannel}
              className="flex items-center gap-1 px-2 py-0.5 text-[9px] font-mono font-bold text-rmpg-500 hover:text-red-400 transition-colors ml-2 border border-rmpg-800 hover:border-red-900"
            >
              LEAVE
            </button>
          </div>

          {/* ── Main Content ────────────────────────────────── */}
          <div className={`flex-1 flex ${isMobile ? 'flex-col' : 'flex-row'} overflow-hidden`}>

            {/* ── Left Panel: APX Radio Display ──────────────── */}
            <div className={`flex flex-col items-center justify-center ${isMobile ? 'flex-1' : 'flex-[2]'} p-4`}>

              {/* APX LCD Display Panel */}
              <div
                className="w-full max-w-sm mb-5"
                style={{
                  background: '#050a05',
                  border: '3px solid #1a1a1a',
                  boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.7), 0 2px 8px rgba(0,0,0,0.5)',
                  borderRadius: '2px',
                }}
              >
                {/* LCD top row — zone info */}
                <div className="px-4 pt-3 pb-1 flex items-center justify-between">
                  <span
                    className="text-[9px] font-mono tracking-[0.2em]"
                    style={{ color: '#1a7a1a' }}
                  >
                    ZONE: RMPG SEC
                  </span>
                  <span
                    className="text-[9px] font-mono"
                    style={{ color: '#1a7a1a' }}
                  >
                    P25
                  </span>
                </div>

                {/* LCD main — channel name + frequency */}
                <div className="px-4 pb-1 text-center">
                  <div
                    className="text-3xl font-bold font-mono tracking-[0.15em] leading-tight"
                    style={{
                      color: '#33ff33',
                      textShadow: '0 0 12px rgba(51, 255, 51, 0.4), 0 0 30px rgba(51, 255, 51, 0.15)',
                      fontFamily: '"Share Tech Mono", "Courier New", monospace',
                    }}
                  >
                    {channelInfo?.label || currentChannel?.toUpperCase() || 'CH 01'}
                  </div>
                  <div
                    className="text-base font-mono mt-0.5 tracking-wider"
                    style={{ color: '#33ff33', opacity: 0.5 }}
                  >
                    {channelInfo?.freq || '---'} MHz
                  </div>
                </div>

                {/* LCD bottom row — status */}
                <div className="px-4 pb-3 pt-1 flex items-center justify-between">
                  <span
                    className="text-[9px] font-mono tracking-wider"
                    style={{
                      color: isMuted ? '#ef4444'
                        : isTransmitting ? '#ff4444'
                        : otherSpeaking ? '#ffaa00'
                        : emergencyActive ? '#ef4444'
                        : '#1a7a1a',
                    }}
                  >
                    {isMuted ? 'MUTED'
                      : isTransmitting ? `TRANSMIT ${formatTxTimer(txTimer)}`
                      : otherSpeaking ? `RX: ${activeSpeaker?.fullName?.split(' ')[0] || 'UNIT'}`
                      : emergencyActive ? `EMERGENCY — ${emergencyUser?.fullName || 'UNIT'}`
                      : 'READY'}
                  </span>
                  <span
                    className="text-[9px] font-mono"
                    style={{ color: '#1a7a1a' }}
                  >
                    {channelUsers.length} ON CH
                  </span>
                </div>
              </div>

              {/* ── Emergency Banner (when active) ──────────────── */}
              {emergencyActive && (
                <div
                  className="w-full max-w-sm mb-3 px-3 py-2"
                  style={{
                    background: 'rgba(239, 68, 68, 0.15)',
                    border: '2px solid #ef4444',
                    animation: 'emergencyFlash 1s infinite',
                  }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle style={{ width: 14, height: 14, color: '#ef4444' }} />
                    <span className="text-xs font-mono font-bold text-red-400 tracking-wider">
                      EMERGENCY ACTIVE
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-red-300">
                    {emergencyUser?.fullName || 'Unknown Unit'}
                    {emergencyUser?.latitude && (
                      <span className="text-rmpg-500 ml-2">
                        GPS: {emergencyUser.latitude.toFixed(5)}, {emergencyUser.longitude?.toFixed(5)}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2 mt-2">
                    {emergencyUser?.userId === Number(user?.id) ? (
                      <button
                        onClick={cancelEmergency}
                        className="px-3 py-1 text-[9px] font-mono font-bold text-white bg-red-700 hover:bg-red-600 transition-colors"
                      >
                        CANCEL EMERGENCY
                      </button>
                    ) : (
                      <button
                        onClick={acknowledgeEmergency}
                        className="px-3 py-1 text-[9px] font-mono font-bold text-white bg-blue-700 hover:bg-blue-600 transition-colors"
                      >
                        ACKNOWLEDGE
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* ── Volume Controls + VU Meter ──────────────────── */}
              <div className="w-full max-w-sm mb-4 px-2">
                <div className="flex items-center gap-2">
                  {/* Mute toggle */}
                  <button
                    onClick={toggleMute}
                    className="flex items-center justify-center w-7 h-7 transition-colors"
                    style={{
                      background: isMuted ? 'rgba(239, 68, 68, 0.2)' : 'transparent',
                      border: `1px solid ${isMuted ? '#ef4444' : '#333'}`,
                    }}
                    title={isMuted ? 'Unmute' : 'Mute'}
                  >
                    {isMuted ? (
                      <VolumeX style={{ width: 14, height: 14, color: '#ef4444' }} />
                    ) : (
                      <Volume2 style={{ width: 14, height: 14, color: '#666' }} />
                    )}
                  </button>
                  {/* Volume slider */}
                  <div className="flex-1 flex items-center gap-2">
                    <span className="text-[8px] font-mono text-rmpg-600 w-6">VOL</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={masterVolume}
                      onChange={(e) => setMasterVolume(parseFloat(e.target.value))}
                      className="flex-1 h-1 appearance-none cursor-pointer"
                      style={{
                        background: `linear-gradient(to right, #33ff33 0%, #33ff33 ${masterVolume * 100}%, #2a2a2a ${masterVolume * 100}%, #2a2a2a 100%)`,
                        borderRadius: 0,
                      }}
                    />
                    <span className="text-[8px] font-mono text-rmpg-500 w-8 text-right">
                      {Math.round(masterVolume * 100)}%
                    </span>
                  </div>
                </div>
                {/* VU Meter */}
                <div className="mt-1 px-8">
                  <RadioVuMeter analyser={analyserNode} barCount={12} height={10} />
                </div>
              </div>

              {/* Active speaker indicator with waveform */}
              <div className="w-full max-w-sm mb-5 text-center" style={{ minHeight: 44 }}>
                {activeSpeaker ? (
                  <div className="flex items-center justify-center gap-3">
                    <div className="flex items-end gap-0.5 h-5">
                      {[0, 1, 2, 3, 4, 5, 6].map(i => (
                        <div
                          key={i}
                          className="w-[3px]"
                          style={{
                            background: isTransmitting ? '#ef4444' : '#22c55e',
                            animation: `radioWave 0.5s ease-in-out ${i * 0.07}s infinite alternate`,
                          }}
                        />
                      ))}
                    </div>
                    <div>
                      <div className="text-sm font-bold font-mono" style={{ color: isTransmitting ? '#ef4444' : '#22c55e' }}>
                        {activeSpeaker.fullName || activeSpeaker.username || 'Unknown'}
                      </div>
                      <div className="text-[9px] font-mono text-rmpg-500 tracking-wider">
                        {isTransmitting ? 'TRANSMITTING' : 'RECEIVING'}
                      </div>
                    </div>
                    <div className="flex items-end gap-0.5 h-5">
                      {[0, 1, 2, 3, 4, 5, 6].map(i => (
                        <div
                          key={i}
                          className="w-[3px]"
                          style={{
                            background: isTransmitting ? '#ef4444' : '#22c55e',
                            animation: `radioWave 0.5s ease-in-out ${i * 0.09}s infinite alternate`,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-600" style={{ boxShadow: '0 0 4px #22c55e' }} />
                    <span className="text-[10px] font-mono text-green-700 tracking-[0.2em]">
                      CHANNEL CLEAR
                    </span>
                  </div>
                )}
              </div>

              {/* PTT Button — large, styled like a real radio button */}
              <button
                ref={pttRef}
                onMouseDown={() => startTransmit()}
                onMouseUp={() => stopTransmit()}
                onMouseLeave={() => { if (isTransmitting) stopTransmit(); }}
                onTouchStart={(e) => { e.preventDefault(); startTransmit(); }}
                onTouchEnd={(e) => { e.preventDefault(); stopTransmit(); }}
                disabled={!isConnected || !micSupported || (channelBusy && !isTransmitting)}
                className="relative flex items-center justify-center select-none"
                style={{
                  width: isMobile ? 130 : 150,
                  height: isMobile ? 130 : 150,
                  borderRadius: '50%',
                  background: !micSupported
                    ? 'radial-gradient(circle at 40% 35%, #3a3a3a 0%, #222 50%, #1a1a1a 100%)'
                    : isTransmitting
                      ? 'radial-gradient(circle at 40% 35%, #e83030 0%, #8a0c0c 50%, #4a0606 100%)'
                      : otherSpeaking
                        ? 'radial-gradient(circle at 40% 35%, #c49030 0%, #6a5010 50%, #3a2a06 100%)'
                        : 'radial-gradient(circle at 40% 35%, #2a5a2a 0%, #1a3a1a 50%, #0a2a0a 100%)',
                  border: !micSupported
                    ? '3px solid #4a4a4a'
                    : isTransmitting
                      ? '3px solid #ff4444'
                      : otherSpeaking
                        ? '3px solid #d4a030'
                        : '3px solid #2a5a2a',
                  boxShadow: isTransmitting
                    ? '0 0 40px rgba(217, 48, 48, 0.5), 0 4px 12px rgba(0,0,0,0.5), inset 0 -4px 8px rgba(0,0,0,0.4)'
                    : otherSpeaking
                      ? '0 0 25px rgba(212, 160, 48, 0.3), 0 4px 12px rgba(0,0,0,0.5), inset 0 -4px 8px rgba(0,0,0,0.4)'
                      : '0 4px 15px rgba(0,0,0,0.6), inset 0 -4px 8px rgba(0,0,0,0.3), inset 0 2px 4px rgba(255,255,255,0.05)',
                  cursor: (!isConnected || !micSupported || (channelBusy && !isTransmitting)) ? 'not-allowed' : 'pointer',
                  opacity: (!isConnected || !micSupported) ? 0.4 : 1,
                  transition: 'all 0.1s ease',
                  touchAction: 'none',
                  transform: isTransmitting ? 'scale(0.97)' : 'scale(1)',
                }}
              >
                {/* Pulse rings when transmitting */}
                {isTransmitting && (
                  <>
                    <div
                      className="absolute inset-[-10px] rounded-full"
                      style={{
                        border: '2px solid rgba(217, 48, 48, 0.3)',
                        animation: 'radioPulse 1s ease-out infinite',
                      }}
                    />
                    <div
                      className="absolute inset-[-20px] rounded-full"
                      style={{
                        border: '1px solid rgba(217, 48, 48, 0.15)',
                        animation: 'radioPulse 1.5s ease-out 0.3s infinite',
                      }}
                    />
                  </>
                )}

                <div className="flex flex-col items-center">
                  {!micSupported ? (
                    <MicOff style={{ width: 28, height: 28, color: '#707070' }} />
                  ) : isTransmitting ? (
                    <Mic style={{ width: 28, height: 28, color: '#fff' }} />
                  ) : otherSpeaking ? (
                    <Volume2 style={{ width: 28, height: 28, color: '#d4a030' }} />
                  ) : (
                    <Mic style={{ width: 28, height: 28, color: '#66cc66' }} />
                  )}
                  <span
                    className="text-xs font-mono font-black tracking-[0.2em] mt-2"
                    style={{
                      color: !micSupported ? '#707070'
                        : isTransmitting ? '#fff'
                        : otherSpeaking ? '#d4a030'
                        : '#66cc66',
                    }}
                  >
                    {!micSupported ? 'NO MIC' : isTransmitting ? 'TX' : otherSpeaking ? 'RX' : 'PTT'}
                  </span>
                </div>
              </button>

              {/* Hint text */}
              <div className="mt-4 text-center">
                {!micSupported ? (
                  <span className="text-[10px] font-mono text-rmpg-500">
                    HTTPS required for microphone
                  </span>
                ) : isTransmitting ? (
                  <span className="text-[10px] font-mono text-red-400 animate-pulse tracking-wider">
                    RELEASE TO END TRANSMISSION
                  </span>
                ) : otherSpeaking ? (
                  <span className="text-[10px] font-mono text-yellow-500">
                    {activeSpeaker?.fullName || 'Unit'} transmitting
                  </span>
                ) : (
                  <span className="text-[10px] font-mono text-rmpg-600">
                    {isMobile ? 'HOLD PTT TO TALK' : 'HOLD PTT OR SPACE BAR TO TALK'}
                  </span>
                )}
              </div>

              {/* ── Emergency + DTMF Buttons ─────────────────── */}
              <div className="flex items-center gap-2 mt-3">
                {/* Emergency Button — two-click activation */}
                <button
                  onClick={() => {
                    if (emergencyActive && emergencyUser?.userId === Number(user?.id)) {
                      cancelEmergency();
                      return;
                    }
                    if (!emergencyArmed) {
                      setEmergencyArmed(true);
                      emergencyArmTimer.current = setTimeout(() => setEmergencyArmed(false), 5000);
                    } else {
                      if (emergencyArmTimer.current) clearTimeout(emergencyArmTimer.current);
                      setEmergencyArmed(false);
                      startEmergency();
                    }
                  }}
                  disabled={!isConnected || !micSupported}
                  className="flex items-center gap-1.5 px-4 py-2 text-[9px] font-mono font-black tracking-wider transition-all"
                  style={{
                    background: emergencyActive
                      ? 'linear-gradient(180deg, #ef4444 0%, #991b1b 100%)'
                      : emergencyArmed
                        ? 'linear-gradient(180deg, #f59e0b 0%, #92400e 100%)'
                        : 'linear-gradient(180deg, #7f1d1d 0%, #450a0a 100%)',
                    border: emergencyArmed ? '2px solid #f59e0b' : '2px solid #7f1d1d',
                    color: emergencyActive || emergencyArmed ? '#fff' : '#991b1b',
                    animation: emergencyArmed ? 'emergencyFlash 0.5s infinite' : 'none',
                    opacity: (!isConnected || !micSupported) ? 0.3 : 1,
                  }}
                >
                  <AlertTriangle style={{ width: 12, height: 12 }} />
                  {emergencyActive ? 'CANCEL' : emergencyArmed ? 'CONFIRM EMER' : 'EMER'}
                </button>

                {/* DTMF Keypad Toggle */}
                <button
                  onClick={() => setShowDtmf(!showDtmf)}
                  className="flex items-center gap-1 px-3 py-2 text-[9px] font-mono font-bold tracking-wider transition-colors"
                  style={{
                    background: showDtmf ? 'rgba(59,130,246,0.15)' : 'transparent',
                    border: `1px solid ${showDtmf ? '#3b82f6' : '#333'}`,
                    color: showDtmf ? '#60a5fa' : '#555',
                  }}
                >
                  <Hash style={{ width: 10, height: 10 }} />
                  DTMF
                </button>
              </div>

              {/* ── DTMF Keypad ──────────────────────────────── */}
              {showDtmf && (
                <div
                  className="mt-3 p-2"
                  style={{
                    background: '#0a0a0a',
                    border: '1px solid #252525',
                    maxWidth: 200,
                  }}
                >
                  <div className="text-[7px] font-mono text-rmpg-600 tracking-wider text-center mb-1">
                    DTMF KEYPAD
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {['1','2','3','4','5','6','7','8','9','*','0','#'].map(digit => (
                      <button
                        key={digit}
                        onMouseDown={() => playDtmfTone(digit, 150)}
                        className="flex items-center justify-center py-2 text-sm font-mono font-bold text-white transition-colors"
                        style={{
                          background: 'linear-gradient(180deg, #2a2a2a 0%, #1a1a1a 100%)',
                          border: '1px solid #333',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#bc1010'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#333'; }}
                      >
                        {digit}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Selcall Received Alert */}
              {selcallAlert && (
                <div
                  className="mt-3 px-4 py-3 w-full max-w-sm"
                  style={{
                    background: 'rgba(245, 158, 11, 0.15)',
                    border: '2px solid #f59e0b',
                    animation: 'emergencyFlash 1s infinite',
                  }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Bell style={{ width: 14, height: 14, color: '#f59e0b' }} />
                    <span className="text-xs font-mono font-bold text-yellow-400 tracking-wider">
                      SELCALL ALERT
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-yellow-300 mb-2">
                    FROM: {selcallAlert.fromFullName}
                  </div>
                  <button
                    onClick={acknowledgeSelcall}
                    className="px-4 py-1.5 text-[9px] font-mono font-bold text-white bg-yellow-700 hover:bg-yellow-600 transition-colors tracking-wider"
                  >
                    ACKNOWLEDGE
                  </button>
                </div>
              )}

              {/* Live transcript while transmitting */}
              {isTransmitting && liveTranscript && (
                <div
                  className="mt-3 px-4 py-2 max-w-md"
                  style={{
                    background: 'rgba(188, 16, 16, 0.08)',
                    border: '1px solid #3a1515',
                  }}
                >
                  <div className="text-[8px] font-mono font-bold tracking-[0.2em] text-rmpg-600 mb-1">
                    LIVE TRANSCRIPT
                  </div>
                  <div className="text-[11px] font-mono text-rmpg-300 leading-relaxed">
                    {liveTranscript}
                  </div>
                </div>
              )}

              {/* Error display */}
              {error && (
                <div className="flex items-center gap-2 mt-3 px-3 py-2 text-xs font-mono text-red-400 border border-red-900 bg-red-950/30 max-w-sm">
                  <AlertCircle style={{ width: 14, height: 14, flexShrink: 0 }} />
                  <span className="break-words">{error}</span>
                </div>
              )}
            </div>

            {/* ── Right Sidebar: Users + Log ──────────────── */}
            <div
              className={`flex flex-col ${isMobile ? '' : 'w-72'} border-l`}
              style={{
                background: '#131313',
                borderColor: '#222',
                flexShrink: 0,
                maxHeight: isMobile ? '40vh' : undefined,
              }}
            >
              {/* Channel Users + Radio Check */}
              <div
                className="px-3 py-2"
                style={{
                  borderBottom: '1px solid #222',
                  background: 'linear-gradient(180deg, #181818 0%, #131313 100%)',
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Users style={{ width: 11, height: 11, color: '#555' }} />
                  <span className="text-[9px] font-mono font-bold tracking-[0.15em] text-rmpg-500">
                    ON CHANNEL ({channelUsers.length})
                  </span>
                  <div className="ml-auto flex items-center gap-1">
                    {/* Radio Check button */}
                    <button
                      onClick={() => { setRadioCheckWaiting(true); sendRadioCheck(); }}
                      disabled={radioCheckWaiting}
                      className="flex items-center gap-0.5 px-1.5 py-0.5 text-[7px] font-mono font-bold tracking-wider transition-colors"
                      style={{
                        border: '1px solid #333',
                        color: radioCheckWaiting ? '#f59e0b' : '#555',
                        background: radioCheckWaiting ? 'rgba(245,158,11,0.1)' : 'transparent',
                      }}
                      title="Send Radio Check to all users on channel"
                    >
                      <PhoneCall style={{ width: 8, height: 8 }} />
                      {radioCheckWaiting ? 'WAIT...' : 'RADIO CK'}
                    </button>
                  </div>
                </div>

                {/* Radio Check Responses */}
                {radioCheckResponses.length > 0 && (
                  <div className="mb-2 px-1 py-1" style={{ background: 'rgba(34,197,94,0.05)', border: '1px solid #1a3a1a' }}>
                    <div className="text-[7px] font-mono text-green-600 tracking-wider mb-0.5">RADIO CHECK — COPY:</div>
                    {radioCheckResponses.map((r) => (
                      <div key={r.userId} className="text-[9px] font-mono text-green-400">
                        {r.fullName} — COPY
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-0.5 max-h-32 overflow-y-auto">
                  {channelUsers.length === 0 ? (
                    <div className="text-[9px] font-mono text-rmpg-700 italic">
                      No users
                    </div>
                  ) : (
                    channelUsers.map((u) => (
                      <div key={u.userId} className="flex items-center gap-2 py-0.5 group">
                        <span
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{
                            background: activeSpeaker?.userId === u.userId ? '#ef4444' : '#22c55e',
                            boxShadow: activeSpeaker?.userId === u.userId
                              ? '0 0 4px #ef4444' : '0 0 3px #22c55e',
                          }}
                        />
                        <span className="text-[10px] font-mono text-rmpg-300 truncate">
                          {u.fullName || u.username}
                        </span>
                        <span className="text-[8px] font-mono text-rmpg-700 uppercase ml-auto flex-shrink-0">
                          {u.role || ''}
                        </span>
                        {/* Selcall button (don't show for ourselves) */}
                        {u.userId !== Number(user?.id) && (
                          <button
                            onClick={() => sendSelcall(u.userId)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                            title={`Alert ${u.fullName || u.username}`}
                          >
                            <Bell style={{ width: 9, height: 9, color: '#f59e0b' }} />
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Transmission Log / History */}
              <div className="flex-1 overflow-hidden flex flex-col">
                <div
                  className="px-3 py-1.5 flex items-center justify-between"
                  style={{
                    borderBottom: '1px solid #1e1e1e',
                    background: '#161616',
                  }}
                >
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setShowHistory(false)}
                      className="flex items-center gap-1 px-2 py-0.5 text-[8px] font-mono font-bold tracking-wider transition-colors"
                      style={{
                        color: !showHistory ? '#fff' : '#444',
                        borderBottom: !showHistory ? '2px solid #bc1010' : '2px solid transparent',
                      }}
                    >
                      <Zap style={{ width: 8, height: 8 }} /> LIVE
                    </button>
                    <button
                      onClick={() => setShowHistory(true)}
                      className="flex items-center gap-1 px-2 py-0.5 text-[8px] font-mono font-bold tracking-wider transition-colors"
                      style={{
                        color: showHistory ? '#fff' : '#444',
                        borderBottom: showHistory ? '2px solid #3b82f6' : '2px solid transparent',
                      }}
                    >
                      <History style={{ width: 8, height: 8 }} /> LOG
                    </button>
                  </div>
                  {showHistory && (
                    <button
                      onClick={exportHistoryCsv}
                      className="text-[7px] text-rmpg-600 hover:text-white flex items-center gap-0.5"
                      title="Export CSV"
                    >
                      <Download style={{ width: 7, height: 7 }} /> CSV
                    </button>
                  )}
                </div>

                {/* History filters */}
                {showHistory && (
                  <div className="px-3 py-1 flex items-center gap-1" style={{ borderBottom: '1px solid #1a1a1a', background: '#121212' }}>
                    <Search style={{ width: 8, height: 8, color: '#444' }} />
                    <input
                      type="text"
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                      placeholder="Search..."
                      className="flex-1 bg-transparent text-[9px] text-white font-mono focus:outline-none"
                    />
                    <select
                      value={historyChannel}
                      onChange={(e) => setHistoryChannel(e.target.value)}
                      className="bg-surface-base text-[8px] text-rmpg-400 border border-rmpg-700 px-1 py-0.5 font-mono"
                    >
                      <option value="">All CH</option>
                      {RADIO_CHANNELS.map(ch => (
                        <option key={ch.id} value={ch.id}>{ch.label}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="flex-1 overflow-y-auto px-3 py-1">
                  {!showHistory ? (
                    transmissionLog.length === 0 ? (
                      <div className="text-[9px] font-mono text-rmpg-700 italic py-2">
                        No transmissions
                      </div>
                    ) : (
                      transmissionLog.map((entry) => (
                        <div
                          key={entry.id}
                          className="flex items-start gap-2 py-1 border-b border-rmpg-800/30"
                        >
                          <span className="text-[8px] font-mono text-rmpg-600 flex-shrink-0 mt-0.5">
                            {formatLogTime(entry.startedAt)}
                          </span>
                          <div className="min-w-0">
                            <span className="text-[10px] font-mono text-rmpg-300 truncate block">
                              {displayName(entry)}
                            </span>
                            <span className="text-[8px] font-mono text-rmpg-600">
                              {formatDuration(entry.duration)}
                              {entry.duration > 0 ? ' on ' : ''}
                              {(entry.channel || '').toUpperCase()}
                            </span>
                            {entry.transcript && (
                              <div className="text-[9px] font-mono text-rmpg-500 mt-0.5 leading-snug italic">
                                "{entry.transcript}"
                              </div>
                            )}
                          </div>
                        </div>
                      ))
                    )
                  ) : (
                    historyLoading ? (
                      <div className="text-[9px] font-mono text-rmpg-700 italic py-2">Loading...</div>
                    ) : historyEntries.length === 0 ? (
                      <div className="text-[9px] font-mono text-rmpg-700 italic py-2">
                        No transcripts
                      </div>
                    ) : (
                      historyEntries.map((entry) => (
                        <div
                          key={entry.id}
                          className="flex items-start gap-2 py-1 border-b border-rmpg-800/30"
                        >
                          <span className="text-[8px] font-mono text-rmpg-600 flex-shrink-0 mt-0.5">
                            {new Date(entry.transmitted_at).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] font-mono text-rmpg-300 truncate">
                                {entry.full_name || entry.username || 'Unknown'}
                              </span>
                              <span
                                className="text-[7px] font-black uppercase px-1 py-px"
                                style={{ background: '#bc1010', color: '#fff' }}
                              >
                                {(entry.channel || '').toUpperCase()}
                              </span>
                            </div>
                            {entry.duration_seconds > 0 && (
                              <span className="text-[8px] font-mono text-rmpg-600">
                                {formatDuration(entry.duration_seconds)}
                              </span>
                            )}
                            {entry.transcript && (
                              <div className="text-[9px] font-mono text-rmpg-500 mt-0.5 leading-snug italic">
                                "{entry.transcript}"
                              </div>
                            )}
                          </div>
                        </div>
                      ))
                    )
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── CSS Animations ────────────────────────────────── */}
      <style>{`
        @keyframes radioWave {
          0% { height: 3px; }
          100% { height: 18px; }
        }
        @keyframes radioPulse {
          0% {
            transform: scale(1);
            opacity: 0.5;
          }
          100% {
            transform: scale(1.4);
            opacity: 0;
          }
        }
        @keyframes emergencyFlash {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        /* Volume slider thumb styling */
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 10px;
          height: 10px;
          background: #33ff33;
          border: none;
          cursor: pointer;
        }
        input[type="range"]::-moz-range-thumb {
          width: 10px;
          height: 10px;
          background: #33ff33;
          border: none;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
