import React, { useEffect, useRef } from 'react';
import {
  Radio,
  Mic,
  MicOff,
  Users,
  Volume2,
  AlertCircle,
  WifiOff,
  ShieldAlert,
} from 'lucide-react';
import { useRadio, RADIO_CHANNELS } from '../hooks/useRadio';
import { useAuth } from '../context/AuthContext';
import { useIsMobile } from '../hooks/useIsMobile';

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
    joinChannel,
    leaveChannel,
    startTransmit,
    stopTransmit,
    isConnected,
  } = useRadio();

  const { user } = useAuth();
  const isMobile = useIsMobile();
  const pttRef = useRef<HTMLButtonElement>(null);

  // Track whether space is held down (prevent key-repeat)
  const spaceHeldRef = useRef(false);

  // ─── Keyboard PTT (Space bar) ──────────────────────────────
  useEffect(() => {
    if (!currentChannel) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
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

  return (
    <div className="h-full flex flex-col" style={{ background: '#1a1a1a' }}>

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

      {/* ─── No-channel state: channel selector only ─────────── */}
      {!currentChannel && (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-lg">
            {/* Header */}
            <div className="text-center mb-6">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Radio style={{ width: 24, height: 24, color: '#bc1010' }} />
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
            <div className="grid grid-cols-2 gap-3">
              {RADIO_CHANNELS.map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => joinChannel(ch.id)}
                  disabled={!isConnected}
                  className="group flex flex-col items-center p-4 transition-all duration-150 border"
                  style={{
                    background: 'linear-gradient(180deg, #252525 0%, #1e1e1e 100%)',
                    border: '1px solid #383838',
                    opacity: isConnected ? 1 : 0.4,
                  }}
                  onMouseEnter={(e) => {
                    if (isConnected) {
                      e.currentTarget.style.borderColor = '#bc1010';
                      e.currentTarget.style.background = 'linear-gradient(180deg, #2a2020 0%, #1e1a1a 100%)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = '#383838';
                    e.currentTarget.style.background = 'linear-gradient(180deg, #252525 0%, #1e1e1e 100%)';
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
              background: 'linear-gradient(180deg, #252525 0%, #1e1e1e 100%)',
              borderBottom: '1px solid #303030',
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
                    className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono font-bold tracking-wider whitespace-nowrap transition-all border"
                    style={{
                      background: isActive
                        ? 'rgba(188, 16, 16, 0.25)'
                        : 'transparent',
                      borderColor: isActive ? '#bc1010' : 'transparent',
                      color: isActive ? '#fff' : '#707070',
                    }}
                  >
                    {isActive && <span className="led-dot led-green" />}
                    {ch.label}
                  </button>
                );
              })}
            </div>

            {/* Right — leave button */}
            <button
              onClick={leaveChannel}
              className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono font-bold text-rmpg-400 hover:text-red-400 transition-colors ml-2"
              style={{ border: '1px solid #383838' }}
            >
              LEAVE
            </button>
          </div>

          {/* ── Main Content ────────────────────────────────── */}
          <div className={`flex-1 flex ${isMobile ? 'flex-col' : 'flex-row'} overflow-hidden`}>

            {/* ── Left Panel: Radio Display ─────────────────── */}
            <div className={`flex flex-col items-center justify-center ${isMobile ? 'flex-1' : 'flex-[2]'} p-4`}>

              {/* Channel frequency display */}
              <div
                className="w-full max-w-sm mb-6 p-4 text-center"
                style={{
                  background: '#0a0f0a',
                  border: '2px solid #2a2a2a',
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
                disabled={!isConnected || !micSupported || (channelBusy && !isTransmitting)}
                className="relative flex items-center justify-center select-none"
                style={{
                  width: isMobile ? 140 : 160,
                  height: isMobile ? 140 : 160,
                  borderRadius: '50%',
                  background: !micSupported
                    ? 'radial-gradient(circle, #3a3a3a 0%, #2a2a2a 70%, #1a1a1a 100%)'
                    : isTransmitting
                      ? 'radial-gradient(circle, #d93030 0%, #8a0c0c 70%, #4a0606 100%)'
                      : otherSpeaking
                        ? 'radial-gradient(circle, #b89030 0%, #6a5010 70%, #3a2a06 100%)'
                        : 'radial-gradient(circle, #2a4a2a 0%, #1a3a1a 70%, #0a2a0a 100%)',
                  border: !micSupported
                    ? '4px solid #4a4a4a'
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
                  cursor: (!isConnected || !micSupported || (channelBusy && !isTransmitting)) ? 'not-allowed' : 'pointer',
                  opacity: (!isConnected || !micSupported) ? 0.4 : 1,
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
                  {!micSupported ? (
                    <MicOff style={{ width: 32, height: 32, color: '#707070' }} />
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
                    {isMobile ? 'Hold PTT to talk' : 'Hold PTT or SPACE to talk'}
                  </span>
                )}
              </div>

              {/* Live transcript while transmitting */}
              {isTransmitting && liveTranscript && (
                <div className="mt-3 px-4 py-2 max-w-md rounded border border-rmpg-700 bg-rmpg-900/60">
                  <div className="text-[9px] font-mono font-bold tracking-wider text-rmpg-500 mb-1 uppercase">
                    Live Transcript
                  </div>
                  <div className="text-xs font-mono text-rmpg-200 leading-relaxed">
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
              className={`flex flex-col ${isMobile ? '' : 'w-72'} border-l border-rmpg-700`}
              style={{
                background: '#161616',
                flexShrink: 0,
                maxHeight: isMobile ? '40vh' : undefined,
              }}
            >
              {/* Channel Users */}
              <div
                className="px-3 py-2"
                style={{
                  borderBottom: '1px solid #303030',
                  background: 'linear-gradient(180deg, #1e1e1e 0%, #181818 100%)',
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Users style={{ width: 12, height: 12, color: '#707070' }} />
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
                    channelUsers.map((u) => (
                      <div
                        key={u.userId}
                        className="flex items-center gap-2 py-0.5"
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
                        <span className="text-[11px] font-mono text-rmpg-200 truncate">
                          {u.fullName || u.username || 'Unknown'}
                        </span>
                        <span className="text-[9px] font-mono text-rmpg-600 uppercase ml-auto flex-shrink-0">
                          {u.role || ''}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Transmission Log */}
              <div className="flex-1 overflow-hidden flex flex-col">
                <div
                  className="px-3 py-2"
                  style={{
                    borderBottom: '1px solid #252525',
                    background: 'linear-gradient(180deg, #1e1e1e 0%, #181818 100%)',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Radio style={{ width: 12, height: 12, color: '#707070' }} />
                    <span className="text-[10px] font-mono font-bold tracking-wider text-rmpg-400">
                      TRANSMISSION LOG
                    </span>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto px-3 py-1">
                  {transmissionLog.length === 0 ? (
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
                      </div>
                    ))
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
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}
