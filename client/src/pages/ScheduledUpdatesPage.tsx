import React, { useState, useEffect, useCallback } from 'react';
import { Download, RefreshCw, CheckCircle, AlertCircle, Clock, Package } from 'lucide-react';
import { parseTimestamp } from '../utils/dateUtils';
import { updateHistoryToCsv, downloadTextFile } from '../utils/rmsListExport';
import { copyToClipboard } from '../utils/contextMenuActions';

// ── types ─────────────────────────────────────────────────────────────────────

interface UpdateInfo {
  available: boolean;
  version?: string;
  releaseNotes?: string;
  size?: number;
}

interface DownloadProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

interface UpdateHistoryEntry {
  version: string;
  date: string;
  notes?: string;
}

type UpdateChannel = 'stable' | 'beta';

interface ElectronBridge {
  checkForUpdates?: () => Promise<UpdateInfo> | UpdateInfo | undefined;
  // getVersion uses ipcRenderer.invoke — always returns Promise<string>
  getVersion?: () => Promise<string>;
  installUpdate?: () => void;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function getElectron(): ElectronBridge | undefined {
  return (window as unknown as { electron?: ElectronBridge }).electron;
}

function isElectron(): boolean {
  return typeof getElectron() !== 'undefined';
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

function formatBps(bps: number): string {
  const mbps = bps / (1024 * 1024);
  return mbps >= 0.1 ? `${mbps.toFixed(1)} MB/s` : `${(bps / 1024).toFixed(0)} KB/s`;
}

function fmtTimestamp(iso: string): string {
  try {
    return parseTimestamp(iso).toLocaleString('en-US', {
      timeZone: 'America/Denver',
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  } catch {
    return iso;
  }
}

const LS_AUTO_UPDATE   = 'rmpg_auto_update';
const LS_CHANNEL       = 'rmpg_update_channel';
const LS_LAST_CHECK    = 'rmpg_last_update_check';
const LS_HISTORY       = 'rmpg_update_history';

function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function lsSet(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
}

// ── component ─────────────────────────────────────────────────────────────────

export default function ScheduledUpdatesPage() {
  const electron = getElectron();
  const inElectron = isElectron();

  // getVersion uses ipcRenderer.invoke and returns Promise<string> — not a plain
  // string. Calling it without await assigned a Promise object to currentVersion,
  // which rendered as "[object Promise]" in the UI.
  const [currentVersion, setCurrentVersion] = useState('5.9.0');

  const [autoUpdate, setAutoUpdate]     = useState<boolean>(() => lsGet(LS_AUTO_UPDATE, true));
  const [channel, setChannel]           = useState<UpdateChannel>(() => lsGet<UpdateChannel>(LS_CHANNEL, 'stable'));
  const [lastChecked, setLastChecked]   = useState<string | null>(() => localStorage.getItem(LS_LAST_CHECK));
  const [history, setHistory]           = useState<UpdateHistoryEntry[]>(() => lsGet<UpdateHistoryEntry[]>(LS_HISTORY, []));

  const [checking, setChecking]         = useState(false);
  const [updateInfo, setUpdateInfo]     = useState<UpdateInfo | null>(null);
  const [progress, setProgress]         = useState<DownloadProgress | null>(null);
  const [confirmInstall, setConfirmInstall] = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [histQuery, setHistQuery]       = useState('');

  // Fetch app version on mount (async — ipcRenderer.invoke)
  useEffect(() => {
    electron?.getVersion?.().then(v => { if (v) setCurrentVersion(v); }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // listen for download progress events
  useEffect(() => {
    function onProgress(e: Event) {
      const detail = (e as CustomEvent<DownloadProgress>).detail;
      setProgress(detail);
    }
    window.addEventListener('flexos:update-progress', onProgress);
    return () => window.removeEventListener('flexos:update-progress', onProgress);
  }, []);

  // persist auto-update setting
  useEffect(() => { lsSet(LS_AUTO_UPDATE, autoUpdate); }, [autoUpdate]);

  // persist channel
  useEffect(() => { lsSet(LS_CHANNEL, channel); }, [channel]);

  const checkNow = useCallback(async () => {
    if (!inElectron) return;
    setChecking(true);
    setError(null);
    try {
      const result = await Promise.resolve(electron?.checkForUpdates?.());
      const now = new Date().toISOString();
      localStorage.setItem(LS_LAST_CHECK, now);
      setLastChecked(now);
      if (result !== undefined) {
        setUpdateInfo(result);
        // if update became available, reset progress
        if (result.available) setProgress(null);
      } else {
        setUpdateInfo({ available: false });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check failed');
    } finally {
      setChecking(false);
    }
  }, [electron, inElectron]);

  function handleInstall() {
    if (!confirmInstall) { setConfirmInstall(true); return; }
    try { electron?.installUpdate?.(); } catch { /* non-Electron */ }
    setConfirmInstall(false);
  }

  function dismissInstall() { setConfirmInstall(false); }

  const panel: React.CSSProperties = {
    background: 'var(--surface-raised)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 2,
    padding: 12,
    marginBottom: 10,
  };

  const label: React.CSSProperties = {
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: '0.08em',
    color: 'var(--field-label-color)',
    textTransform: 'uppercase',
    marginBottom: 4,
  };

  const value: React.CSSProperties = {
    fontSize: 11,
    color: 'var(--text-primary)',
  };

  const secondary: React.CSSProperties = {
    fontSize: 10,
    color: 'var(--text-secondary)',
  };

  const divider: React.CSSProperties = {
    borderTop: '1px solid var(--border-subtle)',
    margin: '10px 0',
  };

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ background: 'var(--surface-base)', minHeight: '100vh', padding: 16, maxWidth: 560 }}>

      {/* page header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <Download className="w-4 h-4" style={{ color: 'var(--brand-400)', flexShrink: 0 }} />
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--field-label-color)', letterSpacing: '0.1em' }}>
          SOFTWARE UPDATES
        </div>
      </div>

      {/* non-Electron notice */}
      {!inElectron && (
        <div style={{ ...panel, borderColor: 'var(--brand-400)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <AlertCircle className="w-3 h-3 mt-[1px]" style={{ color: 'var(--brand-400)', flexShrink: 0 }} />
          <div style={secondary}>
            Auto-update is managed by FlexOS Desktop. Launch the desktop application to check for and install updates.
          </div>
        </div>
      )}

      {/* current version + status */}
      <div style={panel}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={label}>CURRENT VERSION</div>
            <div style={{ ...value, fontSize: 13, fontWeight: 600 }}>{currentVersion}</div>
          </div>
          {updateInfo !== null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              {updateInfo.available ? (
                <>
                  <AlertCircle className="w-3 h-3" style={{ color: 'var(--sev-warn)' }} />
                  <span style={{ fontSize: 10, color: 'var(--sev-warn)', fontWeight: 600 }}>
                    Update available — {updateInfo.version}
                  </span>
                </>
              ) : (
                <>
                  <CheckCircle className="w-3 h-3" style={{ color: 'var(--sev-ok)' }} />
                  <span style={{ fontSize: 10, color: 'var(--sev-ok)' }}>Up to date</span>
                </>
              )}
            </div>
          )}
        </div>

        {lastChecked && (
          <div style={{ ...secondary, marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Clock className="w-3 h-3" style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
            Last checked: {fmtTimestamp(lastChecked)}
          </div>
        )}

        <div style={divider} />

        {/* check now button */}
        {inElectron && (
          <button
            type="button"
            onClick={checkNow}
            disabled={checking}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 10, padding: '5px 12px',
              background: checking ? 'var(--border-subtle)' : 'var(--brand-400)',
              color: '#fff', border: 'none', borderRadius: 2, cursor: checking ? 'default' : 'pointer',
              opacity: checking ? 0.7 : 1,
            }}
          >
            <RefreshCw
              className="w-3 h-3"
              style={{ animation: checking ? 'spin 1s linear infinite' : 'none' }}
            />
            {checking ? 'Checking…' : 'Check Now'}
          </button>
        )}

        {error && (
          <div style={{ fontSize: 10, color: 'var(--sev-critical)', marginTop: 8 }}>
            {error}
          </div>
        )}
      </div>

      {/* update available details */}
      {updateInfo?.available && (
        <div style={{ ...panel, borderColor: 'var(--sev-warn)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div>
              <div style={label}>AVAILABLE UPDATE</div>
              <div style={{ ...value, fontWeight: 600 }}>{updateInfo.version}</div>
              {updateInfo.size !== undefined && (
                <div style={{ ...secondary, marginTop: 2 }}>{formatBytes(updateInfo.size)}</div>
              )}
            </div>

            {/* install button */}
            {inElectron && !confirmInstall && (
              <button
                type="button"
                onClick={handleInstall}
                style={{
                  fontSize: 10, padding: '5px 12px',
                  background: 'var(--sev-warn)', color: '#fff',
                  border: 'none', borderRadius: 2, cursor: 'pointer', fontWeight: 600,
                }}
              >
                Install &amp; Restart
              </button>
            )}
          </div>

          {/* confirmation prompt */}
          {confirmInstall && (
            <div style={{
              background: 'var(--surface-base)', border: '1px solid var(--sev-warn)',
              borderRadius: 2, padding: 10, marginBottom: 10,
            }}>
              <div style={{ ...value, marginBottom: 8 }}>
                FlexOS will restart to apply the update. Unsaved work may be lost. Continue?
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={handleInstall}
                  style={{ fontSize: 10, padding: '4px 10px', background: 'var(--sev-critical)', color: '#fff', border: 'none', borderRadius: 2, cursor: 'pointer' }}>
                  Restart &amp; Install
                </button>
                <button type="button" onClick={dismissInstall}
                  style={{ fontSize: 10, padding: '4px 10px', background: 'var(--surface-raised)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 2, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* download progress */}
          {progress !== null && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', ...secondary, marginBottom: 4 }}>
                <span>Downloading… {progress.percent.toFixed(0)}%</span>
                <span>{formatBps(progress.bytesPerSecond)} · {formatBytes(progress.transferred)} / {formatBytes(progress.total)}</span>
              </div>
              <div style={{ height: 4, background: 'var(--border-subtle)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 2,
                  background: 'var(--brand-400)',
                  width: `${Math.min(100, progress.percent)}%`,
                  transition: 'width 0.3s ease',
                }} />
              </div>
            </div>
          )}

          {/* release notes */}
          {updateInfo.releaseNotes && (
            <>
              <div style={label}>RELEASE NOTES</div>
              <pre style={{
                fontSize: 10, color: 'var(--text-secondary)',
                background: 'var(--surface-base)', border: '1px solid var(--border-subtle)',
                borderRadius: 2, padding: 8, margin: 0,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                fontFamily: 'Arial, sans-serif', maxHeight: 180, overflowY: 'auto',
              }}>
                {updateInfo.releaseNotes}
              </pre>
            </>
          )}
        </div>
      )}

      {/* settings */}
      <div style={panel}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--field-label-color)', letterSpacing: '0.08em', marginBottom: 10 }}>
          UPDATE SETTINGS
        </div>

        {/* auto-update toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <div style={value}>Automatic updates</div>
            <div style={secondary}>Download and install updates automatically</div>
          </div>
          <button
            type="button"
            onClick={() => setAutoUpdate(v => !v)}
            aria-label={autoUpdate ? 'Disable automatic updates' : 'Enable automatic updates'}
            style={{
              width: 34, height: 18, borderRadius: 9, border: 'none', cursor: 'pointer',
              background: autoUpdate ? 'var(--brand-400)' : 'var(--border-subtle)',
              position: 'relative', flexShrink: 0, transition: 'background 0.15s',
            }}
          >
            <span style={{
              position: 'absolute', top: 3, width: 12, height: 12, borderRadius: '50%',
              background: '#fff', transition: 'left 0.15s',
              left: autoUpdate ? 19 : 3,
            }} />
          </button>
        </div>

        <div style={divider} />

        {/* channel selector */}
        <div>
          <div style={label}>UPDATE CHANNEL</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
            {(['stable', 'beta'] as UpdateChannel[]).map(ch => (
              <button
                key={ch}
                type="button"
                onClick={() => setChannel(ch)}
                style={{
                  fontSize: 10, padding: '4px 14px', borderRadius: 2, cursor: 'pointer', fontWeight: 600,
                  border: channel === ch ? '1px solid var(--brand-400)' : '1px solid var(--border-subtle)',
                  background: channel === ch ? 'var(--brand-400)' : 'var(--surface-base)',
                  color: channel === ch ? '#fff' : 'var(--text-secondary)',
                }}
              >
                {ch.charAt(0).toUpperCase() + ch.slice(1)}
              </button>
            ))}
          </div>
          {channel === 'beta' && (
            <div style={{ ...secondary, marginTop: 6, color: 'var(--sev-warn)' }}>
              Beta builds may be unstable. Not recommended for operational use.
            </div>
          )}
        </div>
      </div>

      {/* update history */}
      <div style={panel}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          <Package className="w-3 h-3" style={{ color: 'var(--field-label-color)' }} />
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--field-label-color)', letterSpacing: '0.08em' }}>
            UPDATE HISTORY
          </div>
          <input
            value={histQuery}
            onChange={(e) => setHistQuery(e.target.value)}
            placeholder="Search versions…"
            aria-label="Search update history"
            style={{ marginLeft: 'auto', fontSize: 10, padding: '2px 6px', width: 140, border: '1px solid var(--border-subtle)', background: 'var(--surface-sunken)', color: 'var(--text-primary)' }}
          />
          <button
            type="button"
            disabled={history.length === 0}
            onClick={() => downloadTextFile('update-history.csv', updateHistoryToCsv(history))}
            style={{ fontSize: 10, border: '1px solid var(--border-default)', background: 'none', color: 'var(--text-primary)', cursor: 'pointer' }}
          >CSV</button>
        </div>

        {history.length === 0 ? (
          <div style={secondary}>No update history recorded.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {history.filter((entry) => {
              const q = histQuery.trim().toLowerCase();
              if (!q) return true;
              return entry.version.toLowerCase().includes(q) || (entry.notes ?? '').toLowerCase().includes(q);
            }).map((entry, i) => (
              <div key={i} style={{
                paddingBottom: 8,
                borderBottom: '1px solid var(--border-subtle)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ ...value, fontWeight: 600 }}>{entry.version}</span>
                  <button type="button" onClick={() => void copyToClipboard(entry.version)} style={{ fontSize: 9, border: '1px solid var(--border-default)', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>Copy version</button>
                  <span style={secondary}>{fmtTimestamp(entry.date)}</span>
                </div>
                {entry.notes && (
                  <div style={{ ...secondary, marginTop: 2 }}>{entry.notes}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* spin keyframes (inline, safe) */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
