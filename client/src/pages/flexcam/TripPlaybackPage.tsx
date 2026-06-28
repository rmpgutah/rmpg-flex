import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ChevronLeft, Clock, Video } from 'lucide-react';
import { useFlexCamManifest } from '../../hooks/useFlexCamManifest';
import { FlexCamTripPlayer } from '../../components/flexcam/FlexCamTripPlayer';
import { ChannelSwitcher } from '../../components/flexcam/ChannelSwitcher';

export default function TripPlaybackPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const navigate = useNavigate();
  const [channel, setChannel] = useState('outside');
  const { manifest, error, loading } = useFlexCamManifest(Number(tripId), channel);

  // Esc returns to the FlexCam list — the page itself has no other
  // dismissable layer, but operators reach this page via deep-link and
  // expect the same "press Esc to back out" affordance the rest of the
  // app provides. Skip while typing in any input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
        return;
      }
      navigate('/flexcam');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  // Header is shared across loading / error / empty / ready states so the
  // operator always has a "back to list" affordance — without it a deep-link
  // landing on a still-downloading trip was a dead-end (browser back only).
  const header = (
    <div className="flex items-center gap-2 mb-3">
      <Link
        to="/flexcam"
        className="flex items-center gap-1 text-[9px] text-rmpg-400 hover:text-brand-400 transition-colors uppercase tracking-wider font-bold"
      >
        <ChevronLeft className="w-3 h-3" />FOOTAGE
      </Link>
      <div className="w-px h-4 bg-border-default" />
      <h2 className="text-sm font-semibold tracking-wide flex-1">
        TRIP {tripId}
        {manifest && ` — ${Math.round(manifest.totalDurationMs / 60_000)} min`}
      </h2>
      {manifest && (
        <ChannelSwitcher channels={['outside']} current={channel} onChange={setChannel} />
      )}
    </div>
  );

  // Distinguish: (1) initial fetch in flight, (2) hard error from the
  // manifest endpoint, (3) manifest exists but the cron has not finished
  // downloading any chunks yet, and (4) manifest is fully unavailable
  // (404 / not yet known to the server). Previously cases 3+4 collapsed
  // into the same "No manifest available." string — leaving operators
  // unsure whether to wait or to chase IT.
  if (loading) {
    return (
      <div className="p-4">
        {header}
        <div className="flex items-center gap-2 text-rmpg-400 text-[11px]">
          <Video className="w-4 h-4 animate-pulse" />Loading manifest…
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-4">
        {header}
        <div className="flex items-start gap-2 text-red-400">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span className="text-[11px]">Error: {error.message}</span>
        </div>
      </div>
    );
  }
  if (!manifest) {
    return (
      <div className="p-4">
        {header}
        <div className="text-rmpg-500 text-[11px]">
          No manifest available for trip {tripId}. The trip may have been
          deleted, or the cron has not yet registered it.
        </div>
      </div>
    );
  }
  if (manifest.clips.length === 0) {
    return (
      <div className="p-4">
        {header}
        <div className="flex items-start gap-2 text-amber-400">
          <Clock className="w-4 h-4 mt-0.5 flex-shrink-0 animate-pulse" />
          <div className="text-[11px]">
            <div className="font-bold uppercase tracking-wider">Trip still downloading</div>
            <div className="text-rmpg-500 mt-0.5">
              {manifest.stillDownloading} chunk{manifest.stillDownloading === 1 ? '' : 's'} pending.
              The manifest auto-refreshes every 10 seconds.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      {header}
      <FlexCamTripPlayer manifest={manifest} />
    </div>
  );
}
