import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useFlexCamManifest } from '../../hooks/useFlexCamManifest';
import { FlexCamTripPlayer } from '../../components/flexcam/FlexCamTripPlayer';
import { ChannelSwitcher } from '../../components/flexcam/ChannelSwitcher';

export default function TripPlaybackPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const [channel, setChannel] = useState('outside');
  const { manifest, error, loading } = useFlexCamManifest(Number(tripId), channel);

  if (loading) return <div className="p-4 text-sm opacity-60">Loading manifest…</div>;
  if (error) return <div className="p-4 text-sm text-red-400">Error: {error.message}</div>;
  if (!manifest) return <div className="p-4 text-sm opacity-60">No manifest available.</div>;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide">
          TRIP {tripId} — {Math.round(manifest.totalDurationMs / 60_000)} min
        </h2>
        <ChannelSwitcher channels={['outside']} current={channel} onChange={setChannel} />
      </div>
      <FlexCamTripPlayer manifest={manifest} />
    </div>
  );
}
