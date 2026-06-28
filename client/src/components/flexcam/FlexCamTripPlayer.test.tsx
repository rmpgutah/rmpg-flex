import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { FlexCamTripPlayer } from './FlexCamTripPlayer';
import type { TripPlayerManifest } from '../../hooks/useFlexCamManifest';

const manifest: TripPlayerManifest = {
  tripId: 1, channel: 'outside', totalDurationMs: 80_000, stillDownloading: 0,
  clips: [
    { seq: 0, fromTs: 1_000_000, toTs: 1_040_000, durationMs: 40_000, url: '/clip-a.mp4', sha256: null, bytes: 1 },
    { seq: 1, fromTs: 1_040_000, toTs: 1_080_000, durationMs: 40_000, url: '/clip-b.mp4', sha256: null, bytes: 1 },
  ],
  gaps: [],
};

describe('<FlexCamTripPlayer>', () => {
  it('renders the active <video> pointing at the first clip', () => {
    const { container } = render(<FlexCamTripPlayer manifest={manifest} />);
    const videos = container.querySelectorAll('video');
    expect(videos.length).toBeGreaterThanOrEqual(1);
    expect(videos[0].getAttribute('src')).toBe('/clip-a.mp4');
  });

  it('shows "no footage" when manifest.clips is empty', () => {
    render(<FlexCamTripPlayer manifest={{ ...manifest, clips: [] }} />);
    expect(screen.getByText(/no footage/i)).toBeInTheDocument();
  });

  it('advances to next clip when active video fires onEnded', () => {
    const { container } = render(<FlexCamTripPlayer manifest={manifest} />);
    const active = container.querySelector('video') as HTMLVideoElement;
    act(() => { fireEvent.ended(active); });
    const after = container.querySelector('video') as HTMLVideoElement;
    expect(after.getAttribute('src')).toBe('/clip-b.mp4');
  });
});
