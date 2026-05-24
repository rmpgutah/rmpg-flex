import React, { useEffect, useState } from 'react';
import { Monitor, Apple, Smartphone, Download, ExternalLink, SmartphoneCharging, Globe, ChevronRight } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

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

interface Props {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

type PlatformId = 'win' | 'mac' | 'android' | 'ios';

interface PlatformConfig {
  label: string;
  arch: string;
  icon: React.ElementType;
  ext: string;
  buttonLabel: string;
  comingSoon?: boolean;
}

const PLATFORMS: { id: PlatformId; config: PlatformConfig }[] = [
  {
    id: 'win',
    config: {
      label: 'Windows',
      arch: '64-bit (x64)',
      icon: Monitor,
      ext: '.exe',
      buttonLabel: 'Download .exe',
    },
  },
  {
    id: 'mac',
    config: {
      label: 'macOS',
      arch: 'Apple Silicon (M1–M4)',
      icon: Apple,
      ext: '.dmg',
      buttonLabel: 'Download .dmg',
    },
  },
  {
    id: 'android',
    config: {
      label: 'Android',
      arch: 'Android 8.0+ (ARM/x86)',
      icon: Smartphone,
      ext: '.apk',
      buttonLabel: 'Download .apk',
    },
  },
  {
    id: 'ios',
    config: {
      label: 'iPhone / iOS',
      arch: 'iOS 15.0+',
      icon: SmartphoneCharging,
      ext: '',
      buttonLabel: 'Web App Available',
      comingSoon: true,
    },
  },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export default function AdminDownloadsTab({ LoadingSpinner, error, setError }: Props) {
  const [info, setInfo] = useState<DownloadsInfo>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<DownloadsInfo>('/api/downloads/info')
      .then((data) => {
        setInfo(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  if (loading) return <LoadingSpinner />;

  const version = info.win?.version || info.mac?.version || info.android?.version || '5.8.0';

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-sm font-bold tracking-wider text-white uppercase">Download Installers</h2>
          <p className="text-[11px] mt-0.5" style={{ color: '#666' }}>
            Current version: <span className="text-[#d4a017] font-semibold">v{version}</span>
            {' \u2014 '}Download the RMPG Flex desktop or mobile app
          </p>
        </div>
      </div>

      {/* Platform Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {PLATFORMS.map(({ id, config }) => {
          const Icon = config.icon;
          const installer = info[id as keyof DownloadsInfo];

          return (
            <div
              key={id}
              className="flex flex-col items-center p-5 text-center transition-colors"
              style={{
                background: '#141414',
                border: installer && !config.comingSoon ? '1px solid #2a2a2a' : '1px solid #1a1a1a',
                borderRadius: 2,
                opacity: config.comingSoon ? 0.65 : 1,
              }}
            >
              <Icon className="w-9 h-9 mb-3" style={{ color: config.comingSoon ? '#555' : '#d4a017' }} />
              <h3 className="text-sm font-bold text-white mb-0.5">{config.label}</h3>
              <span className="text-[10px] mb-3" style={{ color: '#555' }}>{config.arch}</span>

              {installer && !config.comingSoon ? (
                <>
                  <span className="text-[10px] mb-3" style={{ color: '#555' }}>
                    v{installer.version} — {installer.size}
                  </span>
                  <a
                    href={`/downloads/${encodeURIComponent(installer.filename)}`}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors"
                    style={{
                      background: 'linear-gradient(180deg, #1a1a1a 0%, #141414 100%)',
                      border: '1px solid #d4a017',
                      color: '#d4a017',
                      borderRadius: 2,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'linear-gradient(180deg, #242424 0%, #1a1a1a 100%)';
                      e.currentTarget.style.borderColor = '#e8b52a';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'linear-gradient(180deg, #1a1a1a 0%, #141414 100%)';
                      e.currentTarget.style.borderColor = '#d4a017';
                    }}
                  >
                    <Download className="w-3 h-3" />
                    {config.buttonLabel}
                  </a>
                </>
              ) : config.comingSoon ? (
                <>
                  <span className="text-[10px] mb-3" style={{ color: '#555' }}>Native build pending</span>
                  <a
                    href="/"
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors"
                    style={{
                      background: '#1a1a1a',
                      border: '1px solid #333',
                      color: '#888',
                      borderRadius: 2,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#242424'; e.currentTarget.style.borderColor = '#555'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = '#1a1a1a'; e.currentTarget.style.borderColor = '#333'; }}
                  >
                    <Globe className="w-3 h-3" />
                    Open Web App
                    <ChevronRight className="w-3 h-3" />
                  </a>
                </>
              ) : (
                <span className="text-[10px]" style={{ color: '#555' }}>Not available</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Installer Files Table */}
      <div
        className="overflow-hidden"
        style={{ border: '1px solid #1a1a1a', borderRadius: 2 }}
      >
        <div
          className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider"
          style={{ background: '#0d0d0d', borderBottom: '1px solid #1a1a1a', color: '#888' }}
        >
          Available Installer Files
        </div>
        <div style={{ background: '#0a0a0a' }}>
          {(() => {
            const entries: { platform: string; filename: string; version: string; size: string; url: string }[] = [];
            const platformLabels: Record<string, string> = { win: 'Windows', mac: 'macOS', android: 'Android' };
            for (const [key, val] of Object.entries(info)) {
              if (val) {
                entries.push({
                  platform: platformLabels[key] || key,
                  filename: val.filename,
                  version: val.version,
                  size: val.size,
                  url: `/downloads/${encodeURIComponent(val.filename)}`,
                });
              }
            }
            if (entries.length === 0) {
              return (
                <div className="px-3 py-4 text-[11px] text-center" style={{ color: '#555' }}>
                  No installer files found. Build and copy installers to the downloads directory.
                </div>
              );
            }
            return entries.map((entry, i) => (
              <div
                key={entry.filename}
                className="flex items-center justify-between px-3 py-2 text-[11px]"
                style={{ borderBottom: i < entries.length - 1 ? '1px solid #111' : 'none' }}
              >
                <div className="flex items-center gap-4">
                  <span className="font-semibold text-white w-16">{entry.platform}</span>
                  <span style={{ color: '#888' }}>{entry.filename}</span>
                  <span style={{ color: '#666' }}>v{entry.version}</span>
                  <span style={{ color: '#555' }}>{entry.size}</span>
                </div>
                <a
                  href={entry.url}
                  className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider transition-colors px-2.5 py-1"
                  style={{ color: '#d4a017', border: '1px solid #333', borderRadius: 2 }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#d4a017'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#333'; }}
                >
                  <Download className="w-3 h-3" />
                  Download
                </a>
              </div>
            ));
          })()}
        </div>
      </div>

      {/* Build Instructions */}
      <div
        className="p-3"
        style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 2 }}
      >
        <h4 className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: '#666' }}>
          Build &amp; Deploy Installers
        </h4>
        <div className="space-y-1 text-[10px] leading-relaxed" style={{ color: '#555' }}>
          <p><span className="text-rmpg-400">1.</span> <code className="text-[#d4a017]">cd desktop &amp;&amp; npm run build:all</code></p>
          <p><span className="text-rmpg-400">2.</span> <code className="text-[#d4a017]">node scripts/copyToDownloads.cjs</code></p>
          <p><span className="text-rmpg-400">3.</span> <code className="text-[#d4a017]">bash deploy/deploy.sh</code></p>
        </div>
      </div>
    </div>
  );
}
