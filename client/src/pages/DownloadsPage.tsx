import React, { useEffect, useRef, useState } from 'react';
import { Monitor, Apple, Smartphone, Download, ChevronRight } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '../hooks/useApi';

type Platform = 'win' | 'mac' | 'android';

interface InstallerMeta {
  filename: string;
  version: string;
  size: string;
  bytes: number;
  releaseDate?: string;
}

interface DownloadsInfo {
  mac?: InstallerMeta;
  win?: InstallerMeta;
  android?: InstallerMeta;
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
  if (lower === 'win' || lower.includes('win') || lower.endsWith('.exe') || lower.endsWith('.zip')) return 'win';
  return null;
}

export default function DownloadsPage() {
  const recommended = getRecommendedPlatform();
  const [info, setInfo] = useState<DownloadsInfo>({});
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [activeTab, setActiveTab] = useState<Platform>(recommended);
  const [searchParams, setSearchParams] = useSearchParams();

  // Refs used by the N shortcut to programmatically click the active download link.
  const downloadRefs = useRef<Record<Platform, HTMLAnchorElement | null>>({
    win: null,
    mac: null,
    android: null,
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

  const platforms: Platform[] = ['win', 'mac', 'android'];

  const STEPS: Record<Platform, { title: string; steps: string[]; warning?: string }> = {
    win: {
      title: 'Windows',
      steps: [
        'Download the Windows .zip package using the button above.',
        'Right-click the downloaded .zip file and select "Extract All...".',
        'Open the extracted folder and double-click "RMPG Flex Setup 5.8.0.exe" to install.',
        'If Windows SmartScreen appears, click "More info" then "Run anyway" to finish.',
      ],
      warning: 'Windows SmartScreen note: Because Windows SmartScreen heavily flags raw executable files (.exe) downloaded directly, we bundle the installer in a .zip archive to bypass SmartScreen and browser security protocols automatically. If Windows Defender still prompts, simply select "More info" followed by "Run anyway".',
    },
    mac: {
      title: 'macOS',
      steps: [
        'Download the .dmg file using the button above.',
        'Open Terminal (Cmd+Space, type "Terminal") and run: xattr -d com.apple.quarantine ~/Downloads/RMPG\\ Flex-*.dmg',
        'Open the .dmg file and drag RMPG Flex into the Applications folder.',
        'Run: sudo xattr -cr /Applications/RMPG\\ Flex.app (enter your password)',
        'Right-click the app → Open → click Open. Future launches work normally.',
      ],
      warning: 'Getting "damaged and can\'t be opened"? Run both: xattr -d com.apple.quarantine ~/Downloads/RMPG\\ Flex-*.dmg and sudo xattr -cr /Applications/RMPG\\ Flex.app',
    },
    android: {
      title: 'Android',
      steps: [
        'Download the Android installation package .zip file above.',
        'Extract the zip package using your phone\'s Files/My Files manager app.',
        'Tap and open the extracted "RMPG Flex-5.8.0.apk" file.',
        'Enable "Install from Unknown Sources" for your browser/file explorer if prompted, then tap Install.',
      ],
      warning: 'Since this app is distributed internally rather than through the Google Play Store, Android requires bundling the app (.apk) inside a .zip to bypass browser protocol blocks. Safe Browsing will let you extract and run it seamlessly.',
    },
  };

  // ── Version display ───────────────────────────────────────────────────────
  const displayVersion = !loading
    ? (info.win?.version ?? info.mac?.version ?? info.android?.version ?? '5.8.0')
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
            <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--rmpg-500)' }}>
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
              color: '#d4a017',
              borderRadius: 2,
            }}
          >
            {loading ? 'Loading...' : `v${displayVersion}`}
          </div>
          <h2 className="text-3xl font-bold text-rmpg-100 mb-3">Download RMPG Flex</h2>
          <p className="text-sm max-w-lg mx-auto leading-relaxed" style={{ color: 'var(--rmpg-500)' }}>
            Install RMPG Flex on your computer or phone. The full CAD/RMS dispatch system — available as a
            desktop app, Android app, or in any web browser.
          </p>
        </div>

        {/* ── Loading state ─────────────────────────────────────────────── */}
        {loading && (
          <div
            className="flex items-center justify-center py-16 mb-12"
            style={{ background: 'var(--surface-base)', border: '1px solid var(--border-subtle)', borderRadius: 2 }}
          >
            <span className="text-xs uppercase tracking-wider" style={{ color: 'var(--rmpg-500)' }}>
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
            <span className="text-xs uppercase tracking-wider" style={{ color: 'var(--rmpg-500)' }}>
              Could not load download info — check your connection and refresh.
            </span>
          </div>
        )}

        {/* ── Download Cards (shown after successful load) ───────────────── */}
        {!loading && !fetchError && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
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
                    border: isRecommended ? '1px solid #d4a017' : '1px solid var(--border-subtle)',
                    borderRadius: 2,
                  }}
                >
                  {isRecommended && (
                    <span
                      className="absolute -top-3 left-1/2 -translate-x-1/2 text-[9px] font-bold uppercase tracking-wider px-3 py-0.5"
                      style={{
                        background: '#d4a017',
                        color: 'var(--surface-sunken)',
                        borderRadius: 2,
                      }}
                    >
                      Recommended
                    </span>
                  )}

                  <Icon className="w-10 h-10 mb-3" style={{ color: '#d4a017' }} />
                  <h3 className="text-base font-bold text-rmpg-100 mb-1">{config.label}</h3>
                  <span className="text-[11px] mb-3" style={{ color: 'var(--rmpg-500)' }}>{config.arch}</span>

                  {installer ? (
                    <>
                      <span className="text-[11px] mb-4" style={{ color: 'var(--rmpg-500)' }}>
                        v{installer.version} — {installer.size}
                      </span>
                      <a
                        ref={(el) => { downloadRefs.current[p] = el; }}
                        href={`/downloads/${encodeURIComponent(installer.filename)}`}
                        download={installer.filename}
                        className="inline-flex items-center gap-2 px-5 py-2 text-xs font-bold uppercase tracking-wider transition-colors"
                        style={{
                          background: 'linear-gradient(180deg, var(--surface-raised) 0%, var(--surface-base) 100%)',
                          border: '1px solid #d4a017',
                          color: '#d4a017',
                          borderRadius: 2,
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'linear-gradient(180deg, var(--surface-overlay) 0%, var(--surface-raised) 100%)';
                          e.currentTarget.style.borderColor = '#e8b52a';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'linear-gradient(180deg, var(--surface-raised) 0%, var(--surface-base) 100%)';
                          e.currentTarget.style.borderColor = '#d4a017';
                        }}
                      >
                        <Download className="w-3.5 h-3.5" />
                        {config.buttonLabel}
                      </a>
                    </>
                  ) : (
                    <span className="text-xs mt-4" style={{ color: 'var(--rmpg-500)' }}>Not available</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Web App Banner */}
        <div
          className="flex items-center justify-between gap-4 p-4 mb-8"
          style={{ background: 'var(--surface-overlay)', border: '1px solid var(--border-subtle)', borderRadius: 2 }}
        >
          <div>
            <h4 className="text-sm font-bold text-rmpg-100 mb-1">Use in Browser</h4>
            <p className="text-xs" style={{ color: 'var(--rmpg-500)' }}>
              No download needed. Open the full RMPG Flex web app in any browser on any device.
            </p>
          </div>
          <a
            href="/"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors whitespace-nowrap"
            style={{
              background: 'var(--surface-raised)',
              border: '1px solid var(--border-default)',
              color: 'var(--rmpg-300)',
              borderRadius: 2,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--border-default)'; e.currentTarget.style.borderColor = 'var(--rmpg-500)'; }}
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
          <h4 className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: '#d4a017' }}>
            What's Included
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            {[
              'Full CAD/RMS dispatch system',
              'Real-time WebSocket dispatch updates',
              'Mapbox GL JS + OpenLayers tactical map integration',
              'Incident, records, warrants, citations management',
              'Fleet management & patrol checkpoints',
              'Personnel, training & equipment tracking',
              'Reports, analytics & audit trail',
              'Automatic updates — always stay on the latest version',
            ].map((feature, i) => (
              <div key={i} className="flex items-center gap-2 text-xs" style={{ color: 'var(--rmpg-400)' }}>
                <span style={{ color: 'var(--green-500, #4ade80)' }}>&#10003;</span>
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
          <h4 className="text-[11px] font-bold uppercase tracking-wider mb-4" style={{ color: '#d4a017' }}>
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
                  color: activeTab === p ? '#d4a017' : 'var(--rmpg-600)',
                  borderBottom: activeTab === p ? '2px solid #d4a017' : '2px solid transparent',
                }}
              >
                {PLATFORM_CONFIG[p].label}
              </button>
            ))}
          </div>

          {/* Steps */}
          <div className="space-y-0">
            {STEPS[activeTab].steps.map((step, i) => (
              <div key={i} className="flex gap-3 py-2.5 border-b last:border-b-0" style={{ borderColor: 'var(--surface-raised)' }}>
                <span
                  className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-[11px] font-bold"
                  style={{
                    background: 'var(--surface-overlay)',
                    color: '#d4a017',
                    borderRadius: 2,
                  }}
                >
                  {i + 1}
                </span>
                <span className="text-xs leading-relaxed" style={{ color: 'var(--rmpg-400)' }}>
                  {step}
                </span>
              </div>
            ))}
            {STEPS[activeTab].warning && (
              <div
                className="mt-3 p-3 text-xs leading-relaxed"
                style={{
                  background: 'var(--surface-sunken)',
                  border: '1px solid var(--border-default)',
                  color: 'var(--brand-300, #f59e0b)',
                  borderRadius: 2,
                }}
              >
                <strong style={{ color: 'var(--brand-200, #fbbf24)' }}>Note:</strong>{' '}
                {STEPS[activeTab].warning}
              </div>
            )}
          </div>
        </div>

        {/* System Requirements */}
        <div
          className="p-5"
          style={{ background: 'var(--surface-overlay)', border: '1px solid var(--border-subtle)', borderRadius: 2 }}
        >
          <h4 className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--rmpg-500)' }}>
            System Requirements
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="text-xs leading-relaxed" style={{ color: 'var(--rmpg-500)' }}>
              <strong style={{ color: 'var(--rmpg-400)' }}>Windows:</strong> Windows 10 or later<br />
              64-bit (x64) processor
            </div>
            <div className="text-xs leading-relaxed" style={{ color: 'var(--rmpg-500)' }}>
              <strong style={{ color: 'var(--rmpg-400)' }}>macOS:</strong> macOS 10.15 (Catalina) or later<br />
              Apple Silicon (M1/M2/M3/M4) or Intel
            </div>
            <div className="text-xs leading-relaxed" style={{ color: 'var(--rmpg-500)' }}>
              <strong style={{ color: 'var(--rmpg-400)' }}>Android:</strong> Android 8.0 (Oreo) or later<br />
              Any modern smartphone or tablet
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center py-8 text-[10px] tracking-wider" style={{ color: 'var(--rmpg-600)' }}>
        <span id="footer-version">
          RMPG Flex v{loading ? '…' : displayVersion}
        </span>
        {' — '}Rocky Mountain Protective Group, LLC<br />
        <a href="/" className="no-underline" style={{ color: 'var(--rmpg-500)' }}>Open Flex Web App</a>
      </div>
    </div>
  );
}
