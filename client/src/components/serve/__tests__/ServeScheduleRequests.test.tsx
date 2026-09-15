import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ServeScheduleRequests from '../ServeScheduleRequests';
import type { ServeScheduleRequest } from '../../../types';

const apiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const req = (over: Partial<ServeScheduleRequest> = {}): ServeScheduleRequest => ({
  id: 7, job_id: 1, job_ref: 'JOB-1', preferred_window: 'evening', contact_method: 'phone',
  contact_value: '(385) 555-0100', note: 'Gate code 4411', status: 'pending', created_at: '2026-09-05T18:00:00Z', ...over,
});

beforeEach(() => apiFetch.mockReset());

describe('ServeScheduleRequests', () => {
  it('renders nothing when there are no pending requests', () => {
    const { container } = render(<ServeScheduleRequests requests={[req({ status: 'accepted' })]} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the window, contact and note for a pending request', () => {
    render(<ServeScheduleRequests requests={[req()]} />);
    expect(screen.getByText('Evening (after 5 PM)')).toBeInTheDocument();
    expect(screen.getByText('(385) 555-0100')).toBeInTheDocument();
    expect(screen.getByTitle('Gate code 4411')).toBeInTheDocument();
  });

  it('accepting PATCHes with set_next_attempt_note and refetches', async () => {
    apiFetch.mockResolvedValue({ ok: true });
    const onResolved = vi.fn();
    render(<ServeScheduleRequests requests={[req()]} onResolved={onResolved} />);
    fireEvent.click(screen.getByRole('button', { name: /accept/i }));
    await waitFor(() => expect(onResolved).toHaveBeenCalled());
    expect(apiFetch).toHaveBeenCalledWith('/serve/schedule-requests/7', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ status: 'accepted', set_next_attempt_note: true }),
    }));
  });

  it('declining PATCHes without touching the next-attempt note', async () => {
    apiFetch.mockResolvedValue({ ok: true });
    render(<ServeScheduleRequests requests={[req()]} />);
    fireEvent.click(screen.getByRole('button', { name: /decline/i }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(JSON.parse((apiFetch.mock.calls[0][1] as { body: string }).body)).toEqual({ status: 'declined', set_next_attempt_note: false });
  });
});
