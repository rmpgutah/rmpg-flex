// ============================================================
// ServeJobCard — urgency chrome is gated on OPEN jobs only
// ============================================================
// Regression guard for the "every card in the Served folder screams
// CRITICAL" bug found on the live queue (2026-07-27).
//
// An earlier fix correctly gated the deadline-derived chips (DUE SOON /
// OVERDUE) behind `isOpenJob`, but left the `urgency_tier` badge and the
// red attention ring ungated. Because `urgency_tier` is a stored column
// that is never cleared when a job closes, every served/failed/archived
// card kept rendering a red CRITICAL flame and a red ring forever.
//
// The rule: urgency describes how hard a job is still pushing for
// attention. A resolved job pushes for nothing, so all urgency chrome
// must disappear once it leaves pending/in_progress.
// ============================================================

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ServeJob } from '../../../types';

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue({}),
  authedImageUrl: (u: string) => u,
}));

// ServeReceiptActions pulls in PDF/print machinery that jsdom can't run and
// that has nothing to do with urgency chrome.
vi.mock('../ServeReceiptActions', () => ({ default: () => null }));

import ServeJobCard from '../ServeJobCard';

function makeJob(over: Partial<ServeJob>): ServeJob {
  return {
    id: 1,
    recipient_name: 'SDP Reit, LLC.',
    recipient_address: '1240 East 2100 South',
    recipient_city: 'Salt Lake City',
    recipient_state: 'UT',
    recipient_zip: '84106',
    status: 'pending',
    priority: 'urgent',
    urgency_tier: 'critical',
    time_window: 'anytime',
    document_type: 'Complaint',
    attempts: [],
    ...over,
  } as unknown as ServeJob;
}

const noop = () => {};

function renderCard(job: ServeJob) {
  return render(
    <ServeJobCard
      job={job}
      onAttempt={noop}
      onNavigate={noop}
      onSkipTrace={noop}
      onFlagAddress={noop}
      onEdit={noop}
    />,
  );
}

describe('ServeJobCard urgency chrome', () => {
  it('shows the CRITICAL badge while the job is still open', () => {
    renderCard(makeJob({ status: 'pending' }));
    expect(screen.getByText('CRITICAL')).toBeTruthy();
  });

  it('still shows it for in_progress — that job is very much live', () => {
    renderCard(makeJob({ status: 'in_progress' }));
    expect(screen.getByText('CRITICAL')).toBeTruthy();
  });

  // The actual live-queue bug: every one of these rendered CRITICAL.
  it.each(['served', 'failed', 'archived'] as const)(
    'hides the CRITICAL badge once the job is %s',
    (status) => {
      renderCard(makeJob({ status, closed_at: '2026-07-02 18:00:00' }));
      expect(screen.queryByText('CRITICAL')).toBeNull();
    },
  );

  it('drops the red attention ring on a closed job', () => {
    const { container } = renderCard(
      makeJob({ status: 'served', closed_at: '2026-07-02 18:00:00' }),
    );
    expect(container.querySelector('[class*="ring-red-500"]')).toBeNull();
  });

  it('keeps a non-critical tier visible while open, and drops it when closed', () => {
    const { unmount } = renderCard(makeJob({ status: 'pending', urgency_tier: 'high' }));
    expect(screen.getByText('HIGH')).toBeTruthy();
    unmount();

    renderCard(makeJob({ status: 'served', urgency_tier: 'high' }));
    expect(screen.queryByText('HIGH')).toBeNull();
  });

  it('never renders a tier chip for the normal tier', () => {
    renderCard(makeJob({ status: 'pending', urgency_tier: 'normal' }));
    expect(screen.queryByText('NORMAL')).toBeNull();
  });
});
