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

function renderCard(job: ServeJob, isExpanded = false) {
  return render(
    <ServeJobCard
      job={job}
      isExpanded={isExpanded}
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
    const { unmount } = renderCard(makeJob({ status: 'pending', urgency_tier: 'tight' }));
    expect(screen.getByText('TIGHT')).toBeTruthy();
    unmount();

    renderCard(makeJob({ status: 'served', urgency_tier: 'tight' }));
    expect(screen.queryByText('TIGHT')).toBeNull();
  });

  it('never renders a tier chip for the standard tier', () => {
    renderCard(makeJob({ status: 'pending', urgency_tier: 'standard' }));
    expect(screen.queryByText('STANDARD')).toBeNull();
  });

  it('shows venue overlay from parsed_data on the card', () => {
    renderCard(makeJob({
      parsed_data: JSON.stringify({
        _intake: {
          address_class: { klass: 'corporate', confirmed: true },
          venue: 'medical_hospice',
          output_tree: { venue_label: 'Medical / Hospice', fired_ids: ['venue.medical_hospice'] },
        },
        _ops: { no_sunday: true },
      }),
    }));
    expect(screen.getByText('Medical / Hospice')).toBeTruthy();
    expect(screen.getByText('NO SUN')).toBeTruthy();
  });
});

// ── Diligence panel visibility ────────────────────────────────────────────
// The panel was originally gated on `isOpenJob` (pending || in_progress).
// That is backwards for the case that matters most: the Affidavit of
// Non-Service is built from the diligence chain, and non-service jobs are
// exactly the ones whose status is failed/attempted. On the live queue —
// 0 pending, 0 in-progress — the gate meant the panel never rendered at all.
describe('DiligencePanel visibility', () => {
  const withAttempts = (status: string) =>
    makeJob({
      status: status as ServeJob['status'],
      attempts: [
        { id: 1, attempt_number: 1, attempt_at: '2026-07-20 15:00:00', result: 'no_answer' },
        { id: 2, attempt_number: 2, attempt_at: '2026-07-22 01:00:00', result: 'no_answer' },
      ] as unknown as ServeJob['attempts'],
    });

  it.each(['pending', 'in_progress', 'failed', 'attempted'] as const)(
    'renders the diligence record for a %s job',
    (status) => {
      renderCard(withAttempts(status), true);
      expect(screen.getByText('Diligence')).toBeTruthy();
    },
  );

  it('hides it once the job is served — the chain is history, not evidence in progress', () => {
    renderCard(withAttempts('served'), true);
    expect(screen.queryByText('Diligence')).toBeNull();
  });

  it('shows nothing when there are no attempts to assess', () => {
    renderCard(makeJob({ status: 'pending', attempts: [] }), true);
    expect(screen.queryByText('Diligence')).toBeNull();
  });
});
