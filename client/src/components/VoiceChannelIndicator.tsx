// ============================================================
// VoiceChannelIndicator — Floating voice channel state overlay
//
// Shows mic button, state badges, transcript, command results,
// and errors in the bottom-right corner of the screen.
// ============================================================

import { useVoiceChannel } from '../hooks/useVoiceChannel';

export default function VoiceChannelIndicator() {
  const { state, transcript, lastCommand, error, activateManualListen, enabled } = useVoiceChannel();

  if (!enabled) return null;

  const isIdle = state === 'idle';
  const hasOverlay = !isIdle || error || lastCommand;

  // Idle with nothing to show — render only the mic button
  if (isIdle && !error && !lastCommand && !transcript) {
    return (
      <div className="fixed bottom-8 right-4 z-[9999]">
        <button
          onClick={activateManualListen}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#1a2636] border border-[#2a3a4e] rounded text-gray-400 hover:border-[#1a5a9e] hover:text-white transition-colors text-xs font-mono"
          title="Voice channel — press V"
        >
          <MicIcon />
          <span>V</span>
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-8 right-4 z-[9999] flex flex-col items-end gap-2 max-w-xs">
      {/* State badge */}
      {!isIdle && <StateBadge state={state} onClickMic={activateManualListen} />}

      {/* Idle mic button when there's an error or command showing */}
      {isIdle && hasOverlay && (
        <button
          onClick={activateManualListen}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#1a2636] border border-[#2a3a4e] rounded text-gray-400 hover:border-[#1a5a9e] hover:text-white transition-colors text-xs font-mono"
          title="Voice channel — press V"
        >
          <MicIcon />
          <span>V</span>
        </button>
      )}

      {/* Transcript */}
      {transcript && (
        <div className="bg-[#1a2636] border border-[#2a3a4e] rounded px-3 py-2 text-xs font-mono text-green-400 max-w-xs break-words">
          {transcript}
        </div>
      )}

      {/* Command result */}
      {lastCommand && (
        <div
          className={`bg-[#1a2636] rounded px-3 py-2 text-xs font-mono max-w-xs break-words border ${
            lastCommand.success ? 'border-green-600 text-green-400' : 'border-red-600 text-red-400'
          }`}
        >
          <div className="font-semibold">{lastCommand.action}</div>
          <div className="mt-0.5 text-gray-300">{lastCommand.message}</div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-[#1a2636] border border-red-600 rounded px-3 py-2 text-xs font-mono text-red-400 max-w-xs break-words">
          {error}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────

function StateBadge({ state, onClickMic }: { state: string; onClickMic: () => void }) {
  const config: Record<string, { label: string; bg: string; hint?: string; pulse?: boolean }> = {
    alerting: { label: 'ALERT', bg: 'bg-red-600' },
    listening: { label: 'LISTENING', bg: 'bg-green-600', hint: 'Press V or speak', pulse: true },
    processing: { label: 'PROCESSING', bg: 'bg-yellow-600' },
    responding: { label: 'RESPONSE', bg: 'bg-blue-600' },
  };

  const c = config[state];
  if (!c) return null;

  return (
    <div className="flex items-center gap-2">
      {state === 'listening' && (
        <button
          onClick={onClickMic}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#1a2636] border border-green-600 rounded text-green-400 hover:text-white transition-colors text-xs font-mono"
          title="Extend listen window"
        >
          <MicIcon />
        </button>
      )}
      <div className="flex items-center gap-2">
        <span
          className={`${c.bg} text-white text-xs font-mono uppercase tracking-wider px-2.5 py-1 rounded flex items-center gap-1.5`}
        >
          {c.pulse && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-300 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-200" />
            </span>
          )}
          {c.label}
        </span>
        {c.hint && <span className="text-[10px] text-gray-500 font-mono">{c.hint}</span>}
      </div>
    </div>
  );
}

function MicIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
        clipRule="evenodd"
      />
    </svg>
  );
}
