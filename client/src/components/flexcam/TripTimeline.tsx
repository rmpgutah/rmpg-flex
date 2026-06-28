import React from 'react';
import type { PlayerClip, PlayerGap } from '../../hooks/useFlexCamManifest';

interface Props {
  clips: PlayerClip[];
  gaps: PlayerGap[];
  currentClipIndex: number;
  currentOffsetMs: number;
  onSeek: (clipIndex: number, offsetMs: number) => void;
}

export function resolveSeek(clips: PlayerClip[], gaps: PlayerGap[], fraction: number): { clipIndex: number; offsetMs: number } {
  if (clips.length === 0) return { clipIndex: 0, offsetMs: 0 };
  const totalSpan = clips[clips.length - 1].toTs - clips[0].fromTs;
  if (totalSpan <= 0) return { clipIndex: 0, offsetMs: 0 };
  const startTs = clips[0].fromTs;
  const clamped = Math.max(0, Math.min(1, fraction));
  const targetTs = startTs + clamped * totalSpan;

  for (let i = 0; i < clips.length; i++) {
    if (targetTs <= clips[i].toTs) {
      if (targetTs >= clips[i].fromTs) {
        return { clipIndex: i, offsetMs: targetTs - clips[i].fromTs };
      }
      // We're in a gap before clips[i] — jump to its start
      return { clipIndex: i, offsetMs: 0 };
    }
  }
  // Past the end — last clip, last frame
  return { clipIndex: clips.length - 1, offsetMs: clips[clips.length - 1].durationMs };
}

export function TripTimeline({ clips, gaps, currentClipIndex, onSeek }: Props) {
  if (clips.length === 0) {
    return <div className="text-sm opacity-60">No footage</div>;
  }
  const totalSpan = clips[clips.length - 1].toTs - clips[0].fromTs;
  const startTs = clips[0].fromTs;

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = (e.clientX - rect.left) / rect.width;
    const { clipIndex, offsetMs } = resolveSeek(clips, gaps, fraction);
    onSeek(clipIndex, offsetMs);
  };

  return (
    <div className="relative h-8 bg-surface-raised rounded-[2px] cursor-pointer select-none" onClick={handleClick}>
      {clips.map((c, i) => {
        const left = ((c.fromTs - startTs) / totalSpan) * 100;
        const width = (c.durationMs / totalSpan) * 100;
        const active = i === currentClipIndex;
        return (
          <div
            key={c.seq}
            data-clip-seq={c.seq}
            className={`absolute top-0 bottom-0 ${active ? 'bg-brand-500' : 'bg-brand-700'}`}
            style={{ left: `${left}%`, width: `${width}%` }}
          />
        );
      })}
      {gaps.map((g) => {
        const left = ((g.startTs - startTs) / totalSpan) * 100;
        const width = (g.durationMs / totalSpan) * 100;
        return (
          <div
            key={`g-${g.startTs}`}
            data-gap
            className="absolute top-0 bottom-0 bg-red-700 opacity-60"
            style={{ left: `${left}%`, width: `${width}%` }}
            title={`GAP — ${Math.round(g.durationMs / 1000)}s`}
          />
        );
      })}
    </div>
  );
}
