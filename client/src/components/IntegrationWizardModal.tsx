// ============================================================
// RMPG Flex — Integration Setup Wizard Modal
// Multi-step guided configuration for third-party integrations
// ============================================================

import React, { useState, useEffect } from 'react';
import {
  X, ArrowRight, ArrowLeft, CheckCircle, AlertTriangle,
  Loader2, MapPin, Briefcase, Shield, Microscope,
  Download, RefreshCw,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';

// ─── Props ──────────────────────────────────────────────

interface IntegrationWizardModalProps {
  isOpen: boolean;
  integrationId: string | null;
  onClose: () => void;
  onComplete: () => void;
}

// ─── Wizard Config Registry ─────────────────────────────

interface WizardField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'select';
  placeholder?: string;
  defaultValue?: string;
  options?: string[];
  required?: boolean;
}

interface WizardConfig {
  name: string;
  icon: React.ElementType;
  description: string;
  credentialHelp: string;
  fields: WizardField[];
  configureEndpoint: string;
  configureMethod: string;
  testEndpoint: string;
  syncEndpoint: string | null;
}

const WIZARD_CONFIGS: Record<string, WizardConfig> = {
  clearpathgps: {
    name: 'ClearPathGPS',
    icon: MapPin,
    description: 'Connect to ClearPathGPS for real-time fleet vehicle tracking, GPS breadcrumbs, trip history, and driver alerts.',
    credentialHelp: 'You\'ll need your ClearPathGPS account name, API username, and password. Contact your ClearPathGPS administrator if you don\'t have these credentials.',
    fields: [
      { key: 'account', label: 'Account Name', type: 'text', placeholder: 'Your ClearPathGPS account name', required: true },
      { key: 'user', label: 'Username', type: 'text', placeholder: 'API username', required: true },
      { key: 'password', label: 'Password', type: 'password', placeholder: 'API password', required: true },
      { key: 'base_url', label: 'Base URL', type: 'text', placeholder: 'https://api.clearpathgps.com', defaultValue: 'https://api.clearpathgps.com' },
    ],
    configureEndpoint: '/clearpathgps/configure',
    configureMethod: 'POST',
    testEndpoint: '/clearpathgps/test',
    syncEndpoint: '/clearpathgps/sync',
  },
  servemanager: {
    name: 'ServeManager',
    icon: Briefcase,
    description: 'Connect to ServeManager for service of process job tracking, server attempt monitoring, and court case integration.',
    credentialHelp: 'You\'ll need your ServeManager API key. Find it in your ServeManager account under Settings > API.',
    fields: [
      { key: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your ServeManager API key', required: true },
    ],
    configureEndpoint: '/servemanager/api-key',
    configureMethod: 'PUT',
    testEndpoint: '/servemanager/test-connection',
    syncEndpoint: '/servemanager/sync',
  },
  microbilt: {
    name: 'Microbilt',
    icon: Shield,
    description: 'Connect to Microbilt for background screening, driver license verification, and OFAC SDN watch list monitoring.',
    credentialHelp: 'You\'ll need your Microbilt OAuth client ID, client secret, and subscriber ID. Contact Microbilt support for API access.',
    fields: [
      { key: 'client_id', label: 'Client ID', type: 'text', placeholder: 'OAuth client ID', required: true },
      { key: 'client_secret', label: 'Client Secret', type: 'password', placeholder: 'OAuth client secret', required: true },
      { key: 'subscriber_id', label: 'Subscriber ID', type: 'text', placeholder: 'Microbilt subscriber ID', required: true },
      { key: 'environment', label: 'Environment', type: 'select', options: ['sandbox', 'production'], defaultValue: 'sandbox' },
    ],
    configureEndpoint: '/microbilt/credentials',
    configureMethod: 'PUT',
    testEndpoint: '/microbilt/test-connection',
    syncEndpoint: '/microbilt/ofac/sync',
  },
  iped: {
    name: 'IPED Digital Forensics',
    icon: Microscope,
    description: 'Connect to IPED for digital forensics case management, evidence indexing, regex findings import, and timeline synchronization.',
    credentialHelp: 'You\'ll need the URL of your IPED server and optionally an API key. IPED should be running on the local network.',
    fields: [
      { key: 'base_url', label: 'IPED Server URL', type: 'text', placeholder: 'http://localhost:8080', required: true },
      { key: 'api_key', label: 'API Key', type: 'password', placeholder: 'IPED API key (optional if using local network)' },
    ],
    configureEndpoint: '/iped/configure',
    configureMethod: 'PUT',
    testEndpoint: '/iped/test-connection',
    syncEndpoint: null,
  },
};

// ─── Wizard Steps ───────────────────────────────────────

type WizardStep = 'welcome' | 'credentials' | 'testing' | 'sync' | 'done';

const STEPS: WizardStep[] = ['welcome', 'credentials', 'testing', 'sync', 'done'];

// ─── Component ──────────────────────────────────────────

export default function IntegrationWizardModal({
  isOpen,
  integrationId,
  onClose,
  onComplete,
}: IntegrationWizardModalProps) {
  const [step, setStep] = useState<WizardStep>('welcome');
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const config = integrationId ? WIZARD_CONFIGS[integrationId] : null;

  // Reset state when integrationId changes
  useEffect(() => {
    if (integrationId && WIZARD_CONFIGS[integrationId]) {
      setStep('welcome');
      setTestResult(null);
      setSyncResult(null);
      setError(null);
      const defaults: Record<string, string> = {};
      WIZARD_CONFIGS[integrationId].fields.forEach(f => {
        if (f.defaultValue) defaults[f.key] = f.defaultValue;
      });
      setFormValues(defaults);
    }
  }, [integrationId]);

  // ─── Handlers ───────────────────────────────────────

  const handleTest = async () => {
    if (!config) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiFetch<any>(config.testEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formValues),
      });
      setTestResult({ success: true, message: res.message || 'Connection successful' });
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || 'Connection failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveCredentials = async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(config.configureEndpoint, {
        method: config.configureMethod,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formValues),
      });
      setStep('testing');
      // Auto-start test
      handleTest();
    } catch (err: any) {
      setError(err.message || 'Failed to save credentials');
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    if (!config?.syncEndpoint) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await apiFetch<any>(config.syncEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      setSyncResult({ success: true, message: res.message || 'Sync complete' });
    } catch (err: any) {
      setSyncResult({ success: false, message: err.message || 'Sync failed' });
    } finally {
      setSyncing(false);
    }
  };

  // ─── Render ─────────────────────────────────────────

  if (!isOpen || !integrationId || !config) return null;

  const Icon = config.icon;
  const currentStepIndex = STEPS.indexOf(step);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-surface-raised border border-rmpg-700/50 panel-beveled w-full max-w-lg mx-4" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-700/30">
          <div className="flex items-center gap-2">
            <Icon className="w-4 h-4 text-brand-400" />
            <span className="text-xs font-bold text-white uppercase tracking-wide">Setup {config.name}</span>
          </div>
          <button onClick={onClose} className="text-rmpg-500 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        {/* Step indicator bar */}
        <div className="flex items-center gap-1 px-4 py-2 bg-surface-sunken border-b border-rmpg-700/30">
          {STEPS.map((s, i) => (
            <React.Fragment key={s}>
              {i > 0 && <div className="flex-1 h-px bg-rmpg-700" />}
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold ${
                step === s ? 'bg-brand-500 text-white' :
                currentStepIndex > i ? 'bg-green-600 text-white' :
                'bg-rmpg-700 text-rmpg-500'
              }`}>{i + 1}</div>
            </React.Fragment>
          ))}
        </div>

        {/* Step content */}
        <div className="p-4 space-y-4">
          {/* WELCOME STEP */}
          {step === 'welcome' && (
            <div className="space-y-3 text-center py-4">
              <Icon className="w-10 h-10 text-brand-400 mx-auto" />
              <h3 className="text-sm font-bold text-white">{config.name}</h3>
              <p className="text-[10px] text-rmpg-400 max-w-sm mx-auto">{config.description}</p>
              <div className="panel-beveled bg-surface-sunken p-3 text-left">
                <p className="text-[9px] text-rmpg-300 font-semibold uppercase mb-1">What You'll Need</p>
                <p className="text-[10px] text-rmpg-400">{config.credentialHelp}</p>
              </div>
              <button onClick={() => setStep('credentials')} className="toolbar-btn toolbar-btn-primary text-[10px] mx-auto flex items-center gap-1" style={{ padding: '4px 16px' }}>
                Get Started <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* CREDENTIALS STEP */}
          {step === 'credentials' && (
            <div className="space-y-3">
              <p className="text-[9px] text-rmpg-400 font-bold uppercase">Enter Credentials</p>
              {config.fields.map(field => (
                <div key={field.key}>
                  <label className="text-[9px] text-rmpg-400 uppercase font-semibold block mb-0.5">
                    {field.label} {field.required && '*'}
                  </label>
                  {field.type === 'select' ? (
                    <select
                      className="select-dark w-full text-xs"
                      value={formValues[field.key] || ''}
                      onChange={e => setFormValues(v => ({ ...v, [field.key]: e.target.value }))}
                    >
                      {field.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  ) : (
                    <input
                      type={field.type}
                      className="input-dark w-full text-xs"
                      placeholder={field.placeholder}
                      value={formValues[field.key] || ''}
                      onChange={e => setFormValues(v => ({ ...v, [field.key]: e.target.value }))}
                    />
                  )}
                </div>
              ))}
              {error && (
                <div className="flex items-center gap-2 text-red-400 text-[10px]">
                  <AlertTriangle className="w-3 h-3" /> {error}
                </div>
              )}
              <div className="flex items-center justify-between pt-2">
                <button onClick={() => setStep('welcome')} className="toolbar-btn text-[9px] flex items-center gap-1" style={{ padding: '3px 10px' }}>
                  <ArrowLeft className="w-3 h-3" /> Back
                </button>
                <button
                  onClick={handleSaveCredentials}
                  className="toolbar-btn toolbar-btn-primary text-[9px] flex items-center gap-1"
                  style={{ padding: '3px 10px' }}
                  disabled={saving || config.fields.filter(f => f.required).some(f => !formValues[f.key]?.trim())}
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRight className="w-3 h-3" />} Save & Test
                </button>
              </div>
            </div>
          )}

          {/* TESTING STEP */}
          {step === 'testing' && (
            <div className="space-y-4 text-center py-4">
              {testing ? (
                <>
                  <Loader2 className="w-8 h-8 text-brand-400 mx-auto animate-spin" />
                  <p className="text-xs text-rmpg-300">Testing connection to {config.name}...</p>
                </>
              ) : testResult ? (
                <>
                  {testResult.success ? (
                    <>
                      <CheckCircle className="w-10 h-10 text-green-400 mx-auto" />
                      <p className="text-xs text-green-400 font-semibold">Connection Successful</p>
                      <p className="text-[10px] text-rmpg-400">{testResult.message}</p>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-10 h-10 text-red-400 mx-auto" />
                      <p className="text-xs text-red-400 font-semibold">Connection Failed</p>
                      <p className="text-[10px] text-rmpg-400">{testResult.message}</p>
                    </>
                  )}
                </>
              ) : null}
              <div className="flex items-center justify-between pt-2">
                <button onClick={() => setStep('credentials')} className="toolbar-btn text-[9px] flex items-center gap-1" style={{ padding: '3px 10px' }}>
                  <ArrowLeft className="w-3 h-3" /> Back
                </button>
                <div className="flex gap-2">
                  {testResult && !testResult.success && (
                    <button onClick={handleTest} className="toolbar-btn text-[9px] flex items-center gap-1" style={{ padding: '3px 10px' }}>
                      <RefreshCw className="w-3 h-3" /> Retry
                    </button>
                  )}
                  {testResult?.success && (
                    <button onClick={() => setStep(config.syncEndpoint ? 'sync' : 'done')} className="toolbar-btn toolbar-btn-primary text-[9px] flex items-center gap-1" style={{ padding: '3px 10px' }}>
                      {config.syncEndpoint ? 'Next' : 'Finish'} <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* SYNC STEP */}
          {step === 'sync' && (
            <div className="space-y-4 text-center py-4">
              {syncing ? (
                <>
                  <Loader2 className="w-8 h-8 text-brand-400 mx-auto animate-spin" />
                  <p className="text-xs text-rmpg-300">Syncing data from {config.name}...</p>
                  <p className="text-[9px] text-rmpg-500">This may take a moment</p>
                </>
              ) : syncResult ? (
                <>
                  {syncResult.success ? (
                    <CheckCircle className="w-10 h-10 text-green-400 mx-auto" />
                  ) : (
                    <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto" />
                  )}
                  <p className={`text-xs font-semibold ${syncResult.success ? 'text-green-400' : 'text-amber-400'}`}>
                    {syncResult.success ? 'Initial Sync Complete' : 'Sync had issues'}
                  </p>
                  <p className="text-[10px] text-rmpg-400">{syncResult.message}</p>
                </>
              ) : (
                <>
                  <Download className="w-10 h-10 text-brand-400 mx-auto" />
                  <p className="text-xs text-white font-semibold">Initial Data Sync</p>
                  <p className="text-[10px] text-rmpg-400">Pull the latest data from {config.name} into RMPG Flex.</p>
                </>
              )}
              <div className="flex items-center justify-between pt-2">
                <button onClick={() => setStep('testing')} className="toolbar-btn text-[9px] flex items-center gap-1" style={{ padding: '3px 10px' }}>
                  <ArrowLeft className="w-3 h-3" /> Back
                </button>
                <div className="flex gap-2">
                  {!syncing && !syncResult && (
                    <>
                      <button onClick={() => setStep('done')} className="toolbar-btn text-[9px]" style={{ padding: '3px 10px' }}>Skip</button>
                      <button onClick={handleSync} className="toolbar-btn toolbar-btn-primary text-[9px] flex items-center gap-1" style={{ padding: '3px 10px' }}>
                        <Download className="w-3 h-3" /> Sync Now
                      </button>
                    </>
                  )}
                  {syncResult && (
                    <button onClick={() => setStep('done')} className="toolbar-btn toolbar-btn-primary text-[9px] flex items-center gap-1" style={{ padding: '3px 10px' }}>
                      Finish <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* DONE STEP */}
          {step === 'done' && (
            <div className="space-y-4 text-center py-6">
              <div className="w-12 h-12 rounded-full bg-green-900/30 border border-green-700/50 flex items-center justify-center mx-auto">
                <CheckCircle className="w-7 h-7 text-green-400" />
              </div>
              <p className="text-sm text-white font-bold">{config.name} is Ready</p>
              <p className="text-[10px] text-rmpg-400">The integration has been configured successfully. You can manage it from the Admin panel at any time.</p>
              <button onClick={() => { onComplete(); onClose(); }} className="toolbar-btn toolbar-btn-primary text-[10px] mx-auto flex items-center gap-1" style={{ padding: '4px 16px' }}>
                <CheckCircle className="w-3 h-3" /> Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
