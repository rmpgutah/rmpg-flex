// ServeAttemptModal — GPS acquisition must reuse the app-wide tracker fix.
// On Toughbook, navigator.geolocation.getCurrentPosition times out while the
// status bar already shows GPS ON from useGpsTracking (internal u-blox reader).

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ServeJob } from '../../../types';

const navTripGps = {
  latitude: 40.570123,
  longitude: -111.877456,
  accuracy: 8,
  isTracking: true,
};

vi.mock('../../../context/NavTripContext', () => ({
  useNavTrip: () => ({ gps: navTripGps }),
}));

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue({ data: null }),
  apiPostForm: vi.fn(),
  authedImageUrl: (u: string) => u,
}));

vi.mock('../../SignaturePad', () => ({ default: () => null }));
vi.mock('../ServeReceiptActions', () => ({ default: () => null }));
vi.mock('../../RichTextArea', () => ({
  default: (props: { value?: string; onChange?: (v: string) => void }) => (
    <textarea aria-label="notes" value={props.value ?? ''} onChange={(e) => props.onChange?.(e.target.value)} />
  ),
}));

import ServeAttemptModal from '../ServeAttemptModal';

function makeJob(): ServeJob {
  return {
    id: 42,
    recipient_name: 'Patrick I Haro',
    recipient_address: '745 East Village Way',
    recipient_city: 'Sandy',
    recipient_state: 'UT',
    recipient_zip: '84094',
    status: 'in_progress',
    priority: 'normal',
    attempt_count: 1,
    attempts: [],
    latitude: 40.5701,
    longitude: -111.8770,
  } as unknown as ServeJob;
}

describe('ServeAttemptModal — GPS from app-wide tracker', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })));
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: {
        getCurrentPosition: vi.fn(),
        watchPosition: vi.fn(),
        clearWatch: vi.fn(),
      },
    });
  });

  it('shows coordinates immediately from NavTrip GPS without waiting on getCurrentPosition', async () => {
    render(
      <ServeAttemptModal
        isOpen
        onClose={() => {}}
        job={makeJob()}
        onSubmit={vi.fn().mockResolvedValue({})}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('40.570123')).toBeTruthy();
    });
    expect(screen.queryByText(/acquiring gps position/i)).toBeNull();
    expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /confirm location/i })).not.toBeDisabled();
  });
});
