import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import SettingsPanel, { SETTINGS_TABS } from './SettingsPanel';
import { createWindowsBridge } from '../../../hooks/useWindowsBridge';
import type { WindowsBridge } from '../../../hooks/useWindowsBridge';

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: '7', username: 'jdoe', first_name: 'Jane', last_name: 'Doe', role: 'officer', badge_number: '4412' },
  }),
}));

const apiFetchMock = vi.fn();
vi.mock('../../../hooks/useApi', () => ({ apiFetch: (...a: unknown[]) => apiFetchMock(...a) }));

function installElectron(winExt: Record<string, unknown> | undefined) {
  (window as unknown as { electron?: unknown }).electron = {
    isElectron: true,
    platform: 'win32',
    getVersion: vi.fn().mockResolvedValue('5.9.0'),
    getSystemInfo: vi.fn().mockResolvedValue({ hostname: 'FZ55-A12', platform: 'win32', arch: 'x64', os_version: '10.0.22631', cpu_count: 8, cpu_model: 'Intel i7', uptime_seconds: 7200, total_memory_mb: 16384, free_memory_mb: 8000, disk_free_gb: 120.5, disk_free_bytes: 1 }),
    getBrightness: vi.fn().mockResolvedValue(70),
    setBrightness: vi.fn().mockResolvedValue(undefined),
    getVolume: vi.fn().mockResolvedValue(40),
    setVolume: vi.fn().mockResolvedValue(undefined),
    getDisplays: vi.fn().mockResolvedValue([{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, primary: true }]),
    wifiGetDetail: vi.fn().mockResolvedValue({ ssid: 'RMPG-5G', signal: 88, ip: '10.0.0.5' }),
    wifiScanNetworks: vi.fn().mockResolvedValue([{ ssid: 'RMPG-5G', signal: 88, auth: 'WPA2' }, { ssid: 'Guest', signal: 30, auth: 'Open' }]),
    wifiConnect: vi.fn().mockResolvedValue({ ok: true }),
    getClipboardText: vi.fn().mockResolvedValue('hello'),
    setClipboardText: vi.fn().mockResolvedValue(undefined),
    getKioskShellState: vi.fn().mockResolvedValue({ supported: true, enabled: false }),
    setKioskShell: vi.fn().mockResolvedValue({ ok: true }),
    getAutoLaunchState: vi.fn().mockResolvedValue({ enabled: true }),
    getBatteryStatus: vi.fn().mockResolvedValue({ percent: 64, charging: true }),
    getIdleTime: vi.fn().mockResolvedValue(12),
    shutdownOs: vi.fn().mockResolvedValue({ ok: true }),
    winExt,
  };
}

const okExt = () => ({
  getDisplayModes: vi.fn().mockResolvedValue({ ok: true, current: { width: 1920, height: 1080, refreshHz: 60, rotation: 0 }, modes: [{ width: 1920, height: 1080, refreshHz: 60 }, { width: 1280, height: 720, refreshHz: 60 }] }),
  setResolution: vi.fn().mockResolvedValue({ ok: true, code: 0 }),
  rotateDisplay: vi.fn().mockResolvedValue({ ok: true, code: 0 }),
  getNightLightState: vi.fn().mockResolvedValue({ ok: true, state: 'off', enabled: false }),
  screenshotToPictures: vi.fn().mockResolvedValue({ ok: true, path: 'C:\\Users\\Public\\Pictures\\x.png' }),
  getMute: vi.fn().mockResolvedValue({ ok: true, muted: false }),
  setMute: vi.fn().mockResolvedValue({ ok: true, muted: true }),
  playSystemSound: vi.fn().mockResolvedValue({ ok: true }),
  getAudioDevices: vi.fn().mockResolvedValue({ ok: true, devices: [{ name: 'Speakers', status: 'OK', id: 'dev1', isDefault: true }] }),
  setDefaultAudioDevice: vi.fn().mockResolvedValue({ ok: true }),
  getNetAdapters: vi.fn().mockResolvedValue({ ok: true, adapters: [{ name: 'Wi-Fi', description: 'Intel AX', status: 'Up', up: true, mac: 'AA-BB', linkSpeed: '866 Mbps', mediaType: 'Native 802.11', isWifi: true }] }),
  toggleWifi: vi.fn().mockResolvedValue({ ok: true, enabled: false }),
  getBluetoothDevices: vi.fn().mockResolvedValue({ ok: true, devices: [], radioPresent: false, radioEnabled: false }),
  toggleBluetooth: vi.fn().mockResolvedValue({ ok: true, enabled: true }),
  ping: vi.fn().mockResolvedValue({ ok: true, host: 'api.rmpgutah.us', sent: 4, received: 4, lost: 0, minMs: 12, maxMs: 15, avgMs: 13 }),
  getProcesses: vi.fn().mockResolvedValue({ ok: true, processes: [{ pid: 4242, name: 'notepad', cpuSeconds: 1.2, memoryBytes: 1048576, windowTitle: '' }] }),
  killProcess: vi.fn().mockResolvedValue({ ok: true, pid: 4242 }),
  launchApp: vi.fn().mockResolvedValue({ ok: true }),
  getLaunchableApps: vi.fn().mockResolvedValue({ ok: true, apps: [{ id: 'notepad', label: 'Notepad' }] }),
  getSystemPerformance: vi.fn().mockResolvedValue({ ok: true, cpuCount: 8, cpuModel: 'Intel i7', cpuBusyPercent: 23, memory: { totalBytes: 16e9, freeBytes: 8e9, usedPercent: 50 }, disk: { freeBytes: 1e11, totalBytes: 5e11 }, uptimeSeconds: 7200, hostname: 'FZ55-A12', osVersion: '10.0', arch: 'x64' }),
  getInstalledApps: vi.fn().mockResolvedValue({ ok: true, apps: [{ name: 'Mapbox Studio', version: '1.0', publisher: 'Mapbox', installDate: '' }, { name: 'Zoom', version: '6', publisher: 'Zoom', installDate: '' }] }),
  setEnvVar: vi.fn().mockResolvedValue({ ok: true, name: 'RMPG_UNIT_ID' }),
  getDrives: vi.fn().mockResolvedValue({ ok: true, drives: [{ letter: 'C', root: 'C:\\', label: 'OS', usedBytes: 75e9, freeBytes: 25e9, totalBytes: 1e11, usedPercent: 75 }] }),
  openFolder: vi.fn().mockResolvedValue({ ok: true }),
  getRecentFiles: vi.fn().mockResolvedValue({ ok: true, files: [] }),
  recycleItem: vi.fn().mockResolvedValue({ ok: true }),
  getEventLog: vi.fn().mockResolvedValue({ ok: true, logName: 'System', level: 'all', events: [{ id: 41, level: 'error', source: 'Kernel-Power', message: 'Unexpected shutdown', time: '2026-09-08T10:00:00Z' }] }),
  getScheduledTasks: vi.fn().mockResolvedValue({ ok: true, tasks: [] }),
  sendNativeToast: vi.fn().mockResolvedValue({ ok: true }),
});

function renderPanel(props: Partial<React.ComponentProps<typeof SettingsPanel>> = {}) {
  const bridge: WindowsBridge = createWindowsBridge();
  return { bridge, ...render(<SettingsPanel bridgeOverride={bridge} {...props} />) };
}

beforeEach(() => {
  apiFetchMock.mockReset();
  delete (window as unknown as { electron?: unknown }).electron;
});

describe('SettingsPanel', () => {
  it('renders all 13 system tabs in the sidebar and shows the signed-in user', () => {
    installElectron(okExt());
    renderPanel();
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    for (const t of SETTINGS_TABS) expect(within(nav).getByRole('button', { name: t.label })).toBeInTheDocument();
    expect(SETTINGS_TABS).toHaveLength(13);
    expect(screen.getByText('Badge 4412')).toBeInTheDocument();
  });

  it('switches tabs and updates the sticky header', async () => {
    installElectron(okExt());
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Event Log' }));
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Event Log');
    await waitFor(() => expect(screen.getByText(/Unexpected shutdown/)).toBeInTheDocument());
  });

  it('web build: controls are disabled and the read-only notice is shown', () => {
    renderPanel();
    expect(screen.getByRole('status')).toHaveTextContent(/desktop app only/i);
    expect(screen.getByRole('slider', { name: 'Brightness' })).toBeDisabled();
  });

  it('older desktop build without winExt: extended rows explain the update requirement', async () => {
    installElectron(undefined);
    const { bridge } = renderPanel();
    expect(bridge.available).toBe(true);
    expect(bridge.extendedAvailable).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Network' }));
    await waitFor(() => expect(screen.getAllByText(/latest desktop app build/i).length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: /Ping/ })).toBeDisabled();
  });

  it('display: populates the resolution list from the bridge and applies a change', async () => {
    const ext = okExt();
    installElectron(ext);
    renderPanel();
    const select = await screen.findByRole('combobox', { name: 'Display resolution' });
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(2));
    fireEvent.change(select, { target: { value: '1280x720' } });
    await waitFor(() => expect(ext.setResolution).toHaveBeenCalledWith(1280, 720));
    expect(await screen.findByText(/Resolution set to 1280×720/)).toBeInTheDocument();
  });

  it('network: ping runs through the bridge and renders the summary', async () => {
    const ext = okExt();
    installElectron(ext);
    renderPanel({ initialTab: 'network' });
    const input = screen.getByRole('textbox', { name: 'Ping host' });
    fireEvent.change(input, { target: { value: '8.8.8.8' } });
    fireEvent.click(screen.getByRole('button', { name: /Ping/ }));
    await waitFor(() => expect(ext.ping).toHaveBeenCalledWith('8.8.8.8'));
    expect(await screen.findByText(/4\/4 replies · avg 13 ms/)).toBeInTheDocument();
  });

  it('apps: filters installed apps by search text', async () => {
    installElectron(okExt());
    renderPanel({ initialTab: 'apps' });
    await screen.findByText('Mapbox Studio');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search installed apps' }), { target: { value: 'zoom' } });
    expect(screen.queryByText('Mapbox Studio')).not.toBeInTheDocument();
    expect(screen.getByText('Zoom')).toBeInTheDocument();
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
  });

  it('apps: ending a process requires confirmation and then calls killProcess', async () => {
    const ext = okExt();
    installElectron(ext);
    renderPanel({ initialTab: 'apps' });
    fireEvent.click(await screen.findByRole('button', { name: 'End' }));
    expect(ext.killProcess).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'End process' }));
    await waitFor(() => expect(ext.killProcess).toHaveBeenCalledWith(4242));
  });

  it('power: shutdown shows a confirm dialog; cancel does not call the bridge', async () => {
    installElectron(okExt());
    renderPanel({ initialTab: 'power' });
    fireEvent.click(screen.getByRole('button', { name: /Shut down/ }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect((window as unknown as { electron: { shutdownOs: ReturnType<typeof vi.fn> } }).electron.shutdownOs).not.toHaveBeenCalled();
  });

  it('account: validates a 4–6 digit PIN, flags mismatch, and posts to /auth/set-pin', async () => {
    installElectron(okExt());
    apiFetchMock.mockResolvedValue({ ok: true });
    renderPanel({ initialTab: 'account' });
    const pin = screen.getByLabelText('New PIN');
    const confirm = screen.getByLabelText('Confirm PIN');
    const save = screen.getByRole('button', { name: /Update PIN/ });

    fireEvent.change(pin, { target: { value: '12' } });
    expect(pin).toHaveClass('input-error');
    expect(save).toBeDisabled();

    fireEvent.change(pin, { target: { value: '123456' } });
    fireEvent.change(confirm, { target: { value: '123457' } });
    expect(confirm).toHaveClass('input-error');
    expect(screen.getByText('PINs do not match')).toBeInTheDocument();
    expect(save).toBeDisabled();

    fireEvent.change(confirm, { target: { value: '123456' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/auth/set-pin', expect.objectContaining({ method: 'POST', body: JSON.stringify({ pin: '123456' }) })));
    expect(await screen.findByText('Lock-screen PIN updated')).toBeInTheDocument();
  });

  it('kiosk: toggling the shell asks for confirmation before calling setKioskShell', async () => {
    installElectron(okExt());
    renderPanel({ initialTab: 'kiosk' });
    const toggle = await screen.findByRole('switch', { name: 'Kiosk shell' });
    await waitFor(() => expect(toggle).toBeEnabled());
    fireEvent.click(toggle);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(/Enable kiosk shell/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enable' }));
    await waitFor(() => expect((window as unknown as { electron: { setKioskShell: ReturnType<typeof vi.fn> } }).electron.setKioskShell).toHaveBeenCalledWith(true));
  });

  it('extra tabs are injected first, grouped, and render their content', () => {
    installElectron(okExt());
    renderPanel({
      initialTab: 'theme',
      extraTabs: [{ id: 'theme', label: 'Theme', icon: () => null, group: 'Desktop', render: () => <div>THEME CONTENT</div> }],
    });
    expect(screen.getByText('Desktop')).toBeInTheDocument();
    expect(screen.getByText('THEME CONTENT')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Theme');
  });

  it('about: shows live performance from getSystemPerformance', async () => {
    installElectron(okExt());
    renderPanel({ initialTab: 'about' });
    expect(await screen.findByText(/23% busy · 8 cores/)).toBeInTheDocument();
    expect(await screen.findByText('FZ55-A12')).toBeInTheDocument();
  });
});
