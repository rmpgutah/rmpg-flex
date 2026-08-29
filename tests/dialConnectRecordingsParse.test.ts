import { describe, test, expect } from 'vitest';
import {
  parseDialConnectRecordingIngest,
  isAllowedDialConnectAudioUrl,
  publicRecordingSummary,
} from '../src/utils/dialConnectRecordings';

describe('parseDialConnectRecordingIngest', () => {
  test('accepts camelCase Dial Connect payload', () => {
    const parsed = parseDialConnectRecordingIngest({
      recordingSid: 'REabcd1234',
      callSid: 'CAabcd1234',
      from: '+18015550100',
      transcript: 'Hello dispatch',
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.recordingSid).toBe('REabcd1234');
      expect(parsed.value.callSid).toBe('CAabcd1234');
      expect(parsed.value.transcript).toBe('Hello dispatch');
    }
  });

  test('accepts snake_case aliases', () => {
    const parsed = parseDialConnectRecordingIngest({
      recording_sid: 'RE_snake_01',
      from_number: '+18015550100',
      duration_seconds: '42',
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.recordingSid).toBe('RE_snake_01');
      expect(parsed.value.from).toBe('+18015550100');
      expect(parsed.value.durationSeconds).toBe(42);
    }
  });

  test('rejects missing recordingSid', () => {
    const parsed = parseDialConnectRecordingIngest({ transcript: 'hi' });
    expect(parsed.ok).toBe(false);
  });

  test('rejects short recordingSid', () => {
    const parsed = parseDialConnectRecordingIngest({ recordingSid: 'RE1' });
    expect(parsed.ok).toBe(false);
  });
});

describe('isAllowedDialConnectAudioUrl', () => {
  test('allows Dial Connect HTTPS origin', () => {
    expect(isAllowedDialConnectAudioUrl('https://dialer.rmpgutah.us/api/recordings/RE1.mp3')).toBe(true);
  });
  test('rejects arbitrary hosts (SSRF)', () => {
    expect(isAllowedDialConnectAudioUrl('https://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isAllowedDialConnectAudioUrl('http://dialer.rmpgutah.us/x')).toBe(false);
    expect(isAllowedDialConnectAudioUrl('https://evil.example/x')).toBe(false);
  });
});

describe('publicRecordingSummary', () => {
  test('does not leak the R2 key', () => {
    const out = publicRecordingSummary({
      id: 1,
      recording_sid: 'REabcd1234',
      call_sid: 'CA1',
      from_number: '+1',
      to_number: '+2',
      direction: 'inbound',
      started_at: null,
      ended_at: null,
      duration_seconds: 10,
      dispatcher_name: null,
      transcript: 'hello',
      segments_json: null,
      audio_r2_key: 'dial-connect-recordings/secret.mp3',
      audio_content_type: 'audio/mpeg',
      audio_bytes: 12,
      source: 'dial_connect',
      ingested_at: '2026-08-12T00:00:00Z',
      updated_at: null,
    });
    expect(out.has_audio).toBe(true);
    expect(out.has_transcript).toBe(true);
    expect(JSON.stringify(out)).not.toContain('secret');
    expect(JSON.stringify(out)).not.toContain('audio_r2_key');
  });
});
