import { describe, test, expect } from 'vitest';
import { INITIAL, reduce, type SoftphoneSnapshot } from './softphoneMachine';

const at = (s: SoftphoneSnapshot, ...events: Parameters<typeof reduce>[1][]) => events.reduce(reduce, s);

describe('softphone reducer', () => {
  test('registers and becomes ready', () => {
    const s = at(INITIAL, { type: 'REGISTERING' }, { type: 'REGISTERED' });
    expect(s.status).toBe('ready');
    expect(s.error).toBeNull();
  });

  test('inbound call: incoming → in_call with caller number and sid', () => {
    const s = at(INITIAL, { type: 'REGISTERED' }, { type: 'INCOMING', from: '+18015551212', callSid: 'CA1' }, { type: 'ACCEPTED', callSid: 'CA1', connectedAt: 1000 });
    expect(s).toMatchObject({ status: 'in_call', remoteNumber: '+18015551212', callSid: 'CA1', direction: 'inbound', connectedAt: 1000 });
  });

  test('outbound call: dialing → in_call; disconnect resets call fields but stays ready', () => {
    const dialing = at(INITIAL, { type: 'REGISTERED' }, { type: 'DIALING', to: '+18015551212' });
    expect(dialing).toMatchObject({ status: 'in_call', direction: 'outbound', remoteNumber: '+18015551212', connectedAt: null });
    const live = reduce(dialing, { type: 'ACCEPTED', callSid: 'CA9', connectedAt: 5 });
    const held = reduce(reduce(live, { type: 'MUTED', muted: true }), { type: 'HELD', held: true });
    expect(held).toMatchObject({ muted: true, held: true, callSid: 'CA9' });
    const done = reduce(held, { type: 'DISCONNECTED' });
    expect(done).toMatchObject({ status: 'ready', callSid: null, remoteNumber: null, muted: false, held: false, recording: false, connectedAt: null });
  });

  test('a second incoming call while in_call becomes call_waiting and cancel restores in_call', () => {
    const live = at(INITIAL, { type: 'REGISTERED' }, { type: 'DIALING', to: '+1' }, { type: 'ACCEPTED', callSid: 'CA1', connectedAt: 1 });
    const waiting = reduce(live, { type: 'INCOMING', from: '+2', callSid: 'CA2' });
    expect(waiting).toMatchObject({ status: 'call_waiting', waitingFrom: '+2', callSid: 'CA1' });
    expect(reduce(waiting, { type: 'WAITING_CANCELLED' })).toMatchObject({ status: 'in_call', waitingFrom: null });
  });

  test('an outbound dial marks the far end as ringing until it answers', () => {
    const dialing = at(INITIAL, { type: 'REGISTERED' }, { type: 'DIALING', to: '+18015551212' });
    // DIALING is optimistic: the PSTN leg has been requested but its own
    // status events have not arrived yet, so ringback starts here rather than
    // leaving the dispatcher in silence for the queued/initiated gap.
    expect(dialing.outboundRinging).toBe(true);
    expect(reduce(dialing, { type: 'FAR_END', ringing: false }).outboundRinging).toBe(false);
    // The dispatcher's OWN leg joins the conference immediately, so ACCEPTED
    // says nothing about whether the callee picked up — it must NOT clear the
    // ringback, or every outbound call goes silent the instant it is placed.
    expect(reduce(dialing, { type: 'ACCEPTED', callSid: 'CA1', connectedAt: 1 }).outboundRinging).toBe(true);
  });

  test('ringback clears on hang-up, error and an inbound call', () => {
    const dialing = at(INITIAL, { type: 'REGISTERED' }, { type: 'DIALING', to: '+1' });
    expect(reduce(dialing, { type: 'DISCONNECTED' }).outboundRinging).toBe(false);
    expect(reduce(dialing, { type: 'ERROR', message: 'busy' }).outboundRinging).toBe(false);
    expect(at(INITIAL, { type: 'REGISTERED' }, { type: 'INCOMING', from: '+1', callSid: 'CA1' }).outboundRinging).toBe(false);
  });

  test('errors carry the message; unlinked and passive are terminal until reset', () => {
    expect(reduce(INITIAL, { type: 'ERROR', message: 'AccessTokenInvalid' })).toMatchObject({ status: 'error', error: 'AccessTokenInvalid' });
    expect(reduce(INITIAL, { type: 'UNLINKED' }).status).toBe('unlinked');
    expect(reduce(reduce(INITIAL, { type: 'REGISTERED' }), { type: 'PASSIVE' }).status).toBe('passive');
    expect(reduce(reduce(INITIAL, { type: 'ERROR', message: 'x' }), { type: 'RESET' })).toEqual(INITIAL);
  });
});

describe('control-action failures are non-fatal', () => {
  const live = () => at(INITIAL, { type: 'REGISTERED' }, { type: 'DIALING', to: '+18015551212' }, { type: 'ACCEPTED', callSid: 'CA1', connectedAt: 1 });

  test('CONTROL_FAILED surfaces a notice without leaving in_call or touching the call', () => {
    const s = reduce(live(), { type: 'CONTROL_FAILED', message: 'Caller leg not found in conference' });
    expect(s).toMatchObject({ status: 'in_call', callSid: 'CA1', connectedAt: 1, held: false, error: null });
    expect(s.notice).toBe('Caller leg not found in conference');
  });

  test('a failed hold leaves held false and the call controllable afterwards', () => {
    const failed = reduce(live(), { type: 'CONTROL_FAILED', message: 'nope' });
    const retried = reduce(failed, { type: 'HELD', held: true });
    expect(retried).toMatchObject({ status: 'in_call', held: true });
  });

  test('NOTICE_CLEARED and the end of the call clear the notice', () => {
    const failed = reduce(live(), { type: 'CONTROL_FAILED', message: 'nope' });
    expect(reduce(failed, { type: 'NOTICE_CLEARED' }).notice).toBeNull();
    expect(reduce(failed, { type: 'DISCONNECTED' }).notice).toBeNull();
    expect(reduce(failed, { type: 'DIALING', to: '+1' }).notice).toBeNull();
  });

  test('ERROR is still fatal for device-level failures', () => {
    const s = reduce(live(), { type: 'ERROR', message: 'device gone' });
    expect(s).toMatchObject({ status: 'error', error: 'device gone', notice: null });
  });
});
