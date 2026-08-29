// ============================================================
// EditServeAttemptModal — timezone round-trip regression
// ============================================================
// Regression guard for the "Notice of Attempt prints the wrong time" bug:
// the modal used to write the officer's Mountain-Time wall-clock straight
// into `attempt_at` with no zone marker, while every reader (parseTimestamp)
// treats a naive timestamp as UTC. A 07:35 MDT attempt therefore came back
// as 01:35 on the printed Notice of Attempt — a silent -6h shift.
//
// Storage contract: `attempt_at` is naive UTC ("YYYY-MM-DD HH:MM:SS").
// The input shows MT wall-clock; the save must convert MT -> UTC.
// ============================================================

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ServeAttempt } from '../../../types';

const apiFetchMock = vi.fn().mockResolvedValue({});
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
  authedImageUrl: (u: string) => u,
}));

function mockApiFetchDefault() {
  apiFetchMock.mockImplementation(async (path: unknown) => {
    if (typeof path === 'string' && path.includes('/file-folders')) {
      return { queue_id: 88, intake: [], folders: [] };
    }
    return {};
  });
}
mockApiFetchDefault();

import EditServeAttemptModal from '../EditServeAttemptModal';

const attempt = {
  id: 85,
  attempt_number: 1,
  // Stored UTC — the same instant as 07:35 MDT.
  attempt_at: '2026-07-27 13:35:00',
  attempt_type: 'failed',
  disposition_code: '',
  notes: '',
  result: 'no_answer',
} as unknown as ServeAttempt;

/** The save PUT, ignoring useFormDraft's own /form-drafts traffic. */
function savedBody(): Record<string, unknown> {
  const call = apiFetchMock.mock.calls.find(
    (c) => typeof c[0] === 'string' && (c[0] as string).includes('/attempt/'),
  );
  if (!call) throw new Error('save PUT was never issued');
  return JSON.parse((call[1] as { body: string }).body);
}

function renderModal() {
  return render(
    <EditServeAttemptModal
      isOpen
      onClose={() => {}}
      queueId={88}
      attempt={attempt}
      onSaved={() => {}}
    />,
  );
}

describe('EditServeAttemptModal — attempt_at timezone round-trip', () => {
  beforeEach(() => {
    apiFetchMock.mockClear();
    mockApiFetchDefault();
    localStorage.clear();
  });

  it('shows the stored UTC timestamp as Mountain-Time wall-clock', () => {
    renderModal();
    const input = screen.getByLabelText(/attempted at/i) as HTMLInputElement;
    // 13:35Z on 2026-07-27 is 07:35 MDT (UTC-6).
    expect(input.value).toBe('2026-07-27T07:35');
  });

  it('converts the edited Mountain-Time value back to UTC on save', async () => {
    renderModal();
    const input = screen.getByLabelText(/attempted at/i);
    fireEvent.change(input, { target: { value: '2026-07-27T09:15' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(savedBody).not.toThrow());
    // 09:15 MDT -> 15:15 UTC. NOT the raw wall-clock "2026-07-27 09:15:00".
    expect(savedBody().attempt_at).toBe('2026-07-27 15:15:00');
  });

  it('round-trips a value unchanged when the operator does not touch it', async () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(savedBody).not.toThrow());
    expect(savedBody().attempt_at).toBe('2026-07-27 13:35:00');
  });
});

// ── Scroll containment ──────────────────────────────────────
// The modal previously had no height cap and no scroll container, so on a
// 600px-tall screen (Toughbook landscape, phone) the footer rendered 138px
// BELOW the viewport with a non-scrollable body -- the officer could open the
// modal, edit the timestamp, and have no reachable Save button. Verified in a
// real layout engine; jsdom has no layout, so these assert the structure that
// produces the behavior rather than measured geometry.
describe('EditServeAttemptModal — scroll containment', () => {
  beforeEach(() => {
    apiFetchMock.mockClear();
    mockApiFetchDefault();
    localStorage.clear();
  });

  it('caps the panel height and lays it out as a flex column', () => {
    renderModal();
    const panel = document.querySelector('.panel-beveled') as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.className).toContain('max-h-[90vh]');
    expect(panel.className).toContain('flex-col');
  });

  it('gives the body its own scroll container so the footer stays reachable', () => {
    renderModal();
    const panel = document.querySelector('.panel-beveled') as HTMLElement;
    const scroller = panel.querySelector('.overflow-y-auto') as HTMLElement;
    expect(scroller).toBeTruthy();
    // The timestamp field must live INSIDE the scrolling region, not above it.
    expect(scroller.querySelector('#edit-attempt-at')).toBeTruthy();
    expect(scroller.className).toContain('flex-1');
  });

  it('keeps the action row out of the scrolling region', () => {
    renderModal();
    const save = screen.getByRole('button', { name: /save/i });
    const footer = save.parentElement as HTMLElement;
    expect(footer.className).toContain('shrink-0');
    expect(footer.closest('.overflow-y-auto')).toBeNull();
  });
});
