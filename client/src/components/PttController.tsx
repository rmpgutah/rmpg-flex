// ============================================================
// RMPG Flex — Global Push-To-Talk Controller
//
// Mounted once in Layout so the PTT hotkey works on EVERY page, not
// just the Radio console. Holding the configured key (default `) keys
// the mic on the selected radio channel; releasing un-keys. All audio
// is relayed to everyone on the channel AND recorded to R2 by the
// server (VoiceHubDO.persist), so every officer/dispatch transmission
// lands in Radio → Recordings automatically.
//
// Reuses the exact same useVoiceChannel hook the on-screen PTT button
// uses — this component only adds the keyboard binding, channel
// resolution, and an always-visible on-air HUD.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Radio, Mic, MicOff, RadioTower } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../hooks/useApi';
import { useVoiceChannel } from '../pages/radio/useVoiceChannel';
import type { RadioChannel } from '../pages/radio/types';
import { getPttPrefs, keyCodeLabel, PTT_PREFS_EVENT, type PttPreferences } from '../utils/pttPreferences';

export default function PttController() {
  const { user } = useAuth();
  const location = useLocation();
  // The Radio console already owns its own PTT + live monitoring; running the
  // global controller there too would double-connect (echoed playback, inflated
  // member count). Stand down while the user is on /radio.
  const onRadioPage = location.pathname.startsWith('/radio');
  const [prefs, setPrefs] = useState<PttPreferences>(getPttPrefs);
  const [channels, setChannels] = useState<RadioChannel[]>([]);

  // Inject the HUD's keyframes once (self-contained — no global CSS dep).
  useEffect(() => {
    if (document.getElementById('rmpg-ptt-style')) return;
    const el = document.createElement('style');
    el.id = 'rmpg-ptt-style';
    el.textContent =
      '@keyframes rmpg-ptt-pulse{0%,100%{box-shadow:0 2px 8px rgba(0,0,0,0.5),0 0 0 0 rgba(239,68,68,0.5)}50%{box-shadow:0 2px 8px rgba(0,0,0,0.5),0 0 0 6px rgba(239,68,68,0)}}' +
      '@keyframes rmpg-ptt-blink{0%,100%{opacity:1}50%{opacity:0.25}}';
    document.head.appendChild(el);
  }, []);

  // Re-read prefs whenever the Settings page changes them (same-tab event
  // + cross-tab storage event).
  useEffect(() => {
    const refresh = () => setPrefs(getPttPrefs());
    window.addEventListener(PTT_PREFS_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(PTT_PREFS_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  // Load channels once (for auto-pick + name display). Best-effort.
  useEffect(() => {
    if (!user) return;
    apiFetch<RadioChannel[]>('/radio/channels').then(setChannels).catch(() => { /* offline */ });
  }, [user]);

  // Resolve the channel to transmit on: explicit pref, else first active.
  const active = prefs.enabled && !onRadioPage;
  const resolvedChannelId =
    active
      ? (prefs.channelId ?? channels[0]?.id ?? null)
      : null;
  const channelName =
    channels.find((c) => c.id === resolvedChannelId)?.name ?? `CH ${resolvedChannelId ?? '—'}`;

  const voice = useVoiceChannel(resolvedChannelId);

  // Mirror live values into refs so the key listeners can bind ONCE and
  // still see current state (avoids re-attaching on every render).
  const pttDownRef = useRef(voice.pttDown);
  const pttUpRef = useRef(voice.pttUp);
  const keyCodeRef = useRef(prefs.keyCode);
  const enabledRef = useRef(prefs.enabled && resolvedChannelId != null);
  const heldRef = useRef(false);
  pttDownRef.current = voice.pttDown;
  pttUpRef.current = voice.pttUp;
  keyCodeRef.current = prefs.keyCode;
  enabledRef.current = active && resolvedChannelId != null;

  const isTypingTarget = (el: EventTarget | null): boolean => {
    const t = el as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  };

  // Bind global key listeners once.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!enabledRef.current || e.code !== keyCodeRef.current) return;
      if (e.repeat || heldRef.current) return;          // ignore auto-repeat
      if (isTypingTarget(e.target)) return;             // don't steal typing
      e.preventDefault();
      heldRef.current = true;
      pttDownRef.current();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== keyCodeRef.current) return;
      if (!heldRef.current) return;
      e.preventDefault();
      heldRef.current = false;
      pttUpRef.current();
    };
    // Safety: if focus leaves the window mid-transmission, un-key.
    const onBlur = () => {
      if (heldRef.current) { heldRef.current = false; pttUpRef.current(); }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // Click-and-hold the HUD as an alternative to the key.
  const holdDown = useCallback(() => {
    if (!enabledRef.current || heldRef.current) return;
    heldRef.current = true; voice.pttDown();
  }, [voice]);
  const holdUp = useCallback(() => {
    if (!heldRef.current) return;
    heldRef.current = false; voice.pttUp();
  }, [voice]);

  if (!active || resolvedChannelId == null) return null;

  // ── HUD state → color + label ──
  let bg = '#161616', border = '#2e2e2e', dot = '#555', label = 'STANDBY', Icon = Radio;
  if (!voice.supported) { label = 'NO MIC'; dot = '#666'; Icon = MicOff; }
  else if (voice.transmitting) { bg = '#3a0d0d'; border = '#ef4444'; dot = '#ef4444'; label = 'ON AIR'; Icon = Mic; }
  else if (voice.activeSpeaker) { bg = '#0d2a14'; border = '#22c55e'; dot = '#22c55e'; label = `RX · ${voice.activeSpeaker.label}`; Icon = RadioTower; }
  else if (voice.busy) { bg = '#2a220a'; border = '#d4a017'; dot = '#d4a017'; label = 'CHANNEL BUSY'; Icon = Radio; }
  else if (voice.connected) { dot = '#22c55e'; label = 'MONITORING'; }
  else { dot = '#d4a017'; label = 'CONNECTING…'; }

  return (
    <div
      role="status"
      aria-live="polite"
      onMouseDown={holdDown}
      onMouseUp={holdUp}
      onMouseLeave={holdUp}
      onTouchStart={(e) => { e.preventDefault(); holdDown(); }}
      onTouchEnd={(e) => { e.preventDefault(); holdUp(); }}
      title={`Hold ${keyCodeLabel(prefs.keyCode)} (or click-hold) to transmit on ${channelName}`}
      style={{
        position: 'fixed', right: 12, bottom: 30, zIndex: 9000,
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 10px', background: bg, border: `1px solid ${border}`,
        borderRadius: 2, cursor: 'pointer', userSelect: 'none',
        boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
        fontFamily: "'JetBrains Mono', monospace",
        animation: voice.transmitting ? 'rmpg-ptt-pulse 1s ease-in-out infinite' : undefined,
      }}
    >
      <span
        style={{
          width: 8, height: 8, borderRadius: 1, background: dot, flexShrink: 0,
          animation: (voice.transmitting || voice.activeSpeaker) ? 'rmpg-ptt-blink 0.8s ease-in-out infinite' : undefined,
        }}
      />
      <Icon style={{ width: 13, height: 13, color: dot }} aria-hidden />
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
        <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.04em', color: '#fff' }}>{label}</span>
        <span style={{ fontSize: 8, color: '#888' }}>
          {channelName} · {voice.members} on · {keyCodeLabel(prefs.keyCode)} = PTT
        </span>
      </span>
    </div>
  );
}
