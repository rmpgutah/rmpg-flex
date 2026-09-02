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

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useLocation } from 'react-router';
import { Radio, Mic, MicOff, RadioTower } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../hooks/useApi';
import { useVoiceChannel, type DispatchRecordRef } from '../pages/radio/useVoiceChannel';
import DispatchRecordPanel from './DispatchRecordPanel';
import type { RadioChannel } from '../pages/radio/types';
import { getPttPrefs, keyCodeLabel, PTT_PREFS_EVENT, type PttPreferences } from '../utils/pttPreferences';
import { asArray } from '../utils/asArray';

// Keyboard-keycap chip — renders the PTT key (e.g. "Backspace") as a small
// button-like cap so the binding reads as a command, not prose.
const keycapStyle: CSSProperties = {
  display: 'inline-block', padding: '0 4px', minWidth: 8, borderRadius: 2,
  border: '1px solid var(--border-default)', borderBottomWidth: 2, background: 'var(--border-default)',
  color: 'var(--text-secondary)', fontSize: 8.5, fontWeight: 700, lineHeight: '13px',
  fontFamily: 'Arial, sans-serif', whiteSpace: 'nowrap',
};

export default function PttController() {
  const { user } = useAuth();
  const location = useLocation();
  // The Radio console already owns its own PTT + live monitoring; running the
  // global controller there too would double-connect (echoed playback, inflated
  // member count). Stand down while the user is on /radio.
  const onRadioPage = location.pathname.startsWith('/radio');
  const [prefs, setPrefs] = useState<PttPreferences>(getPttPrefs);
  const [channels, setChannels] = useState<RadioChannel[]>([]);
  // Record the AI dispatcher pulled for THIS officer's own plate/person check —
  // shown as a floating card over whatever page they're on (the operator
  // console handles its own panel). null = none open.
  const [fieldRecord, setFieldRecord] = useState<DispatchRecordRef | null>(null);
  // Collapsed HUD = a small pill (dot + icon only) so it never covers page
  // controls. Persisted per-browser. PTT and the keyboard key keep working
  // while collapsed — only the text label is hidden.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('rmpg-ptt-hud-collapsed') === '1'; } catch { return false; }
  });
  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem('rmpg-ptt-hud-collapsed', next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // Inject the HUD's keyframes once (self-contained — no global CSS dep).
  useEffect(() => {
    if (document.getElementById('rmpg-ptt-style')) return;
    const el = document.createElement('style');
    el.id = 'rmpg-ptt-style';
    el.textContent =
      '@keyframes rmpg-ptt-pulse{0%,100%{box-shadow:0 2px 8px rgba(0 0 0 / 0.5),0 0 0 0 rgba(239,68,68,0.5)}50%{box-shadow:0 2px 8px rgba(0 0 0 / 0.5),0 0 0 6px rgba(239,68,68,0)}}' +
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
    apiFetch<RadioChannel[]>('/radio/channels').then(d => setChannels(asArray(d))).catch(() => { /* offline */ });
  }, [user]);

  // Resolve the channel to transmit on: explicit pref, else first active.
  const active = prefs.enabled && !onRadioPage;
  const resolvedChannelId =
    active
      ? (prefs.channelId ?? channels[0]?.id ?? null)
      : null;
  const channelName =
    channels.find((c) => c.id === resolvedChannelId)?.name ?? `CH ${resolvedChannelId ?? '—'}`;

  const voice = useVoiceChannel(
    resolvedChannelId,
    undefined,
    // Open the looked-up record ONLY when it was this device's own request —
    // every other officer on the channel ignores it (the operator console is
    // the one that monitors all lookups).
    (ref, ctx) => { if (ctx.fromMe) setFieldRecord(ref); },
  );

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

  // Whether a key event should be left alone for text editing rather than
  // stolen for PTT. Critical when the PTT key is a destructive editing key
  // like Backspace — we must NEVER swallow it while the user is writing.
  // We consult BOTH the event target and the actually-focused element (some
  // widgets dispatch from a wrapper while an editable child holds focus), and
  // catch ARIA textboxes + any contenteditable region, not just raw inputs.
  const isTypingTarget = (el: EventTarget | null): boolean => {
    const candidates: Array<HTMLElement | null> = [el as HTMLElement | null];
    if (typeof document !== 'undefined') candidates.push(document.activeElement as HTMLElement | null);
    for (const t of candidates) {
      if (!t || typeof t.tagName !== 'string') continue;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
      if (t.isContentEditable) return true;
      const role = t.getAttribute?.('role');
      if (role === 'textbox' || role === 'searchbox' || role === 'combobox') return true;
      // Focus may sit on a node nested inside an editable surface (e.g. the
      // Document Writer's ProseMirror) — treat the whole region as typing.
      if (t.closest?.('input, textarea, select, [role="textbox"], [contenteditable]:not([contenteditable="false"])')) return true;
    }
    return false;
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
  let bg = 'var(--surface-overlay)', border = 'var(--border-default)', dot = 'var(--text-muted)', label = 'STANDBY', Icon = Radio;
  if (!voice.supported) { label = 'NO MIC'; dot = 'var(--text-muted)'; Icon = MicOff; }
  else if (voice.transmitting) { bg = 'rgb(var(--sev-critical-rgb) / 0.25)'; border = 'var(--sev-critical)'; dot = 'var(--sev-critical)'; label = 'ON AIR'; Icon = Mic; }
  else if (voice.activeSpeaker) { bg = 'rgb(var(--sev-ok-rgb) / 0.15)'; border = 'var(--sev-ok)'; dot = 'var(--sev-ok)'; label = `RX · ${voice.activeSpeaker.label}`; Icon = RadioTower; }
  else if (voice.busy) { bg = 'rgb(var(--sev-warn-rgb) / 0.12)'; border = 'var(--accent-silver-400)'; dot = 'var(--accent-silver-400)'; label = 'CHANNEL BUSY'; Icon = Radio; }
  else if (voice.connected) { dot = 'var(--sev-ok)'; label = 'MONITORING'; }
  else { dot = 'var(--accent-silver-400)'; label = 'CONNECTING…'; }

  return (
    <>
      {fieldRecord && <DispatchRecordPanel floating record={fieldRecord} onClose={() => setFieldRecord(null)} />}
    <div
      role="status"
      aria-live="polite"
      className="ptt-pill"
      style={{
        position: 'fixed', right: 12, bottom: 30, zIndex: 9000,
        display: 'flex', alignItems: 'stretch', gap: 0,
        background: bg, border: `1px solid ${border}`,
        borderRadius: 2, userSelect: 'none',
        boxShadow: '0 2px 8px rgba(0 0 0 / 0.5)',
        fontFamily: 'Arial, sans-serif',
        animation: voice.transmitting ? 'rmpg-ptt-pulse 1s ease-in-out infinite' : undefined,
      }}
    >
      {/* Press-to-talk zone — click/touch-hold to transmit (alternative to the key). */}
      <div
        onMouseDown={holdDown}
        onMouseUp={holdUp}
        onMouseLeave={holdUp}
        onTouchStart={(e) => { e.preventDefault(); holdDown(); }}
        onTouchEnd={(e) => { e.preventDefault(); holdUp(); }}
        onTouchCancel={(e) => { e.preventDefault(); holdUp(); }}
        title={`Hold ${keyCodeLabel(prefs.keyCode)} (or click-hold) to transmit on ${channelName}`}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '5px 10px', cursor: 'pointer',
        }}
      >
        <span
          style={{
            width: 8, height: 8, borderRadius: 1, background: dot, flexShrink: 0,
            animation: (voice.transmitting || voice.activeSpeaker) ? 'rmpg-ptt-blink 0.8s ease-in-out infinite' : undefined,
          }}
        />
        <Icon style={{ width: 13, height: 13, color: dot }} aria-hidden />
        {collapsed ? (
          <kbd style={keycapStyle}>{keyCodeLabel(prefs.keyCode)}</kbd>
        ) : (
          <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
            <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.04em', color: 'var(--text-primary)' }}>{label}</span>
            <span style={{ fontSize: 8, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 1 }}>
              {channelName} · {voice.members} on ·
              <kbd style={keycapStyle}>{keyCodeLabel(prefs.keyCode)}</kbd>
              PTT
            </span>
          </span>
        )}
      </div>
      {/* Minimize / expand — separate from the press zone so it never keys the mic. */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); toggleCollapsed(); }}
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        aria-label={collapsed ? 'Expand radio status' : 'Minimize radio status'}
        title={collapsed ? 'Expand radio status' : 'Minimize — tuck the radio status out of the way'}
        style={{
          flexShrink: 0, width: 16, border: 'none', borderLeft: `1px solid ${border}`,
          background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
          fontSize: 11, lineHeight: 1, padding: 0,
        }}
      >
        {collapsed ? '‹' : '›'}
      </button>
    </div>
    </>
  );
}
