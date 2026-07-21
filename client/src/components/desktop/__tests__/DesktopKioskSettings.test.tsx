import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DesktopKioskSettings from '../DesktopKioskSettings';

describe('DesktopKioskSettings', () => {
  beforeEach(() => {
    (window as any).electron = {
      getKioskShellState: vi.fn().mockResolvedValue({ supported: true, enabled: false }),
      setKioskShell: vi.fn().mockResolvedValue({ ok: true }),
    };
  });

  it('shows unsupported message when window.electron.getKioskShellState reports supported:false', async () => {
    (window as any).electron.getKioskShellState = vi.fn().mockResolvedValue({ supported: false, enabled: false });
    render(<DesktopKioskSettings onClose={() => {}} />);
    expect(await screen.findByText(/only available on windows/i)).toBeInTheDocument();
  });

  it('shows an Enable button and current Off state when supported and disabled', async () => {
    render(<DesktopKioskSettings onClose={() => {}} />);
    expect(await screen.findByText(/off/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enable kiosk mode/i })).toBeInTheDocument();
  });

  it('requires confirmation before calling setKioskShell', async () => {
    render(<DesktopKioskSettings onClose={() => {}} />);
    const enableBtn = await screen.findByRole('button', { name: /enable kiosk mode/i });
    fireEvent.click(enableBtn);
    expect((window as any).electron.setKioskShell).not.toHaveBeenCalled();
    const confirmBtn = await screen.findByRole('button', { name: /yes, i understand/i });
    fireEvent.click(confirmBtn);
    await waitFor(() => expect((window as any).electron.setKioskShell).toHaveBeenCalledWith(true));
  });

  it('shows an inline error when setKioskShell fails', async () => {
    (window as any).electron.setKioskShell = vi.fn().mockResolvedValue({ ok: false, error: 'UAC prompt was cancelled' });
    render(<DesktopKioskSettings onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /enable kiosk mode/i }));
    fireEvent.click(await screen.findByRole('button', { name: /yes, i understand/i }));
    expect(await screen.findByText(/uac prompt was cancelled/i)).toBeInTheDocument();
  });
});
