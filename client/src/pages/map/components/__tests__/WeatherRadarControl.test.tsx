import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WeatherRadarControl from '../WeatherRadarControl';
import type { UseMapWeatherRadarResult } from '../../../../hooks/useMapWeatherRadar';

// 2026-08-02 14:00 America/Denver = 20:00Z (MDT, UTC-6).
const NOW_MS = Date.UTC(2026, 7, 2, 20, 0, 0);
const PAST_A = NOW_MS / 1000 - 600; // 10 min ago
const PAST_B = NOW_MS / 1000;       // now
const FUTURE = NOW_MS / 1000 + 600; // +10 min nowcast

function makeRadar(over: Partial<UseMapWeatherRadarResult> = {}): UseMapWeatherRadarResult {
  const frames = [
    { time: PAST_A, path: '/a', kind: 'past' as const },
    { time: PAST_B, path: '/b', kind: 'past' as const },
    { time: FUTURE, path: '/c', kind: 'nowcast' as const },
  ];
  return {
    enabled: true,
    toggle: vi.fn(),
    setEnabled: vi.fn(),
    opacity: 0.6,
    setOpacity: vi.fn(),
    frames,
    frameIndex: 1,
    setFrameIndex: vi.fn(),
    playing: false,
    play: vi.fn(),
    pause: vi.fn(),
    togglePlay: vi.fn(),
    resumeLive: vi.fn(),
    live: true,
    activeFrame: frames[1],
    lastPolledAt: new Date(NOW_MS), // new-date-ok — NOW_MS is an epoch number from Date.UTC
    error: false,
    loading: false,
    ...over,
  };
}

describe('WeatherRadarControl', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
  });
  afterEach(() => vi.useRealTimers());

  it('shows the displayed frame time, its age, and the frame position', () => {
    render(<WeatherRadarControl radar={makeRadar()} />);
    expect(screen.getByText('2:00 PM')).toBeInTheDocument(); // America/Denver
    expect(screen.getByText('now')).toBeInTheDocument();
    expect(screen.getByText('2/3')).toBeInTheDocument();
  });

  it('labels an observed frame OBSERVED and a nowcast frame FORECAST', () => {
    const { unmount } = render(<WeatherRadarControl radar={makeRadar()} />);
    expect(screen.getByText('OBSERVED')).toBeInTheDocument();
    unmount();

    const radar = makeRadar();
    render(<WeatherRadarControl radar={makeRadar({ frameIndex: 2, activeFrame: radar.frames[2], live: false })} />);
    // A prediction must be visually distinguished — an operator staging on a
    // storm cell cannot be shown a forecast labelled as an observation.
    expect(screen.getByText('FORECAST')).toBeInTheDocument();
    expect(screen.getByText('+10 min')).toBeInTheDocument();
  });

  it('offers "back to live" only when scrubbed off the live frame', () => {
    const { unmount } = render(<WeatherRadarControl radar={makeRadar({ live: true })} />);
    expect(screen.queryByText('back to live')).not.toBeInTheDocument();
    unmount();

    const resumeLive = vi.fn();
    render(<WeatherRadarControl radar={makeRadar({ live: false, resumeLive })} />);
    fireEvent.click(screen.getByText('back to live'));
    expect(resumeLive).toHaveBeenCalled();
  });

  it('toggles playback and swaps the button label between play and pause', () => {
    const togglePlay = vi.fn();
    const { unmount } = render(<WeatherRadarControl radar={makeRadar({ togglePlay })} />);
    fireEvent.click(screen.getByLabelText('Play radar animation'));
    expect(togglePlay).toHaveBeenCalled();
    unmount();

    render(<WeatherRadarControl radar={makeRadar({ playing: true })} />);
    expect(screen.getByLabelText('Pause radar animation')).toBeInTheDocument();
  });

  it('scrubs the timeline to the selected frame', () => {
    const setFrameIndex = vi.fn();
    render(<WeatherRadarControl radar={makeRadar({ setFrameIndex })} />);
    const slider = screen.getByLabelText('Radar frame timeline') as HTMLInputElement;
    expect(slider.max).toBe('2');
    fireEvent.change(slider, { target: { value: '0' } });
    expect(setFrameIndex).toHaveBeenCalledWith(0);
  });

  it('drives opacity and shows it as a percentage', () => {
    const setOpacity = vi.fn();
    render(<WeatherRadarControl radar={makeRadar({ setOpacity })} />);
    expect(screen.getByText('60%')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Radar overlay opacity'), { target: { value: '0.9' } });
    expect(setOpacity).toHaveBeenCalledWith(0.9);
  });

  it('disables playback controls when there is only one frame', () => {
    const only = [{ time: PAST_B, path: '/b', kind: 'past' as const }];
    render(<WeatherRadarControl radar={makeRadar({ frames: only, frameIndex: 0, activeFrame: only[0] })} />);
    expect(screen.getByLabelText('Play radar animation')).toBeDisabled();
    expect(screen.getByLabelText('Radar frame timeline')).toBeDisabled();
  });

  it('says the feed is down instead of showing a stale timestamp as current', () => {
    render(<WeatherRadarControl radar={makeRadar({ error: true })} />);
    expect(screen.getByText(/feed down/)).toBeInTheDocument();
    expect(screen.queryByText('2:00 PM')).not.toBeInTheDocument();
  });

  it('shows a loading state before the first frames arrive', () => {
    render(<WeatherRadarControl radar={makeRadar({ frames: [], activeFrame: null, loading: true, frameIndex: -1 })} />);
    expect(screen.getByText(/loading/)).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders the intensity legend', () => {
    render(<WeatherRadarControl radar={makeRadar()} />);
    ['Light', 'Moderate', 'Heavy', 'Intense', 'Extreme'].forEach((label) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });
});
