import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FlexOSPowerMenu from '../FlexOSPowerMenu';

const noop = () => {};

function mockElectron(overrides: Record<string, unknown> = {}) {
  (window as any).electron = {
    platform: 'win32',
    isElectron: true,
    restartApp: vi.fn(),
    shutdownOs: vi.fn().mockResolvedValue({ ok: true }),
    restartOs: vi.fn().mockResolvedValue({ ok: true }),
    returnToWindows: vi.fn().mockResolvedValue({ ok: true }),
    getKioskShellState: vi.fn().mockResolvedValue({ supported: true, enabled: false }),
    ...overrides,
  };
}

describe('FlexOSPowerMenu — base buttons', () => {
  beforeEach(() => mockElectron());

  it('always shows Lock, Sign Out, Restart App buttons', () => {
    render(<FlexOSPowerMenu onClose={noop} onLock={noop} onSignOut={noop} />);
    expect(screen.getByRole('button', { name: /lock/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /restart app/i })).toBeInTheDocument();
  });

  it('calls onLock when Lock is clicked and then onClose', () => {
    const onLock = vi.fn();
    const onClose = vi.fn();
    render(<FlexOSPowerMenu onClose={onClose} onLock={onLock} onSignOut={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /lock/i }));
    expect(onLock).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onSignOut when Sign Out is clicked and then onClose', () => {
    const onSignOut = vi.fn();
    const onClose = vi.fn();
    render(<FlexOSPowerMenu onClose={onClose} onLock={noop} onSignOut={onSignOut} />);
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('calls electron.restartApp when Restart App is clicked', () => {
    render(<FlexOSPowerMenu onClose={noop} onLock={noop} onSignOut={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /restart app/i }));
    expect((window as any).electron.restartApp).toHaveBeenCalled();
  });

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<FlexOSPowerMenu onClose={onClose} onLock={noop} onSignOut={noop} />);
    fireEvent.click(container.firstChild as HTMLElement);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when Escape is pressed from the main menu', () => {
    const onClose = vi.fn();
    render(<FlexOSPowerMenu onClose={onClose} onLock={noop} onSignOut={noop} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('FlexOSPowerMenu — Windows OS power buttons', () => {
  beforeEach(() => mockElectron({ platform: 'win32' }));

  it('shows Shut Down and Restart buttons on win32', () => {
    render(<FlexOSPowerMenu onClose={noop} onLock={noop} onSignOut={noop} />);
    expect(screen.getByRole('button', { name: /shut down/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^restart$/i })).toBeInTheDocument();
  });

  it('does NOT show Shut Down or Restart buttons on darwin', () => {
    mockElectron({ platform: 'darwin' });
    render(<FlexOSPowerMenu onClose={noop} onLock={noop} onSignOut={noop} />);
    expect(screen.queryByRole('button', { name: /shut down/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^restart$/i })).not.toBeInTheDocument();
  });

  it('calls electron.shutdownOs when Shut Down is clicked', () => {
    render(<FlexOSPowerMenu onClose={noop} onLock={noop} onSignOut={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /shut down/i }));
    expect((window as any).electron.shutdownOs).toHaveBeenCalled();
  });

  it('calls electron.restartOs when Restart is clicked', () => {
    render(<FlexOSPowerMenu onClose={noop} onLock={noop} onSignOut={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /^restart$/i }));
    expect((window as any).electron.restartOs).toHaveBeenCalled();
  });
});

describe('FlexOSPowerMenu — Return to Windows button visibility', () => {
  it('shows Return to Windows when getKioskShellState resolves enabled:true', async () => {
    mockElectron({ getKioskShellState: vi.fn().mockResolvedValue({ supported: true, enabled: true }) });
    render(<FlexOSPowerMenu onClose={noop} onLock={noop} onSignOut={noop} />);
    expect(await screen.findByRole('button', { name: /return to windows/i })).toBeInTheDocument();
  });

  it('does NOT show Return to Windows when kiosk is disabled', async () => {
    mockElectron({ getKioskShellState: vi.fn().mockResolvedValue({ supported: true, enabled: false }) });
    render(<FlexOSPowerMenu onClose={noop} onLock={noop} onSignOut={noop} />);
    // give state time to settle
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /return to windows/i })).not.toBeInTheDocument();
    });
  });

  it('does NOT show Return to Windows when getKioskShellState rejects', async () => {
    mockElectron({ getKioskShellState: vi.fn().mockRejectedValue(new Error('IPC closed')) });
    render(<FlexOSPowerMenu onClose={noop} onLock={noop} onSignOut={noop} />);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /return to windows/i })).not.toBeInTheDocument();
    });
  });
});

describe('FlexOSPowerMenu — Return to Windows credential sub-panel', () => {
  beforeEach(() =>
    mockElectron({ getKioskShellState: vi.fn().mockResolvedValue({ supported: true, enabled: true }) })
  );

  async function openRtw() {
    render(<FlexOSPowerMenu onClose={noop} onLock={noop} onSignOut={noop} />);
    fireEvent.click(await screen.findByRole('button', { name: /return to windows/i }));
  }

  it('switches to the credential sub-panel when Return to Windows is clicked', async () => {
    await openRtw();
    expect(screen.getByPlaceholderText(/username/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/password/i)).toBeInTheDocument();
  });

  it('Back button returns to the main menu', async () => {
    await openRtw();
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.queryByPlaceholderText(/username/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /lock/i })).toBeInTheDocument();
  });

  it('Escape from the sub-panel returns to the main menu (not closing the overlay)', async () => {
    const onClose = vi.fn();
    render(<FlexOSPowerMenu onClose={onClose} onLock={noop} onSignOut={noop} />);
    fireEvent.click(await screen.findByRole('button', { name: /return to windows/i }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /lock/i })).toBeInTheDocument();
  });

  it('submit button is disabled when username or password is empty', async () => {
    await openRtw();
    const submit = screen.getByRole('button', { name: /return to windows/i });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/username/i), { target: { value: 'admin' } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/password/i), { target: { value: 'pass' } });
    expect(submit).not.toBeDisabled();
  });

  it('calls electron.returnToWindows with the entered credentials on submit', async () => {
    await openRtw();
    fireEvent.change(screen.getByPlaceholderText(/username/i), { target: { value: 'admin' } });
    fireEvent.change(screen.getByPlaceholderText(/password/i), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /return to windows/i }));
    await waitFor(() =>
      expect((window as any).electron.returnToWindows).toHaveBeenCalledWith('admin', 'secret')
    );
  });

  it('shows an inline error when returnToWindows returns ok:false', async () => {
    (window as any).electron.returnToWindows = vi.fn().mockResolvedValue({ ok: false, error: 'Invalid credentials' });
    await openRtw();
    fireEvent.change(screen.getByPlaceholderText(/username/i), { target: { value: 'admin' } });
    fireEvent.change(screen.getByPlaceholderText(/password/i), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /return to windows/i }));
    expect(await screen.findByText(/invalid credentials/i)).toBeInTheDocument();
  });

  it('re-enables the form after an error so the operator can retry', async () => {
    (window as any).electron.returnToWindows = vi.fn().mockResolvedValue({ ok: false, error: 'Bad password' });
    await openRtw();
    fireEvent.change(screen.getByPlaceholderText(/username/i), { target: { value: 'admin' } });
    fireEvent.change(screen.getByPlaceholderText(/password/i), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /return to windows/i }));
    await screen.findByText(/bad password/i);
    expect(screen.getByRole('button', { name: /return to windows/i })).not.toBeDisabled();
  });

  it('Enter key in the password field submits the form', async () => {
    await openRtw();
    fireEvent.change(screen.getByPlaceholderText(/username/i), { target: { value: 'admin' } });
    fireEvent.change(screen.getByPlaceholderText(/password/i), { target: { value: 'pass' } });
    fireEvent.keyDown(screen.getByPlaceholderText(/password/i), { key: 'Enter' });
    await waitFor(() =>
      expect((window as any).electron.returnToWindows).toHaveBeenCalledWith('admin', 'pass')
    );
  });
});
