import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import InteractionRecorderPage from '../InteractionRecorderPage';

vi.mock('../../hooks/useApi', () => ({
  apiFetch: vi.fn(async (path: string, init?: RequestInit) => {
    if (path.includes('/recordings/start')) return { id: 99, mime: 'audio/webm' };
    if (init?.method === 'POST') return { success: true };
    return [{ id: 1, started_at: '2026-06-12T10:00:00', duration_sec: 42, chunk_count: 9, status: 'complete', location_text: 'Main St', notes: null }];
  }),
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'admin', id: 1, full_name: 'Test Admin' } }),
}));

vi.mock('../../components/ToastProvider', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

class FakeMediaRecorder {
  state = 'inactive'; ondataavailable: any = null;
  constructor(_s: any, _o: any) {}
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; }
  requestData() {}
  static isTypeSupported() { return true; }
}

describe('InteractionRecorderPage', () => {
  beforeEach(() => {
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder as any);
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: undefined,
      mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
    });
  });

  it('renders recordings and starts a recording on click', async () => {
    render(<MemoryRouter><InteractionRecorderPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Main St')).toBeInTheDocument());
    expect(screen.getByText('START RECORDING')).toBeInTheDocument();
    fireEvent.click(screen.getByText('START RECORDING'));
    await waitFor(() => expect(screen.getByText('STOP')).toBeInTheDocument());
  });
});
