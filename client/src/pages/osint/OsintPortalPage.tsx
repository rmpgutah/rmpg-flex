// ============================================================
// RMPG Flex — OSINT Portal
// ============================================================
// Unified OSINT search interface integrating:
//   - DeepSearch (Gemini 2.5 Flash deep web search)
//   - GoFPS (FastPeopleSearch people lookup)
//   - GoSearch (300+ site username OSINT + breach DBs)
//
// Route: /osint
// ============================================================

import React, { useState, useCallback } from 'react';
import {
  Search, Globe, User, AtSign, Shield, ExternalLink,
  Loader2, AlertTriangle, Clock, Database,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import PanelTitleBar from '../../components/PanelTitleBar';

type Tab = 'deepsearch' | 'people' | 'username';

interface DeepSearchResult {
  ok: boolean;
  answer?: string;
  sources?: Array<{ url: string; title: string; snippet: string }>;
  cached?: boolean;
  error?: string;
}

interface PeopleResult {
  ok: boolean;
  results?: Array<{
    name: string;
    age: number | null;
    address: string;
    phone: string[];
    relatives: string[];
    url: string;
  }>;
  cached?: boolean;
  error?: string;
}

interface UsernameResult {
  ok: boolean;
  profiles?: {
    found: number;
    total_checked: number;
    sites: Array<{ name: string; url: string }>;
    details: Array<{ site: string; url: string; found: boolean; status: number }>;
  };
  breaches?: {
    hudson_rock?: { breaches: Array<{ domain: string; count: number }>; total: number };
    proxynova?: { breaches: number };
    breach_directory?: { found: boolean; total: number };
  };
  cached?: boolean;
  error?: string;
}

export default function OsintPortalPage() {
  const [tab, setTab] = useState<Tab>('deepsearch');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // DeepSearch state
  const [dsQuery, setDsQuery] = useState('');
  const [dsSite, setDsSite] = useState('');
  const [dsResult, setDsResult] = useState<DeepSearchResult | null>(null);

  // People search state
  const [pplName, setPplName] = useState('');
  const [pplCity, setPplCity] = useState('');
  const [pplState, setPplState] = useState('');
  const [pplResult, setPplResult] = useState<PeopleResult | null>(null);

  // Username search state
  const [usrName, setUsrName] = useState('');
  const [usrBreaches, setUsrBreaches] = useState(false);
  const [usrResult, setUsrResult] = useState<UsernameResult | null>(null);

  const handleDeepSearch = useCallback(async () => {
    if (!dsQuery.trim()) return;
    setLoading(true);
    setError(null);
    setDsResult(null);
    try {
      const res = await apiFetch<DeepSearchResult>('/deepsearch/search', {
        method: 'POST',
        body: JSON.stringify({ query: dsQuery, site: dsSite || undefined }),
      });
      setDsResult(res);
    } catch (err: any) {
      setError(err?.message || 'Deep search failed');
    } finally {
      setLoading(false);
    }
  }, [dsQuery, dsSite]);

  const handlePeopleSearch = useCallback(async () => {
    if (!pplName.trim()) return;
    setLoading(true);
    setError(null);
    setPplResult(null);
    try {
      const res = await apiFetch<PeopleResult>('/gofps/search', {
        method: 'POST',
        body: JSON.stringify({ name: pplName, city: pplCity, state: pplState }),
      });
      setPplResult(res);
    } catch (err: any) {
      setError(err?.message || 'People search failed');
    } finally {
      setLoading(false);
    }
  }, [pplName, pplCity, pplState]);

  const handleUsernameSearch = useCallback(async () => {
    if (!usrName.trim()) return;
    setLoading(true);
    setError(null);
    setUsrResult(null);
    try {
      const res = await apiFetch<UsernameResult>('/gosearch/search', {
        method: 'POST',
        body: JSON.stringify({ username: usrName, check_breaches: usrBreaches }),
      });
      setUsrResult(res);
    } catch (err: any) {
      setError(err?.message || 'Username search failed');
    } finally {
      setLoading(false);
    }
  }, [usrName, usrBreaches]);

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'deepsearch', label: 'Deep Search', icon: Globe },
    { id: 'people', label: 'People Search', icon: User },
    { id: 'username', label: 'Username OSINT', icon: AtSign },
  ];

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <PanelTitleBar title="OSINT PORTAL" icon={Search}>
        <div className="flex items-center gap-1.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setError(null); }}
              className={`toolbar-btn ${tab === t.id ? 'bg-rmpg-600 text-white' : ''}`}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          ))}
        </div>
      </PanelTitleBar>

      <div className="flex-1 overflow-hidden flex flex-col p-4 gap-4">
        {error && (
          <div className="flex items-center gap-2 px-3 py-2 bg-red-900/30 border border-red-700 rounded text-sm text-red-300">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* ── Deep Search Tab ─────────────────────────── */}
        {tab === 'deepsearch' && (
          <div className="flex-1 flex flex-col gap-4 overflow-hidden">
            <div className="flex gap-2">
              <input
                type="text"
                value={dsQuery}
                onChange={(e) => setDsQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleDeepSearch()}
                placeholder="Search the web deeply..."
                className="flex-1 px-3 py-2 bg-surface-base border border-rmpg-600 rounded text-sm text-rmpg-100 placeholder:text-rmpg-400 focus:border-blue-500 focus:outline-none"
              />
              <input
                type="text"
                value={dsSite}
                onChange={(e) => setDsSite(e.target.value)}
                placeholder="Site (optional)"
                className="w-48 px-3 py-2 bg-surface-base border border-rmpg-600 rounded text-sm text-rmpg-100 placeholder:text-rmpg-400 focus:border-blue-500 focus:outline-none"
              />
              <button
                onClick={handleDeepSearch}
                disabled={loading || !dsQuery.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-sm text-white font-medium flex items-center gap-1.5"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                Search
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {dsResult?.ok && (
                <div className="space-y-4">
                  {dsResult.cached && (
                    <div className="flex items-center gap-1.5 text-xs text-rmpg-400">
                      <Clock className="w-3 h-3" /> Cached result
                    </div>
                  )}
                  {dsResult.answer && (
                    <div className="p-4 bg-surface-base border border-rmpg-600 rounded">
                      <div className="text-sm font-semibold text-brand-400 mb-2">Answer</div>
                      <div className="text-sm text-rmpg-200 whitespace-pre-wrap leading-relaxed">{dsResult.answer}</div>
                    </div>
                  )}
                  {dsResult.sources && dsResult.sources.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-sm font-semibold text-brand-400">Sources ({dsResult.sources.length})</div>
                      {dsResult.sources.map((s, i) => (
                        <a
                          key={i}
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block p-3 bg-surface-base border border-rmpg-600 rounded hover:border-blue-500 transition-colors"
                        >
                          <div className="flex items-center gap-2 text-sm text-blue-400">
                            <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
                            <span className="font-medium truncate">{s.title || s.url}</span>
                          </div>
                          {s.snippet && (
                            <div className="mt-1 text-xs text-rmpg-300 line-clamp-2">{s.snippet}</div>
                          )}
                          <div className="mt-1 text-xs text-rmpg-500 truncate">{s.url}</div>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {!dsResult && !loading && (
                <div className="text-center text-rmpg-400 text-sm py-12">
                  Enter a query to perform a deep web search powered by Gemini 2.5 Flash
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── People Search Tab ───────────────────────── */}
        {tab === 'people' && (
          <div className="flex-1 flex flex-col gap-4 overflow-hidden">
            <div className="flex gap-2">
              <input
                type="text"
                value={pplName}
                onChange={(e) => setPplName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handlePeopleSearch()}
                placeholder="Full name"
                className="flex-1 px-3 py-2 bg-surface-base border border-rmpg-600 rounded text-sm text-rmpg-100 placeholder:text-rmpg-400 focus:border-blue-500 focus:outline-none"
              />
              <input
                type="text"
                value={pplCity}
                onChange={(e) => setPplCity(e.target.value)}
                placeholder="City"
                className="w-40 px-3 py-2 bg-surface-base border border-rmpg-600 rounded text-sm text-rmpg-100 placeholder:text-rmpg-400 focus:border-blue-500 focus:outline-none"
              />
              <input
                type="text"
                value={pplState}
                onChange={(e) => setPplState(e.target.value)}
                placeholder="State"
                className="w-28 px-3 py-2 bg-surface-base border border-rmpg-600 rounded text-sm text-rmpg-100 placeholder:text-rmpg-400 focus:border-blue-500 focus:outline-none"
              />
              <button
                onClick={handlePeopleSearch}
                disabled={loading || !pplName.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-sm text-white font-medium flex items-center gap-1.5"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <User className="w-3.5 h-3.5" />}
                Search
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {pplResult?.ok && pplResult.results && (
                <div className="space-y-2">
                  {pplResult.cached && (
                    <div className="flex items-center gap-1.5 text-xs text-rmpg-400 mb-2">
                      <Clock className="w-3 h-3" /> Cached result
                    </div>
                  )}
                  {pplResult.results.length === 0 ? (
                    <div className="text-center text-rmpg-400 text-sm py-12">No results found</div>
                  ) : (
                    pplResult.results.map((person, i) => (
                      <a
                        key={i}
                        href={person.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block p-3 bg-surface-base border border-rmpg-600 rounded hover:border-blue-500 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium text-rmpg-100">{person.name}</div>
                          {person.age && (
                            <span className="text-xs text-rmpg-400">Age {person.age}</span>
                          )}
                        </div>
                        {person.address && (
                          <div className="mt-1 text-xs text-rmpg-300">{person.address}</div>
                        )}
                        {person.phone.length > 0 && (
                          <div className="mt-1 text-xs text-rmpg-400">
                            {person.phone.join(' | ')}
                          </div>
                        )}
                        {person.relatives.length > 0 && (
                          <div className="mt-1 text-xs text-rmpg-500">
                            Relatives: {person.relatives.slice(0, 3).join(', ')}
                          </div>
                        )}
                      </a>
                    ))
                  )}
                </div>
              )}
              {!pplResult && !loading && (
                <div className="text-center text-rmpg-400 text-sm py-12">
                  Search FastPeopleSearch for people by name, city, and state
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Username OSINT Tab ──────────────────────── */}
        {tab === 'username' && (
          <div className="flex-1 flex flex-col gap-4 overflow-hidden">
            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={usrName}
                onChange={(e) => setUsrName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleUsernameSearch()}
                placeholder="Username"
                className="flex-1 px-3 py-2 bg-surface-base border border-rmpg-600 rounded text-sm text-rmpg-100 placeholder:text-rmpg-400 focus:border-blue-500 focus:outline-none"
              />
              <label className="flex items-center gap-1.5 text-xs text-rmpg-300">
                <input
                  type="checkbox"
                  checked={usrBreaches}
                  onChange={(e) => setUsrBreaches(e.target.checked)}
                  className="rounded"
                />
                Breach DB
              </label>
              <button
                onClick={handleUsernameSearch}
                disabled={loading || !usrName.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-sm text-white font-medium flex items-center gap-1.5"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AtSign className="w-3.5 h-3.5" />}
                Search
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {usrResult?.ok && usrResult.profiles && (
                <div className="space-y-4">
                  {usrResult.cached && (
                    <div className="flex items-center gap-1.5 text-xs text-rmpg-400">
                      <Clock className="w-3 h-3" /> Cached result
                    </div>
                  )}

                  {/* Profile Summary */}
                  <div className="p-3 bg-surface-base border border-rmpg-600 rounded">
                    <div className="text-sm font-semibold text-brand-400 mb-1">Profiles Found</div>
                    <div className="text-2xl font-bold text-rmpg-100">
                      {usrResult.profiles.found}
                      <span className="text-sm font-normal text-rmpg-400 ml-1">
                        / {usrResult.profiles.total_checked} checked
                      </span>
                    </div>
                  </div>

                  {/* Found Sites */}
                  {usrResult.profiles.sites.length > 0 && (
                    <div>
                      <div className="text-sm font-semibold text-brand-400 mb-2">Active Profiles</div>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                        {usrResult.profiles.sites.map((site, i) => (
                          <a
                            key={i}
                            href={site.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 p-2 bg-green-900/20 border border-green-700/50 rounded text-xs text-green-300 hover:bg-green-900/30 transition-colors"
                          >
                            <ExternalLink className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate">{site.name}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Breach Data */}
                  {usrResult.breaches && (
                    <div className="p-3 bg-surface-base border border-rmpg-600 rounded">
                      <div className="text-sm font-semibold text-brand-400 mb-2 flex items-center gap-1.5">
                        <Shield className="w-4 h-4" />
                        Breach Intelligence
                      </div>
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <div className="text-rmpg-400 text-xs">HudsonRock</div>
                          <div className="text-rmpg-100 font-medium">
                            {usrResult.breaches.hudson_rock?.total ?? 0} sessions
                          </div>
                        </div>
                        <div>
                          <div className="text-rmpg-400 text-xs">ProxyNova</div>
                          <div className="text-rmpg-100 font-medium">
                            {usrResult.breaches.proxynova?.breaches ?? 0} records
                          </div>
                        </div>
                        <div>
                          <div className="text-rmpg-400 text-xs">BreachDirectory</div>
                          <div className="text-rmpg-100 font-medium">
                            {usrResult.breaches.breach_directory?.found ? 'Found' : 'None'}
                          </div>
                        </div>
                      </div>
                      {usrResult.breaches.hudson_rock && usrResult.breaches.hudson_rock.breaches.length > 0 && (
                        <div className="mt-3">
                          <div className="text-xs text-rmpg-400 mb-1">Top leaked domains:</div>
                          <div className="flex flex-wrap gap-1">
                            {usrResult.breaches.hudson_rock.breaches.slice(0, 10).map((b, i) => (
                              <span key={i} className="px-1.5 py-0.5 bg-rmpg-700 rounded text-xs text-rmpg-200">
                                {b.domain} ({b.count})
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* All Sites Detail */}
                  {usrResult.profiles.details.length > 0 && (
                    <div>
                      <div className="text-sm font-semibold text-brand-400 mb-2 flex items-center gap-1.5">
                        <Database className="w-4 h-4" />
                        All Checked Sites ({usrResult.profiles.details.length})
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-1">
                        {usrResult.profiles.details.map((d, i) => (
                          <div
                            key={i}
                            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs ${
                              d.found
                                ? 'bg-green-900/20 text-green-300'
                                : 'bg-rmpg-800 text-rmpg-500'
                            }`}
                          >
                            <div className={`w-1.5 h-1.5 rounded-full ${d.found ? 'bg-green-400' : 'bg-rmpg-600'}`} />
                            {d.site}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {!usrResult && !loading && (
                <div className="text-center text-rmpg-400 text-sm py-12">
                  Search 300+ websites for a username's digital footprint and check leaked credential databases
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
