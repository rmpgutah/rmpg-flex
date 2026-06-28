import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { TripTimeline, resolveSeek } from './TripTimeline';

const clips = [
  { seq: 0, fromTs: 1_000_000, toTs: 1_040_000, durationMs: 40_000, url: 'a', sha256: null, bytes: 1 },
  { seq: 1, fromTs: 1_050_000, toTs: 1_090_000, durationMs: 40_000, url: 'b', sha256: null, bytes: 1 },
];
const gaps = [{ startTs: 1_040_000, endTs: 1_050_000, durationMs: 10_000 }];

describe('resolveSeek', () => {
  it('resolves a click in clip 0', () => {
    const r = resolveSeek(clips, gaps, 0.1); // ~10% of total span (~9000ms in)
    expect(r.clipIndex).toBe(0);
    expect(typeof r.offsetMs).toBe('number');
  });
  it('resolves a click on a gap by jumping to next clip start', () => {
    const r = resolveSeek(clips, gaps, 0.5); // mid-gap (around 45000ms in)
    expect(r.clipIndex).toBe(1);
    expect(r.offsetMs).toBe(0);
  });
  it('clamps past-end clicks to last clip last frame', () => {
    const r = resolveSeek(clips, gaps, 2.0); // 2x past the end
    expect(r.clipIndex).toBe(1);
    expect(r.offsetMs).toBe(40_000);
  });
});

describe('<TripTimeline>', () => {
  it('renders one block per clip + one block per gap', () => {
    const { container } = render(
      <TripTimeline clips={clips} gaps={gaps} currentClipIndex={0} currentOffsetMs={0} onSeek={vi.fn()} />
    );
    expect(container.querySelectorAll('[data-clip-seq]').length).toBe(2);
    expect(container.querySelectorAll('[data-gap]').length).toBe(1);
  });

  it('calls onSeek with resolved (clipIndex, offsetMs)', () => {
    const onSeek = vi.fn();
    const { container } = render(
      <TripTimeline clips={clips} gaps={gaps} currentClipIndex={0} currentOffsetMs={0} onSeek={onSeek} />
    );
    const root = container.firstChild as HTMLElement;
    // jsdom doesn't lay out — stub getBoundingClientRect
    root.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 1000, bottom: 30, width: 1000, height: 30, x: 0, y: 0, toJSON: () => ({}),
    });
    fireEvent.click(root, { clientX: 100 });
    expect(onSeek).toHaveBeenCalled();
  });

  it('shows "no footage" when empty', () => {
    const { getByText } = render(
      <TripTimeline clips={[]} gaps={[]} currentClipIndex={0} currentOffsetMs={0} onSeek={vi.fn()} />
    );
    expect(getByText(/no footage/i)).toBeInTheDocument();
  });
});
