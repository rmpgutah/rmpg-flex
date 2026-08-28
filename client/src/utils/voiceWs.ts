// Voice WebSocket endpoint — the ONE place the live-voice URL lives.
//
// Same-origin on rmpgutah.us so the upgrade rides rmpg-api-proxy (LEGACY
// is bound to rmpg-flex-api, which owns VoiceHubDO). Cross-origin
// wss://api.rmpgutah.us dies at the managed challenge.

import { apiWsBase } from './apiOrigin';

export function voiceWsUrl(room: string): string {
  return `${apiWsBase()}/api/voice-ws?room=${encodeURIComponent(room)}`;
}
