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
    expect(await screen.findByText(/disabled/i)).toBeInTheDocument();
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

  it('calls onClose after a successful toggle, since a restart prompt/instruction follows', async () => {
    const onClose = vi.fn();
    render(<DesktopKioskSettings onClose={onClose} />);
    fireEvent.click(await screen.findByRole('button', { name: /enable kiosk mode/i }));
    fireEvent.click(await screen.findByRole('button', { name: /yes, i understand/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('does not call onClose when setKioskShell fails', async () => {
    (window as any).electron.setKioskShell = vi.fn().mockResolvedValue({ ok: false, error: 'UAC prompt was cancelled' });
    const onClose = vi.fn();
    render(<DesktopKioskSettings onClose={onClose} />);
    fireEvent.click(await screen.findByRole('button', { name: /enable kiosk mode/i }));
    fireEvent.click(await screen.findByRole('button', { name: /yes, i understand/i }));
    await screen.findByText(/uac prompt was cancelled/i);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows an inline error when setKioskShell fails', async () => {
    (window as any).electron.setKioskShell = vi.fn().mockResolvedValue({ ok: false, error: 'UAC prompt was cancelled' });
    render(<DesktopKioskSettings onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /enable kiosk mode/i }));
    fireEvent.click(await screen.findByRole('button', { name: /yes, i understand/i }));
    expect(await screen.findByText(/uac prompt was cancelled/i)).toBeInTheDocument();
  });

  it('recovers to the unsupported panel instead of hanging blank when getKioskShellState rejects', async () => {
    (window as any).electron.getKioskShellState = vi.fn().mockRejectedValue(new Error('IPC channel closed'));
    render(<DesktopKioskSettings onClose={() => {}} />);
    expect(await screen.findByText(/only available on windows/i)).toBeInTheDocument();
  });

  it('clears busy state and shows an error when setKioskShell rejects, leaving the dialog usable', async () => {
    (window as any).electron.setKioskShell = vi.fn().mockRejectedValue(new Error('UAC prompt was cancelled'));
    render(<DesktopKioskSettings onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /enable kiosk mode/i }));
    const confirmBtn = await screen.findByRole('button', { name: /yes, i understand/i });
    fireEvent.click(confirmBtn);

    expect(await screen.findByText(/could not change kiosk mode.*uac prompt was cancelled/i)).toBeInTheDocument();

    // busy/confirming should be cleared (not stuck), leaving a usable, re-enabled toggle button.
    const retryBtn = await screen.findByRole('button', { name: /enable kiosk mode/i });
    expect(retryBtn).not.toBeDisabled();
  });
});
