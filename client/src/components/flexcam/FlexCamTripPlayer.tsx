import { useRef, useState } from 'react';
import type { TripPlayerManifest } from '../../hooks/useFlexCamManifest';
import { TripTimeline } from './TripTimeline';

interface Props { manifest: TripPlayerManifest; }

export function FlexCamTripPlayer({ manifest }: Props) {
  const [clipIndex, setClipIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  if (manifest.clips.length === 0) {
    return <div className="p-4 text-sm opacity-60">No footage available for this trip yet.</div>;
  }

  const current = manifest.clips[clipIndex];

  const handleEnded = () => {
    if (clipIndex + 1 < manifest.clips.length) {
      setClipIndex(clipIndex + 1);
    }
  };

  const handleSeek = (targetIndex: number, offsetMs: number) => {
    setClipIndex(targetIndex);
    requestAnimationFrame(() => {
      if (videoRef.current) {
        videoRef.current.currentTime = offsetMs / 1000;
        void videoRef.current.play();
      }
    });
  };

  return (
    <div className="space-y-2">
      <video
        ref={videoRef}
        src={current.url}
        autoPlay
        controls
        onEnded={handleEnded}
        className="w-full max-h-[60vh] bg-black"
      />
      <TripTimeline
        clips={manifest.clips}
        gaps={manifest.gaps}
        currentClipIndex={clipIndex}
        currentOffsetMs={0}
        onSeek={handleSeek}
      />
      {manifest.stillDownloading > 0 && (
        <div className="text-xs text-brand-400">Footage still arriving — {manifest.stillDownloading} chunks pending</div>
      )}
    </div>
  );
}
