// Voice WebSocket endpoint — the ONE place the live-voice URL lives.
//
// The voice socket connects DIRECTLY to the rewrite worker's custom
// domain (api.rmpgutah.us), not via window.location.host. Going through
// the zone proxy would route /api/voice-ws to the legacy worker, which
// has no VoiceHubDO. CSP connect-src already allows `wss:` +
// api.rmpgutah.us, so the direct cross-origin upgrade is permitted.
//
// `room` is radio-<channelId> or panic-<panicId>.
export function voiceWsUrl(room: string): string {
  const host = window.location.hostname;
  const base = (host === 'localhost' || host === '127.0.0.1')
    ? `ws://${host}:8787`           // wrangler dev
    : 'wss://api.rmpgutah.us';      // rewrite worker, direct
  return `${base}/api/voice-ws?room=${encodeURIComponent(room)}`;
}
