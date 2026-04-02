// ============================================================
// RMPG Flex — Admin Branding & Reports Tab
// Agency identity, report header/footer text, brand colors,
// logo preview, and PDF report appearance configuration.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  Palette,
  FileText,
  Save,
  CheckCircle,
  Loader2,
  Eye,
  Image,
  Printer,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

interface AdminBrandingTabProps {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

interface BrandingConfig {
  // Identity
  report_header_text: string;
  report_subheader_text: string;
  // Colors
  primary_color: string;
  accent_color: string;
  header_bg_color: string;
  // Report settings
  report_footer_text: string;
  form_number_prefix: string;
  show_classification_bar: string;
  default_classification: string;
  show_confidential_watermark: string;
}

const DEFAULT_BRANDING: BrandingConfig = {
  report_header_text: 'RMPG SECURITY SERVICES',
  report_subheader_text: 'PRIVATE SECURITY',
  primary_color: '#888888',
  accent_color: '#d4a017',
  header_bg_color: '#000000',
  report_footer_text: 'This document is the property of RMPG Security Services. Unauthorized distribution is prohibited.',
  form_number_prefix: 'RKY',
  show_classification_bar: '1',
  default_classification: 'OFFICIAL USE ONLY',
  show_confidential_watermark: '0',
};

const CLASSIFICATION_OPTIONS = [
  'OFFICIAL USE ONLY',
  'INTERNAL USE ONLY',
  'CONFIDENTIAL',
  'PUBLIC RECORD',
  'FOR OFFICIAL USE ONLY (FOUO)',
];

export default function AdminBrandingTab({ LoadingSpinner, error, setError }: AdminBrandingTabProps) {
  const [config, setConfig] = useState<BrandingConfig>({ ...DEFAULT_BRANDING });
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const result = await apiFetch<{ settings: Record<string, string> }>('/admin/system-settings');
      const s = result.settings || {};
      let brandObj: Record<string, string> = {};
      if (s.branding_settings) {
        try { brandObj = JSON.parse(s.branding_settings); } catch { /* */ }
      }
      setConfig(prev => {
        const merged = { ...prev };
        for (const key of Object.keys(prev) as (keyof BrandingConfig)[]) {
          if (brandObj[key] !== undefined) merged[key] = brandObj[key];
        }
        return merged;
      });
    } catch { /* use defaults */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const update = (key: keyof BrandingConfig, value: string) => {
    setConfig(prev => ({ ...prev, [key]: value }));
    setDirty(true);
    setSaved(false);
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      await apiFetch('/admin/system-settings', {
        method: 'PUT',
        body: JSON.stringify({
          branding_settings: JSON.stringify(config),
        }),
      });
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to save branding settings');
    }
    setSaving(false);
  };

  // Set document title
  useEffect(() => { document.title = 'Admin - Branding \u2014 RMPG Flex'; }, []);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="p-4 space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 flex items-center justify-center bg-purple-900/30 border border-purple-700/50" aria-hidden="true">
            <Palette className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">Branding & Reports</h2>
            <p className="text-[10px] text-rmpg-400">Agency identity, report appearance, and PDF output configuration</p>
          </div>
        </div>
        <button type="button"
          onClick={saveConfig}
          disabled={!dirty || saving}
          className={`toolbar-btn ${dirty ? 'toolbar-btn-primary' : 'toolbar-btn'} flex items-center gap-1.5 disabled:opacity-50 transition-opacity`}
          aria-label={saving ? 'Saving branding settings' : 'Save branding settings'}
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Saving" /> : saved ? <CheckCircle className="w-3 h-3 text-green-400" /> : <Save className="w-3 h-3" />}
          {saving ? 'Saving...' : saved ? 'Saved' : 'Save Changes'}
        </button>
      </div>

      {/* Brand Colors */}
      <div className="panel-beveled p-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Palette className="w-4 h-4 text-purple-400" />
          <h3 className="text-xs font-bold text-rmpg-200 uppercase tracking-wider">Brand Colors</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Primary Color</label>
            <div className="flex items-center gap-2">
              <input type="color" value={config.primary_color} onChange={(e) => update('primary_color', e.target.value)} className="w-10 h-10 cursor-pointer border-0 p-0 bg-transparent" />
              <div>
                <span className="text-[10px] text-rmpg-500 font-mono block">{config.primary_color}</span>
                <span className="text-[9px] text-rmpg-600">Agency name, case # box</span>
              </div>
            </div>
          </div>
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Accent Color</label>
            <div className="flex items-center gap-2">
              <input type="color" value={config.accent_color} onChange={(e) => update('accent_color', e.target.value)} className="w-10 h-10 cursor-pointer border-0 p-0 bg-transparent" />
              <div>
                <span className="text-[10px] text-rmpg-500 font-mono block">{config.accent_color}</span>
                <span className="text-[9px] text-rmpg-600">Separators, subtitle</span>
              </div>
            </div>
          </div>
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Header Background</label>
            <div className="flex items-center gap-2">
              <input type="color" value={config.header_bg_color} onChange={(e) => update('header_bg_color', e.target.value)} className="w-10 h-10 cursor-pointer border-0 p-0 bg-transparent" />
              <div>
                <span className="text-[10px] text-rmpg-500 font-mono block">{config.header_bg_color}</span>
                <span className="text-[9px] text-rmpg-600">Header/footer bars</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Classification & Watermarks */}
      <div className="panel-beveled p-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <FileText className="w-4 h-4 text-amber-400" />
          <h3 className="text-xs font-bold text-rmpg-200 uppercase tracking-wider">Document Classification</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Show Classification Bar</label>
            <button type="button"
              onClick={() => update('show_classification_bar', config.show_classification_bar === '1' ? '0' : '1')}
              role="switch"
              aria-checked={config.show_classification_bar === '1'}
              className={`flex items-center gap-2 w-full p-2.5 border transition-all duration-150 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500/50 ${
                config.show_classification_bar === '1' ? 'bg-green-900/15 border-green-700/40' : 'bg-[#0d1520] border-[#1a2636]'
              }`}
            >
              {config.show_classification_bar === '1' ? <Eye className="w-4 h-4 text-green-400" aria-hidden="true" /> : <Eye className="w-4 h-4 text-rmpg-600" aria-hidden="true" />}
              <span className={`text-[11px] font-medium ${config.show_classification_bar === '1' ? 'text-green-300' : 'text-rmpg-400'}`}>
                {config.show_classification_bar === '1' ? 'Enabled' : 'Disabled'}
              </span>
            </button>
          </div>
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Default Classification</label>
            <select
              className="input-dark text-xs w-full min-h-[36px]"
              value={config.default_classification}
              onChange={(e) => update('default_classification', e.target.value)}
            >
              {CLASSIFICATION_OPTIONS.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Confidential Watermark</label>
          <button type="button"
            onClick={() => update('show_confidential_watermark', config.show_confidential_watermark === '1' ? '0' : '1')}
            role="switch"
            aria-checked={config.show_confidential_watermark === '1'}
            className={`flex items-center gap-2 w-full p-2.5 border transition-all duration-150 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500/50 ${
              config.show_confidential_watermark === '1' ? 'bg-amber-900/15 border-amber-700/40' : 'bg-[#0d1520] border-[#1a2636]'
            }`}
          >
            {config.show_confidential_watermark === '1' ? <Eye className="w-4 h-4 text-amber-400" aria-hidden="true" /> : <Eye className="w-4 h-4 text-rmpg-600" aria-hidden="true" />}
            <div className="min-w-0">
              <span className={`text-[11px] font-medium block ${config.show_confidential_watermark === '1' ? 'text-amber-300' : 'text-rmpg-400'}`}>
                {config.show_confidential_watermark === '1' ? 'CONFIDENTIAL watermark enabled' : 'No watermark on reports'}
              </span>
              <p className="text-[9px] text-rmpg-500 mt-0.5 leading-relaxed">Adds a diagonal "CONFIDENTIAL" watermark to all generated PDFs</p>
            </div>
          </button>
        </div>
      </div>

      {/* Live Preview */}
      <div className="panel-beveled p-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Printer className="w-4 h-4 text-blue-400" />
          <h3 className="text-xs font-bold text-rmpg-200 uppercase tracking-wider">Report Header Preview</h3>
        </div>

        <div className="border border-rmpg-600 overflow-hidden bg-white" style={{ maxWidth: 600 }}>
          {/* Classification bar */}
          {config.show_classification_bar === '1' && (
            <div className="text-center py-1 text-[8px] font-bold tracking-[0.2em]" style={{ backgroundColor: '#dc2626', color: '#ffffff' }}>
              {config.default_classification}
            </div>
          )}
          {/* Header bar */}
          <div className="px-6 py-4 flex items-center gap-4" style={{ backgroundColor: config.header_bg_color }}>
            <div className="w-12 h-12 rounded-full border-2 flex items-center justify-center" style={{ borderColor: config.accent_color }}>
              <Image className="w-6 h-6" style={{ color: config.accent_color }} />
            </div>
            <div className="flex-1 text-center">
              <div className="font-bold tracking-[0.15em]" style={{ color: config.primary_color, fontSize: 16 }}>
                {config.report_header_text || 'AGENCY NAME'}
              </div>
              <div className="text-[10px] tracking-[0.25em] mt-0.5" style={{ color: config.accent_color }}>
                {config.report_subheader_text || 'SUBTITLE'}
              </div>
            </div>
            <div className="w-12 h-12 rounded-full border-2 flex items-center justify-center" style={{ borderColor: config.accent_color }}>
              <Image className="w-6 h-6" style={{ color: config.accent_color }} />
            </div>
          </div>
          {/* Accent line */}
          <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${config.primary_color}, ${config.accent_color}, ${config.primary_color})` }} />
          {/* Report metadata */}
          <div className="px-6 py-2" style={{ backgroundColor: '#f8f8f8' }}>
            <div className="flex justify-between text-[9px]" style={{ color: '#666' }}>
              <span>Report #: <strong style={{ color: '#000' }}>{config.form_number_prefix}26-00001-THF</strong></span>
              <span>INCIDENT REPORT</span>
              <span>Date: {new Date().toLocaleDateString('en-US')}</span>
            </div>
          </div>
          {/* Footer preview */}
          <div className="px-6 py-2 border-t" style={{ borderColor: '#ddd' }}>
            <div className="text-[7px] text-center" style={{ color: '#999' }}>
              {config.report_footer_text || 'Footer text will appear here'}
            </div>
          </div>
        </div>
        <p className="text-[9px] text-rmpg-500">
          This is an approximate preview. Actual PDF output uses high-resolution agency seal and logo images.
        </p>
      </div>

      {/* Save footer */}
      {dirty && (
        <div className="sticky bottom-0 bg-rmpg-950/90 backdrop-blur-sm border-t border-rmpg-700 p-3 flex items-center justify-between -mx-4 px-4">
          <span className="text-[10px] text-amber-400">You have unsaved changes</span>
          <button type="button" onClick={saveConfig} disabled={saving} className="toolbar-btn toolbar-btn-primary flex items-center gap-1.5">
            {saving ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Save className="w-3 h-3" />}
            {saving ? 'Saving...' : 'Save All Changes'}
          </button>
        </div>
      )}
    </div>
  );
}
