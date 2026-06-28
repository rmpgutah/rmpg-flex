import { describe, it, expect } from 'vitest';
import { useMobileLayout, CardId } from '../useMobileLayout';

describe('useMobileLayout', () => {
  it('returns full set ordered for officer', () => {
    expect(useMobileLayout('officer')).toEqual<CardId[]>([
      'unit', 'calls', 'search', 'bolos', 'map', 'actions', 'messages', 'shift',
    ]);
  });
  it('returns calls-first for dispatcher', () => {
    expect(useMobileLayout('dispatcher')).toEqual<CardId[]>([
      'calls', 'map', 'messages', 'bolos', 'search',
    ]);
  });
  it('returns shift-only for human_resources', () => {
    expect(useMobileLayout('human_resources')).toEqual<CardId[]>(['shift']);
  });
  it('returns minimal view-only for client_viewer', () => {
    expect(useMobileLayout('client_viewer')).toEqual<CardId[]>(['bolos', 'calls']);
  });
});
