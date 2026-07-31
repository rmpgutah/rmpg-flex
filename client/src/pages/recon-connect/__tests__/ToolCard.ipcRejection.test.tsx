// ============================================================
// RMPG Flex — ToolCard IPC-rejection regression tests
// ============================================================
// The Run / Install buttons are gated on `disabled={disabled || running}`.
// Every spawn/install goes through an Electron IPC bridge that can REJECT
// (main-process handler throws, channel missing). Before this guard a
// rejection skipped setRunning(false) entirely, so `running` stayed true and
// the button was disabled until the operator reloaded the page — it presented
// as a button that simply died mid-session.
//
// These tests pin the recovery: after a rejected IPC call the button must be
// enabled again. Break any of the three catch blocks and they go red.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import ToolCard, { type ToolDef } from '../ToolCard';

vi.mock('../../../hooks/useApi', () => ({ apiFetch: vi.fn(() => Promise.resolve({ data: [] })) }));
vi.mock('../../../components/RichTextArea', () => ({ default: () => null }));
vi.mock('../../../utils/pdf/fonts/registerArial', () => ({ registerArial: vi.fn(), registerArialFont: vi.fn() }));

const TOOL: ToolDef = {
  id: 'test-tool',
  icon: () => null,
  title: 'Test Tool',
  description: 'A tool used only by tests.',
  args: [{ name: 'target', label: 'Target' }],
};

function setElectron(impl: Record<string, unknown>) {
  (window as unknown as { electron?: unknown }).electron = impl;
}

const runButton = () => screen.getByRole('button', { name: /^Run$/i });

describe('ToolCard — IPC rejection must not leave the button dead', () => {
  beforeEach(() => {
    setElectron({});
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as { electron?: unknown }).electron;
    vi.restoreAllMocks();
  });

  it('re-enables Run after reconToolSpawn REJECTS', async () => {
    setElectron({ reconToolSpawn: vi.fn(() => Promise.reject(new Error('ipc channel closed'))) });
    render(<ToolCard tool={TOOL} disabled={false} />);

    const btn = runButton();
    expect(btn).not.toBeDisabled();

    btn.click();

    // The button must come back. Before the fix `running` stayed true forever.
    await waitFor(() => expect(runButton()).not.toBeDisabled());
    expect(await screen.findByText(/ipc channel closed/i)).toBeInTheDocument();
  });

  it('re-enables Run when the spawn resolves with ok:false (pre-existing path still works)', async () => {
    setElectron({ reconToolSpawn: vi.fn(() => Promise.resolve({ ok: false, error: 'binary missing' })) });
    render(<ToolCard tool={TOOL} disabled={false} />);

    runButton().click();

    await waitFor(() => expect(runButton()).not.toBeDisabled());
    expect(await screen.findByText(/binary missing/i)).toBeInTheDocument();
  });

  it('does not fire the spawn at all when the bridge is unavailable', async () => {
    setElectron({});
    render(<ToolCard tool={TOOL} disabled={false} />);

    runButton().click();

    // Guarded by `!api?.reconToolSpawn` — must stay enabled, never stuck.
    await waitFor(() => expect(runButton()).not.toBeDisabled());
  });
});
