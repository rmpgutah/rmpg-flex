import React, { useState, useEffect, useCallback } from 'react';
import {
  WifiOff, Wifi, RefreshCw, Key, Clock, Users, Database,
  AlertTriangle, Check, Loader2, Shield, Trash2,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useOfflineMode } from '../../hooks/useOfflineMode';
import PinGeneratorModal from '../../components/PinGeneratorModal';
import type { User } from '../../types';

interface AdminOfflineTabProps {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (err: string | null) => void;
}

interface PinSecret {
  user_id: number;
  username: string;
  full_name: string;
  badge_number: string | null;
  has_secret: boolean;
  created_at: string | null;
}

const timeAgo = (date: string): string => {
  if (!date) return '—';
  const parsed = new Date(date).getTime();
  if (Number.isNaN(parsed)) return '—';
  const ms = Date.now() - parsed;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

export default function AdminOfflineTab({ LoadingSpinner, error, setError }: AdminOfflineTabProps) {
  const {
    isOfflineCapable,
    isOffline,
    isLocalAuthorized,
    isSyncing,
    syncStatus,
    syncQueueDepth,
    pinCountdown,
    triggerSync,
  } = useOfflineMode();

  // ── State ──────────────────────────────────────────────────
  const [users, setUsers] = useState<User[]>([]);
  const [secrets, setSecrets] = useState<PinSecret[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [generatingSingle, setGeneratingSingle] = useState<number | null>(null);
  const [pinModalOpen, setPinModalOpen] = useState(false);

  // ── Data fetching ──────────────────────────────────────────

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [usersRes, secretsRes] = await Promise.all([
        apiFetch<any[]>('/personnel'),
        apiFetch<any>('/offline/secrets').catch(() => ({ secrets: [] })),
      ]);

      setUsers(Array.isArray(usersRes) ? usersRes : []);

      // Build a map of which users have secrets
      const secretsList = secretsRes?.secrets || [];
      const secretMap = new Map<number, any>(secretsList.map((s: any) => [s.user_id, s]));

      const enriched: PinSecret[] = (Array.isArray(usersRes) ? usersRes : []).map((u: any) => {
        const secret = secretMap.get(u.id);
        return {
          user_id: u.id,
          username: u.username,
          full_name: u.full_name || `${u.first_name || ''} ${u.last_name || ''}`.trim(),
          badge_number: u.badge_number,
          has_secret: !!secret,
          created_at: secret?.created_at || null,
        };
      });

      setSecrets(enriched);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load offline data');
    } finally {
      setLoading(false);
    }
  }, [setError]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Generate secret for a single user ──────────────────────
  const handleGenerateSecret = useCallback(async (userId: number) => {
    setGeneratingSingle(userId);
    try {
      await apiFetch('/offline/secrets/generate', {
        method: 'POST',
        body: JSON.stringify({ user_id: userId }),
      });
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate secret');
    } finally {
      setGeneratingSingle(null);
    }
  }, [fetchData, setError]);

  // ── Generate secrets for all users ─────────────────────────
  const handleGenerateAll = useCallback(async () => {
    setGeneratingAll(true);
    try {
      const result = await apiFetch<{ generated: number }>('/offline/secrets/generate-all', {
        method: 'POST',
      });
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate secrets');
    } finally {
      setGeneratingAll(false);
    }
  }, [fetchData, setError]);

  // ── Stats ──────────────────────────────────────────────────
  const totalUsers = secrets.length;
  const usersWithSecrets = secrets.filter(s => s.has_secret).length;
  const employeesWithoutSecrets = secrets.filter(s => !s.has_secret && s.username !== 'admin');

  // Set document title
  useEffect(() => { document.title = 'Admin - Offline \u2014 RMPG Flex'; }, []);

  // Keyboard shortcut: Escape to close modals
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setPinModalOpen(false); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  if (loading) return <LoadingSpinner />;


  if (loading) return <LoadingSpinner />;

  return (
    <div className="p-4 space-y-5 animate-fade-in">
      {/* ── Connection Status Card ─────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Status */}
        <div className="panel-beveled p-4">
          <div className="flex items-center gap-2 mb-2">
            {isOffline ? (
              <WifiOff className="w-4 h-4 text-amber-500" />
            ) : (
              <Wifi className="w-4 h-4 text-green-500" />
            )}
            <span className="text-xs font-bold text-white">
              {isOffline ? 'OFFLINE' : 'ONLINE'}
            </span>
          </div>
          <div className="text-[10px] text-rmpg-400 space-y-1">
            {isOfflineCapable ? (
              <>
                <div>
                  Local auth: {' '}
                  <span className={isLocalAuthorized ? 'text-green-400' : 'text-rmpg-500'}>
                    {isLocalAuthorized ? 'Authorized' : 'Not active'}
                  </span>
                </div>
                {pinCountdown && (
                  <div>PIN expires in: <span className="text-amber-400">{pinCountdown}</span></div>
                )}
              </>
            ) : (
              <div className="text-rmpg-500">Offline mode initializing...</div>
            )}
          </div>
        </div>

        {/* Sync Queue */}
        <div className="panel-beveled p-4">
          <div className="flex items-center gap-2 mb-2">
            <Database className="w-4 h-4 text-blue-400" />
            <span className="text-xs font-bold text-white">Sync Queue</span>
          </div>
          <div className="text-[10px] text-rmpg-400 space-y-1">
            <div>
              Pending items: <span className="text-white font-bold">{syncQueueDepth}</span>
            </div>
            {isSyncing && (
              <div className="flex items-center gap-1 text-blue-400">
                <RefreshCw className="w-3 h-3 animate-spin" />
                {syncStatus.phase === 'push' ? 'Pushing' : 'Pulling'} {syncStatus.table}
                ({syncStatus.current}/{syncStatus.total})
              </div>
            )}
          </div>
          {isOfflineCapable && (
            <button type="button"
              onClick={triggerSync}
              disabled={isSyncing}
              className="mt-2 flex items-center gap-1 px-2 py-1 text-[10px] transition-colors"
              style={{
                background: '#1e3048',
                border: '1px solid #2a3e58',
                color: isSyncing ? '#3a5070' : '#8a9aaa',
              }}
            >
              <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Syncing...' : 'Force Sync Now'}
            </button>
          )}
        </div>

        {/* PIN Secrets Summary */}
        <div className="panel-beveled p-4">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-bold text-white">PIN Secrets</span>
          </div>
          <div className="text-[10px] text-rmpg-400 space-y-1">
            <div>
              Users configured: <span className="text-white font-bold">{usersWithSecrets}</span> / {totalUsers}
            </div>
            {employeesWithoutSecrets.length > 0 && (
              <div className="text-amber-400">
                <AlertTriangle className="w-3 h-3 inline mr-1" />
                {employeesWithoutSecrets.length} employee{employeesWithoutSecrets.length > 1 ? 's' : ''} without secrets
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── PIN Generation ──────────────────────────────────── */}
      <div className="panel-beveled p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-amber-500" />
            <span className="text-xs font-bold text-white">PIN Generation</span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button"
              onClick={handleGenerateAll}
              disabled={generatingAll}
              className="flex items-center gap-1 px-3 py-1.5 text-[10px] transition-colors"
              style={{
                background: '#1e3048',
                border: '1px solid #2a3e58',
                color: generatingAll ? '#3a5070' : '#8a9aaa',
              }}
            >
              {generatingAll ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Shield className="w-3 h-3" />}
              {generatingAll ? 'Generating...' : 'Generate All Missing Secrets'}
            </button>
            {isOfflineCapable && (
              <button type="button"
                onClick={() => setPinModalOpen(true)}
                className="btn-primary text-[10px] py-1.5"
                style={{ borderColor: '#d97706' }}
              >
                <Key className="w-3 h-3" />
                Generate PIN for Employee
              </button>
            )}
          </div>
        </div>

        <p className="text-[10px] text-rmpg-400 mb-3 leading-relaxed">
          Each employee needs an offline secret before a PIN can be generated for them.
          Secrets are created on the server and synced to the desktop app.
          PINs are computed locally using HMAC-SHA256 and are valid for 24 hours (midnight to midnight Mountain Time).
        </p>

        {/* User secrets table */}
        <div className="overflow-auto" style={{ maxHeight: '400px' }}>
          <table className="table-dark w-full">
            <thead>
              <tr>
                <th className="text-left">Employee</th>
                <th className="text-left">Username</th>
                <th className="text-left">Badge</th>
                <th className="text-center">Secret</th>
                <th className="text-left">Created</th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {secrets
                .sort((a, b) => a.full_name.localeCompare(b.full_name))
                .map(s => (
                <tr key={s.user_id}>
                  <td className="text-xs text-white">{s.full_name || '—'}</td>
                  <td className="text-xs text-rmpg-300 font-mono">{s.username}</td>
                  <td className="text-xs text-rmpg-400">{s.badge_number || '—'}</td>
                  <td className="text-center">
                    {s.has_secret ? (
                      <Check className="w-3.5 h-3.5 text-green-500 inline" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 inline" />
                    )}
                  </td>
                  <td className="text-[10px] text-rmpg-400 font-mono">
                    {s.created_at ? new Date(s.created_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="text-center">
                    {!s.has_secret ? (
                      <button type="button"
                        onClick={() => handleGenerateSecret(s.user_id)}
                        disabled={generatingSingle === s.user_id}
                        className="text-[10px] px-2 py-0.5 transition-colors"
                        style={{
                          background: '#1e3048',
                          border: '1px solid #2a3e58',
                          color: generatingSingle === s.user_id ? '#3a5070' : '#d97706',
                        }}
                      >
                        {generatingSingle === s.user_id ? (
                          <Loader2 className="w-3 h-3 animate-spin inline" role="status" aria-label="Loading" />
                        ) : (
                          'Generate'
                        )}
                      </button>
                    ) : (
                      <button type="button"
                        onClick={() => handleGenerateSecret(s.user_id)}
                        disabled={generatingSingle === s.user_id}
                        className="text-[10px] px-2 py-0.5 text-rmpg-500 hover:text-amber-400 transition-colors"
                        style={{ background: '#141e2b', border: '1px solid #1e3048' }}
                        title="Rotate secret (invalidates current PINs)"
                      >
                        {generatingSingle === s.user_id ? (
                          <Loader2 className="w-3 h-3 animate-spin inline" role="status" aria-label="Loading" />
                        ) : (
                          'Rotate'
                        )}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── How It Works ────────────────────────────────────── */}
      <div className="panel-beveled p-4">
        <div className="flex items-center gap-2 mb-2">
          <Clock className="w-4 h-4 text-rmpg-400" />
          <span className="text-xs font-bold text-white">How Offline PINs Work</span>
        </div>
        <ol className="text-[10px] text-rmpg-400 space-y-1 list-decimal list-inside leading-relaxed">
          <li>Generate offline secrets for employees using the table above (one-time setup)</li>
          <li>Secrets sync to the app (desktop or browser) automatically while online</li>
          <li>When internet goes down, open this tab and click <strong className="text-amber-400">Generate PIN for Employee</strong></li>
          <li>Read the 6-digit PIN to the employee over the phone</li>
          <li>Employee enters the PIN on their app to unlock 24-hour local data entry</li>
          <li>All data entered offline syncs automatically when internet returns</li>
          <li>Admin accounts always have full offline access — no PIN required</li>
        </ol>
      </div>

      {/* PIN Generator Modal */}
      <PinGeneratorModal
        isOpen={pinModalOpen}
        onClose={() => setPinModalOpen(false)}
        users={users}
      />
    </div>
  );
}
