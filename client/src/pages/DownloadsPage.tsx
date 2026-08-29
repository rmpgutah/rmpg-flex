import React, { useEffect, useRef, useState } from 'react';
import { Monitor, Apple, Smartphone, Download, ChevronRight, HardDrive } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { apiFetch } from '../hooks/useApi';
import { copyToClipboard } from '../utils/contextMenuActions';
import WindowsInstallGuide from '../components/install/WindowsInstallGuide';
import MacInstallGuide from '../components/install/MacInstallGuide';
import AndroidInstallGuide from '../components/install/AndroidInstallGuide';
import KioskOsInstallGuide from '../components/install/KioskOsInstallGuide';

type Platform = 'win' | 'mac' | 'android' | 'os';

interface InstallerMeta {
  filename: string;
  version: string;
  size: string;
  bytes: number;
  releaseDate?: string;
  /**
   * Absolute URL supplied by the API. Never build this client-side: a relative
   * "/downloads/<file>" resolves against Pages, which has no route for it, so
   * the SPA catch-all returns index.html with HTTP 200 and the browser saves
   * ~11 KB of HTML under the artifact's filename with no error shown.
   */
  url: string;
  /** Hex SHA-256. Absent for artifacts published before checksums existed. */
  sha256?: string;
}

interface DownloadsInfo {
  mac?: InstallerMeta;
  win?: InstallerMeta;
  android?: InstallerMeta;
  os?: InstallerMeta;
}

interface ReleaseNote {
  version: string;
  releaseDate: string;
  notes: string[];
}

const PLATFORM_CONFIG: Record<Platform, {
  label: string;
  arch: string;
  icon: React.ElementType;
  ext: string;
  buttonLabel: string;
}> = {
  win: {
    label: 'Windows',
    arch: '64-bit (x64)',
    icon: Monitor,
    ext: '.zip',
    buttonLabel: 'Download .zip',
  },
  mac: {
    label: 'macOS',
    arch: 'Apple Silicon (M1/M2/M3/M4)',
    icon: Apple,
    ext: '.dmg',
    buttonLabel: 'Download .dmg',
  },
  android: {
    label: 'Android',
    arch: 'Android 8.0+ (ARM/x86)',
    icon: Smartphone,
    ext: '.zip',
    buttonLabel: 'Download .zip',
  },
  os: {
    label: 'Kiosk Linux OS',
    arch: 'Toughbook FZ-55 / x86_64',
    icon: HardDrive,
    ext: '.zip',
    buttonLabel: 'Download .zip',
  },
};

function getRecommendedPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('android')) return 'android';
  if (ua.includes('mac')) return 'mac';
  return 'win';
}

// Map a file_id query param to a platform tab. Supports bare platform names
// ('win', 'mac', 'android') and filenames containing platform keywords.
function platformFromFileId(fileId: string): Platform | null {
  const lower = fileId.toLowerCase();
  if (lower === 'mac' || lower.includes('mac') || lower.includes('darwin') || lower.endsWith('.dmg')) return 'mac';
  if (lower === 'android' || lower.includes('android') || lower.endsWith('.apk')) return 'android';
  if (lower === 'os' || lower.includes('kiosk-linux') || lower.endsWith('.tar.gz')) return 'os';
  if (lower === 'win' || lower.includes('win') || lower.endsWith('.exe') || lower.endsWith('.zip')) return 'win';
  return null;
}

export default function DownloadsPage() {
  const recommended = getRecommendedPlatform();
  const [info, setInfo] = useState<DownloadsInfo>({});
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [changelog, setChangelog] = useState<ReleaseNote[]>([]);
  const [showAllChangelog, setShowAllChangelog] = useState(false);
  const [activeTab, setActiveTab] = useState<Platform>(recommended);
  const [searchParams, setSearchParams] = useSearchParams();
  // Dial Connect's icon is hosted on a separate domain (dialer.rmpgutah.us) and
  // depends on a concurrently-shipping PWA deploy, so it may 404 — fall back to
  // a bundled lucide icon rather than showing a broken-image glyph.
  const [dialConnectIconFailed, setDialConnectIconFailed] = useState(false);

  // Refs used by the N shortcut to programmatically click the active download link.
  const downloadRefs = useRef<Record<Platform, HTMLAnchorElement | null>>({
    win: null,
    mac: null,
    android: null,
    os: null,
  });

  // ── Deep-link: ?file_id=<platform|filename> ──────────────────────────────
  // Read on mount, resolve to a tab, then strip the param (replace: true so
  // the back-button returns to the referrer rather than the param URL).
  useEffect(() => {
    const fileId = searchParams.get('file_id');
    if (!fileId) return;
    const platform = platformFromFileId(fileId);
    if (platform) setActiveTab(platform);
    setSearchParams({}, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    apiFetch<DownloadsInfo>('/api/downloads/info')
      .then((data) => {
        setInfo(data);
        setLoading(false);
      })
      .catch(() => {
        setFetchError(true);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    apiFetch<ReleaseNote[]>('/api/downloads/changelog')
      .then((data) => setChangelog(data))
      .catch(() => setChangelog([]));
  }, []);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  // N   — trigger the download link for the currently-active platform tab.
  // Esc — if on a non-recommended tab, snap back to the recommended one;
  //        otherwise blur any focused element.
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const recommendedRef = useRef(recommended);
  recommendedRef.current = recommended;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        e.stopPropagation();
        downloadRefs.current[activeTabRef.current]?.click();
        return;
      }

      if (e.key === 'Escape') {
        e.stopPropagation();
        if (activeTabRef.current !== recommendedRef.current) {
          setActiveTab(recommendedRef.current);
        } else {
          (document.activeElement as HTMLElement | null)?.blur();
        }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  const platforms: Platform[] = ['win', 'mac', 'android', 'os'];

  const winExampleName = info.win?.filename?.replace(/\.zip$/, '.exe') ?? 'RMPG Flex Setup.exe';
  const androidExampleName = info.android?.filename?.replace(/\.zip$/, '.apk') ?? 'RMPG Flex.apk';

  // Each platform's step-by-step instructions live in their own guide
  // component under components/install/ — they are long enough (real
  // troubleshooting, copyable commands, post-install guidance) that keeping
  // them inline here would bury the rest of the page.
  const GUIDES: Record<Platform, React.ReactNode> = {
    win: <WindowsInstallGuide exeName={winExampleName} />,
    mac: <MacInstallGuide />,
    android: <AndroidInstallGuide apkName={androidExampleName} />,
    os: <KioskOsInstallGuide />,
  };

  // ── Version display ───────────────────────────────────────────────────────
  const displayVersion = !loading
    ? (info.win?.version ?? info.mac?.version ?? info.android?.version ?? info.os?.version ?? '5.8.5')
    : null;

  return (
    <div className="min-h-screen" style={{ background: 'var(--surface-sunken)' }}>
      {/* Header */}
      <div className="border-b" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-overlay)' }}>
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-4">
          <img
            src="/rmpg flex.png"
            alt="RMPG Flex"
            className="w-10 h-10 rounded-full"
            style={{ objectFit: 'contain' }}
          />
          <div>
            <h1 className="text-sm font-bold uppercase tracking-wider text-rmpg-100">RMPG Flex</h1>
            <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              CAD / RMS Dispatch System
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-12">
        {/* Hero */}
        <div className="text-center mb-12">
          <div
            className="inline-block text-[11px] font-bold uppercase tracking-wider px-3 py-1 mb-4"
            style={{
              background: 'var(--surface-raised)',
              border: '1px solid var(--border-default)',
              color: 'var(--accent-silver-400)',
              borderRadius: 2,
            }}
          >
            {loading ? 'Loading...' : `v${displayVersion}`}
          </div>
          <h2 className="text-3xl font-bold text-rmpg-100 mb-3">Download RMPG Flex</h2>
          <p className="text-sm max-w-lg mx-auto leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            Install RMPG Flex on your computer or phone. The full CAD/RMS dispatch system — available as a
            desktop app, Android app, or in any web browser.
          </p>
        </div>

        {/* What's New */}
        {changelog.length > 0 && (
          <div
            className="p-5 mb-8"
            style={{ background: 'var(--surface-overlay)', border: '1px solid var(--border-subtle)', borderRadius: 2 }}
          >
            {/* Section headers are one of the two sanctioned gold roles (the other
                is field labels); everything else accent-tinted on this page is silver. */}
            <h4 className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--panel-header-color)' }}>
              What's New
            </h4>
            {(showAllChangelog ? changelog : changelog.slice(0, 1)).map((entry) => (
              <div key={entry.version} className="mb-4 last:mb-0">
                <div className="text-xs font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>
                  v{entry.version} — {entry.releaseDate}
                </div>
                <div className="space-y-1">
                  {entry.notes.map((note, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      <span style={{ color: 'var(--accent-silver-600)' }}>&bull;</span>
                      {note}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {changelog.length > 1 && (
              <button
                type="button"
                onClick={() => setShowAllChangelog((v) => !v)}
                className="text-[11px] font-bold uppercase tracking-wider mt-2"
                style={{ color: 'var(--text-muted)' }}
              >
                {showAllChangelog ? 'Show less' : `Show ${changelog.length - 1} more`}
              </button>
            )}
          </div>
        )}

        {/* ── Loading state ─────────────────────────────────────────────── */}
        {loading && (
          <div
            className="flex items-center justify-center py-16 mb-12"
            style={{ background: 'var(--surface-base)', border: '1px solid var(--border-subtle)', borderRadius: 2 }}
          >
            <span className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Loading download info…
            </span>
          </div>
        )}

        {/* ── Error state ───────────────────────────────────────────────── */}
        {!loading && fetchError && (
          <div
            className="flex items-center justify-center py-16 mb-12"
            style={{ background: 'var(--surface-base)', border: '1px solid var(--border-subtle)', borderRadius: 2 }}
          >
            <span className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Could not load download info — check your connection and refresh.
            </span>
          </div>
        )}

        {/* ── Download Cards (shown after successful load) ───────────────── */}
        {!loading && !fetchError && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
            {platforms.map((p) => {
              const config = PLATFORM_CONFIG[p];
              const installer = info[p as keyof DownloadsInfo];
              const isRecommended = p === recommended && !!installer;
              const Icon = config.icon;

              return (
                <div
                  key={p}
                  className="relative flex flex-col items-center p-6 text-center transition-colors"
                  style={{
                    background: 'var(--surface-base)',
                    border: isRecommended ? '1px solid var(--accent-silver-500)' : '1px solid var(--border-subtle)',
                    borderRadius: 2,
                  }}
                >
                  {isRecommended && (
                    <span
                      className="absolute -top-3 left-1/2 -translate-x-1/2 text-[9px] font-bold uppercase tracking-wider px-3 py-0.5"
                      style={{
                        background: 'var(--accent-silver-500)',
                        color: 'var(--surface-sunken)',
                        borderRadius: 2,
                      }}
                    >
                      Recommended
                    </span>
                  )}

                  <Icon className="w-10 h-10 mb-3" style={{ color: 'var(--accent-silver-500)' }} />
                  <h3 className="text-base font-bold text-rmpg-100 mb-1">{config.label}</h3>
                  <span className="text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>{config.arch}</span>

                  {installer ? (
                    <>
                      {/* Exact byte count in the tooltip: the friendly size is
                          binary-units (what Windows shows), so macOS Finder
                          reports a larger number for the same file. Exposing
                          the exact bytes makes "did my download complete?"
                          answerable without guessing at unit conventions. */}
                      <span
                        className="text-[11px] mb-4"
                        style={{ color: 'var(--text-muted)' }}
                        title={`${installer.bytes.toLocaleString()} bytes exactly`}
                      >
                        v{installer.version} — {installer.size}
                      </span>
                      <a
                        ref={(el) => { downloadRefs.current[p] = el; }}
                        href={installer.url}
                        download={installer.filename}
                        className="inline-flex items-center gap-2 px-5 py-2 text-xs font-bold uppercase tracking-wider transition-colors"
                        style={{
                          background: 'linear-gradient(180deg, var(--surface-raised) 0%, var(--surface-base) 100%)',
                          // Longhands, not the `border` shorthand. A var() inside a
                          // shorthand makes every border longhand a pending-substitution
                          // value, which serialises lossily — the DOM then reports
                          // `border-top-style: ;` and reading/rewriting cssText drops
                          // border-color outright. The hover handler below mutates
                          // borderColor, so keep the declaration in longhand form.
                          borderWidth: 1,
                          borderStyle: 'solid',
                          borderColor: 'var(--accent-silver-500)',
                          color: 'var(--accent-silver-500)',
                          borderRadius: 2,
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'linear-gradient(180deg, var(--surface-overlay) 0%, var(--surface-raised) 100%)';
                          e.currentTarget.style.borderColor = 'var(--accent-silver-400)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'linear-gradient(180deg, var(--surface-raised) 0%, var(--surface-base) 100%)';
                          e.currentTarget.style.borderColor = 'var(--accent-silver-500)';
                        }}
                      >
                        <Download className="w-3.5 h-3.5" />
                        {config.buttonLabel}
                      </a>
                      {/* Guarded, not defaulted: artifacts published before
                          scripts/publish-download.mjs existed carry no
                          checksum, and rendering "undefined" next to a
                          download would be worse than showing nothing. */}
                      {installer.sha256 && (
                        <div className="mt-2 text-[9px] leading-snug max-w-[220px] break-all">
                          <span style={{ color: 'var(--field-label-color)' }}>SHA-256</span>{' '}
                          <code className="font-mono" style={{ color: 'var(--text-secondary)' }}>{installer.sha256}</code>
                          <button type="button" className="ml-1 underline" style={{ color: 'var(--text-secondary)' }} onClick={() => void copyToClipboard(installer.sha256!)}>Copy hash</button>
                        </div>
                      )}
                      <button type="button" className="mt-1 text-[9px] underline" style={{ color: 'var(--text-secondary)' }} onClick={() => void copyToClipboard(installer.url)}>Copy download URL</button>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-2 mt-4">
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Build not yet published</span>
                      <a
                        href="/"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors"
                        style={{
                          background: 'var(--surface-raised)',
                          borderWidth: 1,
                          borderStyle: 'solid',
                          borderColor: 'var(--border-default)',
                          color: 'var(--text-secondary)',
                          borderRadius: 2,
                        }}
                      >
                        Use Web App Instead
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Dial Connect — a separate product, not another RMPG Flex platform build */}
        <div
          className="flex items-center justify-between gap-4 p-4 mb-8"
          style={{ background: 'var(--surface-overlay)', border: '1px solid var(--border-subtle)', borderRadius: 2 }}
        >
          <div className="flex items-center gap-3">
            {dialConnectIconFailed ? (
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)' }}
              >
                <Smartphone className="w-5 h-5" style={{ color: 'var(--brand-gold)' }} />
              </div>
            ) : (
              <img
                src="https://dialer.rmpgutah.us/icons/icon-192.png"
                alt="Dial Connect"
                className="w-10 h-10 rounded-full"
                style={{ objectFit: 'contain' }}
                onError={() => setDialConnectIconFailed(true)}
              />
            )}
            <div>
              <h4 className="text-sm font-bold text-rmpg-100 mb-1">Dial Connect</h4>
              <p className="text-xs text-rmpg-500">
                E911 dispatch companion &mdash; install as an app on any device.
              </p>
            </div>
          </div>
          <a
            href="https://dialer.rmpgutah.us"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors whitespace-nowrap"
            style={{
              background: 'linear-gradient(180deg, var(--surface-raised) 0%, var(--surface-base) 100%)',
              border: '1px solid var(--brand-gold)',
              color: 'var(--brand-gold)',
              borderRadius: 2,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'linear-gradient(180deg, var(--surface-overlay) 0%, var(--surface-raised) 100%)'; e.currentTarget.style.borderColor = 'rgb(var(--brand-gold-400-rgb))'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'linear-gradient(180deg, var(--surface-raised) 0%, var(--surface-base) 100%)'; e.currentTarget.style.borderColor = 'var(--brand-gold)'; }}
          >
            Open Dial Connect
            <ChevronRight className="w-3.5 h-3.5" />
          </a>
        </div>

        {/* Web App Banner */}
        <div
          className="flex items-center justify-between gap-4 p-4 mb-8"
          style={{ background: 'var(--surface-overlay)', border: '1px solid var(--border-subtle)', borderRadius: 2 }}
        >
          <div>
            <h4 className="text-sm font-bold text-rmpg-100 mb-1">Use in Browser</h4>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              No download needed. Open the full RMPG Flex web app in any browser on any device.
            </p>
          </div>
          <a
            href="/"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors whitespace-nowrap"
            style={{
              background: 'var(--surface-raised)',
              border: '1px solid var(--border-default)',
              color: 'var(--text-secondary)',
              borderRadius: 2,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--border-default)'; e.currentTarget.style.borderColor = 'var(--border-strong)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface-raised)'; e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
          >
            Open Web App
            <ChevronRight className="w-3.5 h-3.5" />
          </a>
        </div>

        {/* Features */}
        <div
          className="p-5 mb-8"
          style={{ background: 'var(--surface-overlay)', border: '1px solid var(--border-subtle)', borderRadius: 2 }}
        >
          <h4 className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--panel-header-color)' }}>
            What's Included
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            {[
              'Full CAD/RMS dispatch system',
              'Real-time WebSocket dispatch updates',
              'Mapbox GL JS tactical map integration',
              'Incident, records, warrants, citations management',
              'ALPR vehicle capture & plate screening',
              'Fleet management & patrol checkpoints',
              'Personnel, training & equipment tracking',
              'Reports, analytics & audit trail',
              'Dedicated kiosk terminal OS image for fixed installs',
              'Automatic updates — always stay on the latest version',
            ].map((feature, i) => (
              <div key={i} className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                <span style={{ color: 'var(--sev-ok)' }}>&#10003;</span>
                {feature}
              </div>
            ))}
          </div>
        </div>

        {/* Installation Guide */}
        <div
          className="p-5 mb-8"
          style={{ background: 'var(--surface-overlay)', border: '1px solid var(--border-subtle)', borderRadius: 2 }}
        >
          <h4 className="text-[11px] font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--panel-header-color)' }}>
            Installation Guide
          </h4>

          {/* Platform tabs */}
          <div className="flex border-b mb-4" style={{ borderColor: 'var(--border-subtle)' }}>
            {platforms.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setActiveTab(p)}
                className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider transition-colors"
                style={{
                  color: activeTab === p ? 'var(--accent-active)' : 'var(--text-muted)',
                  borderBottom: activeTab === p ? '2px solid var(--accent-active)' : '2px solid transparent',
                }}
              >
                {PLATFORM_CONFIG[p].label}
              </button>
            ))}
          </div>

          {/* The full guide for the selected platform. */}
          {GUIDES[activeTab]}
        </div>

        {/* System Requirements */}
        <div
          className="p-5"
          style={{ background: 'var(--surface-overlay)', border: '1px solid var(--border-subtle)', borderRadius: 2 }}
        >
          <h4 className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>
            System Requirements
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              <strong style={{ color: 'var(--text-secondary)' }}>Windows:</strong> Windows 10 or later<br />
              64-bit (x64) processor
            </div>
            <div className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              <strong style={{ color: 'var(--text-secondary)' }}>macOS:</strong> macOS 11 (Big Sur) or later<br />
              Apple Silicon only (M1/M2/M3/M4) — not Intel
            </div>
            <div className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              <strong style={{ color: 'var(--text-secondary)' }}>Android:</strong> Android 8.0 (Oreo) or later<br />
              Any modern smartphone or tablet
            </div>
            <div className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              <strong style={{ color: 'var(--text-secondary)' }}>Kiosk Linux OS:</strong> Panasonic Toughbook FZ-55<br />
              (or QEMU x86_64) — dedicated kiosk terminals; see dossier above
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center py-8 text-[10px] tracking-wider" style={{ color: 'var(--text-muted)' }}>
        <span id="footer-version">
          RMPG Flex v{loading ? '…' : displayVersion}
        </span>
        {' — '}Rocky Mountain Protective Group, LLC<br />
        <a href="/" className="no-underline" style={{ color: 'var(--text-muted)' }}>Open Flex Web App</a>
      </div>
    </div>
  );
}
