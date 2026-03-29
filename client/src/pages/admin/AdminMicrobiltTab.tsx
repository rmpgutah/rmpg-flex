import React, { useState, useEffect, useCallback } from 'react';
import {
  DatabaseZap, Key, Eye, EyeOff, Loader2, CheckCircle2, XCircle,
  Trash2, Zap, AlertTriangle, ExternalLink, ToggleLeft, ToggleRight,
  Shield, Search, Users, Landmark, FileSearch, Building2, CreditCard,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

interface Props {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

interface MicrobiltStatus {
  configured: boolean;
  has_subscriber_id: boolean;
  environment: string;
  enabled_products: string[];
  token_cached: boolean;
}

interface TestResult {
  success: boolean;
  message?: string;
  error?: string;
  token_preview?: string;
}

// Microbilt API product catalog organized by category
const PRODUCT_CATALOG: { category: string; icon: React.ElementType; products: { id: string; name: string; desc: string; credentialed?: boolean }[] }[] = [
  {
    category: 'Identity & Application Verification',
    icon: Shield,
    products: [
      { id: 'address_validation', name: 'Address Validation & Standardization', desc: 'USPS-standardized address formatting and classification' },
      { id: 'death_master', name: 'Death Master File Validation', desc: 'Confirm whether an individual is listed as deceased' },
      { id: 'dl_format', name: 'DL Format Validation', desc: 'Validate driver\'s license format for submitted state' },
      { id: 'id_verification', name: 'Identity Verification', desc: 'Verify identity against multiple data sources' },
      { id: 'phone_verification', name: 'Phone Verification', desc: 'Validate and append phone ownership data' },
      { id: 'ssn_verification', name: 'SSN Verification', desc: 'Verify Social Security Number validity and associations' },
    ],
  },
  {
    category: 'Background Screening',
    icon: FileSearch,
    products: [
      { id: 'background_check', name: 'Background Check (QB Command)', desc: 'Combined criminal records, sex offender registry, and court records search via NCIC QB command' },
      { id: 'criminal_records', name: 'Criminal Records Search', desc: 'Search criminal history databases nationwide', credentialed: true },
      { id: 'sex_offender', name: 'Sex Offender Registry', desc: 'Search national sex offender registries' },
      { id: 'public_records', name: 'Public Records Search', desc: 'Search court records, liens, judgments, and bankruptcies' },
      { id: 'employment_verification', name: 'Employment Verification', desc: 'Verify employment history and status', credentialed: true },
    ],
  },
  {
    category: 'Locate People',
    icon: Users,
    products: [
      { id: 'people_search', name: 'People Search', desc: 'Locate individuals by name, SSN, DOB, or address' },
      { id: 'dl_search', name: 'Driver\'s License Search', desc: 'Search DL bureaus by license number or name/address', credentialed: true },
      { id: 'email_search', name: 'Email Search', desc: 'Append known email addresses for an individual' },
      { id: 'phone_search', name: 'Phone Search', desc: 'Reverse phone lookup and phone-to-person matching' },
      { id: 'address_search', name: 'Address Search', desc: 'Find current and historical addresses for an individual' },
    ],
  },
  {
    category: 'Bank Account Verification',
    icon: Landmark,
    products: [
      { id: 'aba_verification', name: 'ABA & Account Schema Verification', desc: 'Validate routing numbers and account number structures' },
      { id: 'ach_prescreen', name: 'ACH & Check Prescreen', desc: 'Prescreen ACH/check payments to reduce fraud risk', credentialed: true },
      { id: 'ach_prescreen_lite', name: 'ACH & Check Prescreen Lite', desc: 'Routing validation with Nacha Web Debit rule support' },
      { id: 'instant_bank', name: 'Instant Bank Verification', desc: 'Real-time bank account ownership verification', credentialed: true },
    ],
  },
  {
    category: 'Credit & Decisioning',
    icon: CreditCard,
    products: [
      { id: 'alt_credit', name: 'Alternative Credit Data', desc: 'Non-traditional credit data for thin-file consumers', credentialed: true },
      { id: 'traditional_credit', name: 'Traditional Credit Report', desc: 'Full credit bureau report with scores', credentialed: true },
    ],
  },
  {
    category: 'Business Credentialing',
    icon: Building2,
    products: [
      { id: 'business_verification', name: 'Business Verification', desc: 'Verify business registration and standing' },
      { id: 'business_valuation', name: 'Industry & Business Valuation', desc: 'Business valuation and industry data' },
    ],
  },
];

// Background Check usage stats sub-panel
function BackgroundCheckUsagePanel() {
  const [usage, setUsage] = useState<{
    totalSearches: number;
    totalHits: number;
    hitRate: number;
    uniqueSubjects: number;
    last30Days: number;
  } | null>(null);

  useEffect(() => {
    apiFetch<any>('/microbilt/background/usage')
      .then(setUsage)
      .catch(() => setUsage(null));
  }, []);

  if (!usage) return null;

  return (
    <div className="panel-beveled bg-surface-base p-3 space-y-2">
      <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
        <FileSearch className="w-3.5 h-3.5" />
        Background Check Usage (QB)
      </div>
      <div className="grid grid-cols-5 gap-2">
        {[
          { label: 'Total Searches', value: usage.totalSearches },
          { label: 'Total Hits', value: usage.totalHits },
          { label: 'Hit Rate', value: `${usage.hitRate}%` },
          { label: 'Unique Subjects', value: usage.uniqueSubjects },
          { label: 'Last 30 Days', value: usage.last30Days },
        ].map(stat => (
          <div key={stat.label} className="bg-surface-sunken p-2 rounded-sm text-center">
            <div className="text-sm font-bold text-rmpg-100">{stat.value}</div>
            <div className="text-[9px] text-rmpg-500 uppercase">{stat.label}</div>
          </div>
        ))}
      </div>
      <div className="text-[9px] text-rmpg-600">
        Results are cached for 30 days to avoid duplicate API charges. Use QB! to force a fresh search.
      </div>
    </div>
  );
}

export default function AdminMicrobiltTab({ LoadingSpinner, error, setError }: Props) {
  // Status
  const [status, setStatus] = useState<MicrobiltStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // Credentials
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [subscriberId, setSubscriberId] = useState('');
  const [environment, setEnvironment] = useState<'sandbox' | 'production'>('sandbox');
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);

  // Connection test
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);

  // Product filter
  const [productSearch, setProductSearch] = useState('');

  // Fetch status
  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiFetch<MicrobiltStatus>('/microbilt/status');
      setStatus(data);
      if (data.environment) setEnvironment(data.environment as 'sandbox' | 'production');
    } catch (err) {
      console.error('Failed to fetch Microbilt status:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // Save credentials
  const handleSaveCredentials = async () => {
    if (!clientId.trim() || !clientSecret.trim()) return;
    setSaving(true);
    setTestResult(null);
    try {
      await apiFetch('/microbilt/credentials', {
        method: 'PUT',
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          subscriber_id: subscriberId || undefined,
          environment,
        }),
      });
      setClientId('');
      setClientSecret('');
      setSubscriberId('');
      setShowSecret(false);
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save credentials');
    } finally {
      setSaving(false);
    }
  };

  // Clear credentials
  const handleClear = async () => {
    try {
      await apiFetch('/microbilt/credentials', { method: 'DELETE' });
      setTestResult(null);
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear credentials');
    }
  };

  // Test connection
  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await apiFetch<TestResult>('/microbilt/test-connection', { method: 'POST' });
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, error: err instanceof Error ? err.message : 'Connection test failed' });
    } finally {
      setTesting(false);
    }
  };

  // Toggle product
  const handleToggleProduct = async (productId: string) => {
    if (!status) return;
    const current = status.enabled_products || [];
    const updated = current.includes(productId)
      ? current.filter(p => p !== productId)
      : [...current, productId];

    try {
      await apiFetch('/microbilt/products', {
        method: 'PUT',
        body: JSON.stringify({ products: updated }),
      });
      setStatus(prev => prev ? { ...prev, enabled_products: updated } : prev);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update products');
    }
  };

  // Update environment
  const handleEnvironmentChange = async (env: 'sandbox' | 'production') => {
    setEnvironment(env);
    if (status?.configured) {
      try {
        await apiFetch('/microbilt/credentials', {
          method: 'PUT',
          body: JSON.stringify({ environment: env }),
        });
        await fetchStatus();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update environment');
      }
    }
  };

  // Set document title — MUST be before any early returns (React hooks rules)
  useEffect(() => { document.title = 'Admin - MicroBilt \u2014 RMPG Flex'; }, []);

  const filteredCatalog = productSearch
    ? PRODUCT_CATALOG.map(cat => ({
        ...cat,
        products: cat.products.filter(p =>
          p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
          p.desc.toLowerCase().includes(productSearch.toLowerCase())
        ),
      })).filter(cat => cat.products.length > 0)
    : PRODUCT_CATALOG;

  if (loading) return <LoadingSpinner />;

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <DatabaseZap className="w-4 h-4 text-brand-400" />
        <h2 className="text-xs font-bold uppercase tracking-wider text-rmpg-200">Microbilt API Integration</h2>
        {status?.configured && (
          <span className="ml-2 flex items-center gap-1 text-green-400 text-[10px]">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
            CONNECTED
          </span>
        )}
        {!status?.configured && (
          <span className="ml-2 flex items-center gap-1 text-rmpg-500 text-[10px]">
            <span className="w-1.5 h-1.5 rounded-full bg-rmpg-500" />
            NOT CONFIGURED
          </span>
        )}
        <a
          href="https://developer.microbilt.com/apis"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto flex items-center gap-1 text-[10px] text-brand-400 hover:text-brand-300"
        >
          <ExternalLink className="w-3 h-3" />
          Developer Portal
        </a>
      </div>

      {/* ═══ Section 1: Credentials ═══ */}
      <div className="panel-beveled bg-surface-base p-3 space-y-3">
        <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
          <Key className="w-3.5 h-3.5" />
          API Credentials
        </div>

        {/* Environment selector */}
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-rmpg-400">Environment:</span>
          <div className="flex items-center gap-1">
            {(['sandbox', 'production'] as const).map(env => (
              <button type="button"
                key={env}
                onClick={() => handleEnvironmentChange(env)}
                className="text-[10px] px-2.5 py-1 rounded-sm transition-colors"
                style={{
                  background: environment === env ? (env === 'production' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(59, 130, 246, 0.15)') : 'transparent',
                  border: environment === env ? `1px solid ${env === 'production' ? 'rgba(239, 68, 68, 0.4)' : 'rgba(59, 130, 246, 0.4)'}` : '1px solid transparent',
                  color: environment === env ? (env === 'production' ? '#f87171' : '#60a5fa') : '#8a9aaa',
                }}
              >
                {env === 'sandbox' ? 'Sandbox' : 'Production'}
              </button>
            ))}
          </div>
          {environment === 'production' && (
            <span className="text-[9px] text-amber-400 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Live API — charges may apply
            </span>
          )}
        </div>

        {/* Client ID */}
        <div className="space-y-1.5">
          <label className="text-[10px] text-rmpg-400">Client ID</label>
          <input
            type="text"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder={status?.configured ? 'Enter new Client ID to replace...' : 'Enter your Microbilt Client ID...'}
            className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2.5 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none font-mono"
          />
        </div>

        {/* Client Secret */}
        <div className="space-y-1.5">
          <label className="text-[10px] text-rmpg-400">Client Secret</label>
          <div className="relative">
            <input
              type={showSecret ? 'text' : 'password'}
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={status?.configured ? 'Enter new secret to replace...' : 'Enter your Microbilt Client Secret...'}
              className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2.5 py-1.5 pr-8 rounded-sm focus:border-brand-500 focus:outline-none font-mono"
            />
            <button type="button"
              onClick={() => setShowSecret(!showSecret)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-rmpg-300"
            >
              {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Subscriber ID (optional) */}
        <div className="space-y-1.5">
          <label className="text-[10px] text-rmpg-400">Subscriber ID <span className="text-rmpg-600">(optional)</span></label>
          <input
            type="text"
            value={subscriberId}
            onChange={(e) => setSubscriberId(e.target.value)}
            placeholder="Required for some credentialed products..."
            className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2.5 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none font-mono"
          />
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button type="button"
            onClick={handleSaveCredentials}
            disabled={saving || !clientId.trim() || !clientSecret.trim()}
            className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <CheckCircle2 className="w-3 h-3" />}
            Save Credentials
          </button>
          {status?.configured && (
            <>
              <button type="button"
                onClick={handleTest}
                disabled={testing}
                className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5"
              >
                {testing ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Zap className="w-3 h-3" />}
                Test Connection
              </button>
              <button type="button"
                onClick={handleClear}
                className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 text-red-400 hover:text-red-300"
              >
                <Trash2 className="w-3 h-3" />
                Clear
              </button>
            </>
          )}
        </div>

        {/* Test result */}
        {testResult && (
          <div className={`flex items-center gap-2 text-[10px] px-2 py-1.5 rounded-sm ${
            testResult.success
              ? 'bg-green-950/30 border border-green-800/40 text-green-400'
              : 'bg-red-950/30 border border-red-800/40 text-red-400'
          }`}>
            {testResult.success ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
            {testResult.success
              ? testResult.message || 'Connection successful'
              : `Connection failed: ${testResult.error}`
            }
          </div>
        )}
      </div>

      {/* ═══ Section 2: API Products Catalog ═══ */}
      <div className="panel-beveled bg-surface-base p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
            <DatabaseZap className="w-3.5 h-3.5" />
            API Products
            {status?.enabled_products && status.enabled_products.length > 0 && (
              <span className="ml-1 text-brand-400">({status.enabled_products.length} enabled)</span>
            )}
          </div>
          <div className="relative">
            <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-rmpg-500" />
            <input
              type="text"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="Filter products..."
              className="bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-[10px] pl-7 pr-2 py-1 rounded-sm w-48 focus:border-brand-500 focus:outline-none"
            />
          </div>
        </div>

        {!status?.configured && (
          <div className="flex items-center gap-2 text-[10px] text-rmpg-500 bg-surface-sunken p-2 rounded-sm">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            Configure your API credentials above to enable product selection.
          </div>
        )}

        {/* Product categories */}
        <div className="space-y-3">
          {filteredCatalog.map((cat) => {
            const CatIcon = cat.icon;
            return (
              <div key={cat.category}>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <CatIcon className="w-3 h-3 text-rmpg-400" />
                  <span className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">{cat.category}</span>
                </div>
                <div className="space-y-0.5">
                  {cat.products.map((product) => {
                    const enabled = status?.enabled_products?.includes(product.id) || false;
                    return (
                      <div
                        key={product.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-sm transition-colors hover:bg-rmpg-800/30"
                        style={{
                          background: enabled ? 'rgba(26, 90, 158, 0.06)' : undefined,
                        }}
                      >
                        <button type="button"
                          onClick={() => status?.configured && handleToggleProduct(product.id)}
                          disabled={!status?.configured}
                          className="shrink-0 disabled:opacity-30"
                        >
                          {enabled
                            ? <ToggleRight className="w-5 h-5 text-brand-400" />
                            : <ToggleLeft className="w-5 h-5 text-rmpg-600" />
                          }
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-[11px] font-medium ${enabled ? 'text-rmpg-100' : 'text-rmpg-300'}`}>
                              {product.name}
                            </span>
                            {product.credentialed && (
                              <span className="text-[8px] font-bold px-1 py-0.5 bg-amber-900/30 text-amber-400 border border-amber-700/30 rounded-sm">
                                CREDENTIALED
                              </span>
                            )}
                          </div>
                          <div className="text-[9px] text-rmpg-500 truncate">{product.desc}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ═══ Section 3: Background Check Usage Stats ═══ */}
      {status?.configured && status?.enabled_products?.includes('background_check') && (
        <BackgroundCheckUsagePanel />
      )}

      {/* Not configured hint */}
      {!status?.configured && (
        <div className="flex items-center gap-2 text-[10px] text-rmpg-500 bg-surface-sunken p-3 rounded-sm">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <div>
            Enter your Microbilt API credentials above to enable the integration.
            You can obtain credentials from the{' '}
            <a
              href="https://developer.microbilt.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-400 hover:text-brand-300 underline"
            >
              Microbilt Developer Portal
            </a>.
          </div>
        </div>
      )}
    </div>
  );
}
