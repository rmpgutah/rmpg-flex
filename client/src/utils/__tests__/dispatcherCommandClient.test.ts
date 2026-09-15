import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../hooks/useApi', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../../hooks/useApi';
import { runDispatcherCommand, hasPendingConfirmation, clearPendingConfirmation, isAffirmative, isNegative } from '../dispatcherCommandClient';
import { mergeNotes } from '../callNotes';

const mockFetch = apiFetch as unknown as ReturnType<typeof vi.fn>;

function planResponse(over: Partial<Record<string, unknown>> = {}) {
  return {
    ok: true, log_id: 77, intent: 'assign_units', reply: 'Dispatch 12 to CFS26-0042.',
    steps: [
      { kind: 'http', method: 'POST', path: '/dispatch/calls/7/dispatch', body: { unit_ids: [3] }, summary: 'Dispatch 12 to CFS26-0042', destructive: false },
      { kind: 'client', action: 'refresh', payload: {}, summary: 'Refresh board' },
    ],
    needs_confirmation: false, planner: 'rules', latency_ms: 5,
    ...over,
  };
}

beforeEach(() => { mockFetch.mockReset(); clearPendingConfirmation(); });

describe('runDispatcherCommand — execution', () => {
  it('posts the text with context, executes http steps in order, reports results, returns client actions', async () => {
    mockFetch.mockResolvedValueOnce(planResponse());   // /dispatcher/command
    mockFetch.mockResolvedValueOnce({});                // POST /dispatch/calls/7/dispatch
    mockFetch.mockResolvedValueOnce({ ok: true });      // result report

    const out = await runDispatcherCommand('assign 12 to 42', { source: 'typed', selectedCallNumber: 'CFS26-0099' });

    expect(mockFetch.mock.calls[0][0]).toBe('/dispatcher/command');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ text: 'assign 12 to 42', source: 'typed', context: { selected_call_number: 'CFS26-0099' } });
    expect(mockFetch.mock.calls[1][0]).toBe('/dispatch/calls/7/dispatch');
    expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({ unit_ids: [3] });
    expect(mockFetch.mock.calls[2][0]).toBe('/dispatcher/command/77/result');
    expect(JSON.parse(mockFetch.mock.calls[2][1].body).steps).toEqual([{ index: 0, ok: true, summary: 'Dispatch 12 to CFS26-0042' }]);

    expect(out.handled).toBe(true);
    expect(out.ok).toBe(true);
    expect(out.clientActions).toEqual([{ kind: 'client', action: 'refresh', payload: {}, summary: 'Refresh board' }]);
  });

  it('stops at the first failed write and surfaces the failure in the reply', async () => {
    mockFetch.mockResolvedValueOnce(planResponse({
      steps: [
        { kind: 'http', method: 'POST', path: '/dispatch/calls/7/status', body: { status: 'enroute' }, summary: 'A', destructive: false },
        { kind: 'http', method: 'POST', path: '/dispatch/calls/7/dispatch', body: { unit_ids: [3] }, summary: 'B', destructive: false },
      ],
    }));
    mockFetch.mockRejectedValueOnce(new Error('HTTP 400: DISPOSITION_REQUIRED'));
    mockFetch.mockResolvedValueOnce({ ok: true });

    const out = await runDispatcherCommand('x', { source: 'typed' });
    expect(out.ok).toBe(false);
    expect(out.reply).toContain('FAILED: A — HTTP 400');
    expect(out.results).toEqual([{ index: 0, ok: false, status: 400, summary: 'A', error: 'HTTP 400: DISPOSITION_REQUIRED' }]);
    // B was never attempted; only command + 1 step + result report.
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('append_note is executed client-side via read-merge-PUT', async () => {
    mockFetch.mockResolvedValueOnce(planResponse({
      intent: 'add_note', steps: [{ kind: 'client', action: 'append_note', payload: { call_id: 7, text: 'gate 1234', author: 'Tester' }, summary: 'Note' }],
    }));
    mockFetch.mockResolvedValueOnce({ notes: JSON.stringify([{ id: '1', author: 'A', text: 'old', timestamp: 't' }]) }); // GET call
    mockFetch.mockResolvedValueOnce({});           // PUT
    mockFetch.mockResolvedValueOnce({ ok: true }); // report

    const out = await runDispatcherCommand('note on 42 gate 1234', { source: 'typed' });
    expect(out.ok).toBe(true);
    expect(mockFetch.mock.calls[1][0]).toBe('/dispatch/calls/7');
    expect(mockFetch.mock.calls[2][1].method).toBe('PUT');
    const notes = JSON.parse(JSON.parse(mockFetch.mock.calls[2][1].body).notes);
    expect(notes).toHaveLength(2);
    expect(notes[1]).toMatchObject({ author: 'Tester', text: 'gate 1234' });
    expect(out.clientActions).toEqual([]);
  });

  it('network failure never throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    const out = await runDispatcherCommand('anything', { source: 'speech' });
    expect(out.handled).toBe(true);
    expect(out.ok).toBe(false);
    expect(out.reply).toMatch(/unreachable/);
  });

  it('chatter (no steps, no reply) is reported as not handled so voice can fall through', async () => {
    mockFetch.mockResolvedValueOnce(planResponse({ ok: false, intent: 'chatter', reply: '', steps: [] }));
    const out = await runDispatcherCommand('good morning', { source: 'speech' });
    expect(out.handled).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('clarify returns the question and executes nothing', async () => {
    mockFetch.mockResolvedValueOnce(planResponse({ ok: false, steps: [], reply: 'Disposition for 42?', clarify: 'Disposition for 42?' }));
    const out = await runDispatcherCommand('clear 42', { source: 'typed' });
    expect(out.clarify).toBe('Disposition for 42?');
    expect(out.ok).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('runDispatcherCommand — confirmation turn', () => {
  it('holds the plan, then executes on "yes" with the token', async () => {
    mockFetch.mockResolvedValueOnce(planResponse({ needs_confirmation: true, confirm_token: 'tok-1', reply: 'Confirm: clear? (Y/N)', steps: [] }));
    const first = await runDispatcherCommand('clear 42 unfounded', { source: 'typed' });
    expect(first.needsConfirmation).toBe(true);
    expect(hasPendingConfirmation()).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    mockFetch.mockResolvedValueOnce(planResponse({ confirmed: true, intent: 'set_call_status', steps: [
      { kind: 'http', method: 'POST', path: '/dispatch/calls/7/status', body: { status: 'cleared', disposition: 'unfounded' }, summary: 'CLEAR', destructive: true },
    ] }));
    mockFetch.mockResolvedValueOnce({});
    mockFetch.mockResolvedValueOnce({ ok: true });
    const second = await runDispatcherCommand('Y', { source: 'typed' });
    expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({ confirm_token: 'tok-1', confirmed: true, source: 'typed' });
    expect(mockFetch.mock.calls[2][0]).toBe('/dispatch/calls/7/status');
    expect(second.ok).toBe(true);
    expect(hasPendingConfirmation()).toBe(false);
  });

  it('"no" cancels', async () => {
    mockFetch.mockResolvedValueOnce(planResponse({ needs_confirmation: true, confirm_token: 'tok-2', steps: [] }));
    await runDispatcherCommand('cancel 42 dup', { source: 'speech' });
    mockFetch.mockResolvedValueOnce(planResponse({ confirmed: false, ok: true, reply: 'Cancelled.', steps: [] }));
    const out = await runDispatcherCommand('negative', { source: 'speech' });
    expect(JSON.parse(mockFetch.mock.calls[1][1].body).confirmed).toBe(false);
    expect(out.reply).toBe('Cancelled.');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('an unrelated utterance abandons the pending plan and is sent as a new command', async () => {
    mockFetch.mockResolvedValueOnce(planResponse({ needs_confirmation: true, confirm_token: 'tok-3', steps: [] }));
    await runDispatcherCommand('close 42', { source: 'typed' });
    mockFetch.mockResolvedValueOnce(planResponse({ intent: 'list_pending', steps: [], reply: 'No pending calls.' }));
    await runDispatcherCommand('pending calls', { source: 'typed' });
    expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toMatchObject({ text: 'pending calls' });
    expect(hasPendingConfirmation()).toBe(false);
  });

  it('affirmative / negative vocab', () => {
    for (const w of ['y', 'YES', 'confirm', 'affirmative', '10-4', 'go ahead']) expect(isAffirmative(w)).toBe(true);
    for (const w of ['n', 'No', 'negative', 'disregard', 'never mind']) expect(isNegative(w)).toBe(true);
    expect(isAffirmative('yes clear 42')).toBe(false);
  });
});

describe('mergeNotes', () => {
  it('preserves legacy plain-text notes', () => {
    const out = mergeNotes('old free text', 'new', 'Me', new Date(0));
    expect(out[0]).toMatchObject({ id: 'legacy', text: 'old free text' });
    expect(out[1]).toMatchObject({ author: 'Me', text: 'new' });
  });
  it('appends to an existing JSON array and starts fresh when empty', () => {
    expect(mergeNotes('[{"id":"1","author":"A","text":"a","timestamp":"t"}]', 'b', 'B')).toHaveLength(2);
    expect(mergeNotes(null, 'b', 'B')).toHaveLength(1);
  });
});
