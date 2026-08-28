import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import IconButton from '../IconButton';
import { formatAudioClock } from '../../utils/formatAudioClock';

interface InlineAudioPlayerProps {
  src: string;
  title?: string;
}

/**
 * In-portal MP3/WAV player. Fetches with the session Authorization header,
 * plays from a blob URL (CSP media-src blob:), and never navigates to a
 * download. The native download affordance is omitted on purpose.
 */
export default function InlineAudioPlayer({ src, title }: InlineAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);

  const releaseBlob = () => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  };

  const ensureLoaded = useCallback(async () => {
    if (blobUrlRef.current && audioRef.current?.src) return;
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('rmpg_token') || '';
      const res = await fetch(src, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'X-Requested-With': 'XMLHttpRequest',
        },
      });
      if (!res.ok) throw new Error(`Audio failed (${res.status})`);
      const blob = await res.blob();
      const typed = blob.type && blob.type.startsWith('audio/')
        ? blob
        : new Blob([await blob.arrayBuffer()], { type: 'audio/mpeg' });
      releaseBlob();
      const url = URL.createObjectURL(typed);
      blobUrlRef.current = url;
      if (!audioRef.current) audioRef.current = new Audio();
      const el = audioRef.current;
      el.preload = 'metadata';
      el.src = url;
      await new Promise<void>((resolve, reject) => {
        const onReady = () => { el.removeEventListener('error', onErr); resolve(); };
        const onErr = () => { el.removeEventListener('loadedmetadata', onReady); reject(new Error('Could not decode audio')); };
        el.addEventListener('loadedmetadata', onReady, { once: true });
        el.addEventListener('error', onErr, { once: true });
        el.load();
      });
      setDuration(Number.isFinite(el.duration) ? el.duration : 0);
      setReady(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Playback failed');
    } finally {
      setLoading(false);
    }
  }, [src]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      releaseBlob();
    };
  }, []);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setElapsed(el.currentTime);
    const onEnd = () => setPlaying(false);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('ended', onEnd);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('ended', onEnd);
    };
  }, [ready]);

  const togglePlay = async () => {
    await ensureLoaded();
    const el = audioRef.current;
    if (!el || error) return;
    if (playing) {
      el.pause();
      setPlaying(false);
      return;
    }
    try {
      await el.play();
      setPlaying(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Playback blocked');
    }
  };

  const seek = (value: number) => {
    const el = audioRef.current;
    if (!el || !ready) return;
    el.currentTime = value;
    setElapsed(value);
  };

  const toggleMute = () => {
    const el = audioRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setMuted(el.muted);
  };

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 bg-surface-sunken border border-border-subtle min-w-0">
      <IconButton
        aria-label={playing ? `Pause ${title || 'recording'}` : `Play ${title || 'recording'}`}
        onClick={() => { void togglePlay(); }}
        disabled={loading}
        className="shrink-0 w-8 h-8 flex items-center justify-center bg-surface-raised border border-border-subtle text-text-primary hover:border-accent-silver-400 disabled:opacity-40"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : playing ? <Pause size={14} /> : <Play size={14} />}
      </IconButton>
      <Volume2 size={12} className="text-text-secondary shrink-0 hidden sm:block" />
      <div className="flex-1 min-w-0">
        {title && <div className="text-[10px] text-text-primary truncate">{title}</div>}
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={elapsed}
          disabled={!ready}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Seek"
          className="w-full h-1 accent-silver-400 cursor-pointer disabled:opacity-40"
        />
        <div className="flex justify-between text-[9px] font-mono text-text-secondary">
          <span>{formatAudioClock(elapsed)}</span>
          <span>{formatAudioClock(duration)}</span>
        </div>
      </div>
      <IconButton
        aria-label={muted ? 'Unmute' : 'Mute'}
        onClick={toggleMute}
        className="shrink-0 w-7 h-7 flex items-center justify-center text-text-secondary hover:text-text-primary"
      >
        {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
      </IconButton>
      {error && <span className="text-[9px] text-red-400 shrink-0 max-w-[9rem] truncate">{error}</span>}
    </div>
  );
}
