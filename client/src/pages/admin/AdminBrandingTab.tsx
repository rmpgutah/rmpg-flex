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
  section_accent_color: string;    // Gold accent strip on section headers
  // Typography
  font_profile: 'helvetica' | 'courier' | 'times';
  // Report settings
  report_footer_text: string;
  form_number_prefix: string;
  show_classification_bar: string;
  default_classification: string;
  show_confidential_watermark: string;
  watermark_text: string;
  // Layout options
  show_field_underlines: string;   // '1' = show subtle underlines beneath field values
  content_density: 'compact' | 'standard' | 'relaxed';
  show_geography_strip: string;    // '1' = show AREA/SECTOR/ZONE/BEAT strip
}

const DEFAULT_BRANDING: BrandingConfig = {
  report_header_text: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
  report_subheader_text: 'PRIVATE SECURITY & LAW ENFORCEMENT',
  primary_color: '#888888',
  accent_color: '#d4a017',
  header_bg_color: '#232832',
  section_accent_color: '#d4a017',
  font_profile: 'helvetica',
  report_footer_text: 'This document is the property of Rocky Mountain Protective Group. Unauthorized distribution is prohibited.',
  form_number_prefix: 'RKY',
  show_classification_bar: '1',
  default_classification: 'LES',
  show_confidential_watermark: '0',
  watermark_text: 'CONFIDENTIAL',
  show_field_underlines: '1',
  content_density: 'standard',
  show_geography_strip: '1',
};

// CJIS Security Policy classification levels (TLP-aligned)
const CLASSIFICATION_OPTIONS = [
  { value: 'LES', label: 'LAW ENFORCEMENT SENSITIVE // CJIS', color: '#b41e1e' },
  { value: 'CUI', label: 'CONTROLLED UNCLASSIFIED INFORMATION // LE', color: '#503282' },
  { value: 'FOUO', label: 'FOR OFFICIAL USE ONLY', color: '#c88214' },
  { value: 'UNCLAS', label: 'UNCLASSIFIED', color: '#006e3c' },
  { value: 'CONFIDENTIAL', label: 'CONFIDENTIAL // NOFORN', color: '#780000' },
  { value: 'SEALED', label: 'SEALED BY COURT ORDER', color: '#1e1e1e' },
  { value: 'DRAFT', label: 'DRAFT — NOT FOR DISTRIBUTION', color: '#6e6e6e' },
];

const FONT_OPTIONS = [
  { value: 'helvetica', label: 'Helvetica (Modern)', desc: 'Clean sans-serif — formal government style' },
  { value: 'courier', label: 'Courier (Classic)', desc: 'Monospace typewriter — traditional police report' },
  { value: 'times', label: 'Times (Legal)', desc: 'Serif — formal legal document style' },
];

const DENSITY_OPTIONS = [
  { value: 'compact', label: 'Compact', desc: 'Tighter spacing — fits more content per page' },
  { value: 'standard', label: 'Standard', desc: 'Balanced readability and density' },
  { value: 'relaxed', label: 'Relaxed', desc: 'More whitespace — easier to read at a glance' },
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

      {/* Agency Identity */}
      <div className="panel-beveled p-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <FileText className="w-4 h-4 text-gray-400" />
          <h3 className="text-xs font-bold text-rmpg-200 uppercase tracking-wider">Agency Identity</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Report Header Text</label>
            <input className="input-dark text-xs w-full" value={config.report_header_text} onChange={(e) => update('report_header_text', e.target.value)} placeholder="AGENCY NAME" />
            <p className="text-[9px] text-rmpg-600 mt-0.5">Primary agency name — appears at top of every PDF</p>
          </div>
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Report Subheader Text</label>
            <input className="input-dark text-xs w-full" value={config.report_subheader_text} onChange={(e) => update('report_subheader_text', e.target.value)} placeholder="SUBTITLE" />
            <p className="text-[9px] text-rmpg-600 mt-0.5">Subtitle — appears below agency name</p>
          </div>
        </div>
        <div>
          <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Report Footer Text</label>
          <textarea className="input-dark text-xs w-full min-h-[36px]" rows={2} value={config.report_footer_text} onChange={(e) => update('report_footer_text', e.target.value)} placeholder="Footer disclaimer text..." />
          <p className="text-[9px] text-rmpg-600 mt-0.5">Appears centered at bottom of every page</p>
        </div>
        <div>
          <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Form Number Prefix</label>
          <input className="input-dark text-xs w-32" value={config.form_number_prefix} onChange={(e) => update('form_number_prefix', e.target.value)} placeholder="RKY" />
          <p className="text-[9px] text-rmpg-600 mt-0.5">Prefix for form numbers (e.g., RKY → FORM RKY-201)</p>
        </div>
      </div>

      {/* Brand Colors */}
      <div className="panel-beveled p-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Palette className="w-4 h-4 text-purple-400" />
          <h3 className="text-xs font-bold text-rmpg-200 uppercase tracking-wider">Brand Colors</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Primary Color</label>
            <div className="flex items-center gap-2">
              <input type="color" value={config.primary_color} onChange={(e) => update('primary_color', e.target.value)} className="w-10 h-10 cursor-pointer border-0 p-0 bg-transparent" />
              <div>
                <span className="text-[10px] text-rmpg-500 font-mono block">{config.primary_color}</span>
                <span className="text-[9px] text-rmpg-600">Case # box, accents</span>
              </div>
            </div>
          </div>
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Accent Color</label>
            <div className="flex items-center gap-2">
              <input type="color" value={config.accent_color} onChange={(e) => update('accent_color', e.target.value)} className="w-10 h-10 cursor-pointer border-0 p-0 bg-transparent" />
              <div>
                <span className="text-[10px] text-rmpg-500 font-mono block">{config.accent_color}</span>
                <span className="text-[9px] text-rmpg-600">Subtitles, lines</span>
              </div>
            </div>
          </div>
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Header Background</label>
            <div className="flex items-center gap-2">
              <input type="color" value={config.header_bg_color} onChange={(e) => update('header_bg_color', e.target.value)} className="w-10 h-10 cursor-pointer border-0 p-0 bg-transparent" />
              <div>
                <span className="text-[10px] text-rmpg-500 font-mono block">{config.header_bg_color}</span>
                <span className="text-[9px] text-rmpg-600">Header bar fill</span>
              </div>
            </div>
          </div>
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Section Accent</label>
            <div className="flex items-center gap-2">
              <input type="color" value={config.section_accent_color} onChange={(e) => update('section_accent_color', e.target.value)} className="w-10 h-10 cursor-pointer border-0 p-0 bg-transparent" />
              <div>
                <span className="text-[10px] text-rmpg-500 font-mono block">{config.section_accent_color}</span>
                <span className="text-[9px] text-rmpg-600">Gold accent strip</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Typography & Layout */}
      <div className="panel-beveled p-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Printer className="w-4 h-4 text-gray-400" />
          <h3 className="text-xs font-bold text-rmpg-200 uppercase tracking-wider">Typography & Layout</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Font Profile */}
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Font Profile</label>
            <div className="space-y-1.5">
              {FONT_OPTIONS.map(f => (
                <button key={f.value} type="button"
                  onClick={() => update('font_profile', f.value)}
                  className={`w-full text-left p-2 border transition-all ${
                    config.font_profile === f.value
                      ? 'bg-brand-900/20 border-brand-500/50 text-white'
                      : 'bg-[#0c0c0c] border-[#181818] text-rmpg-400 hover:border-rmpg-500'
                  }`}
                >
                  <span className="text-[11px] font-medium block">{f.label}</span>
                  <span className="text-[9px] text-rmpg-500">{f.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Content Density */}
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Content Density</label>
            <div className="space-y-1.5">
              {DENSITY_OPTIONS.map(d => (
                <button key={d.value} type="button"
                  onClick={() => update('content_density', d.value)}
                  className={`w-full text-left p-2 border transition-all ${
                    config.content_density === d.value
                      ? 'bg-brand-900/20 border-brand-500/50 text-white'
                      : 'bg-[#0c0c0c] border-[#181818] text-rmpg-400 hover:border-rmpg-500'
                  }`}
                >
                  <span className="text-[11px] font-medium block">{d.label}</span>
                  <span className="text-[9px] text-rmpg-500">{d.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Visual Toggles */}
          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Field Underlines</label>
              <button type="button"
                onClick={() => update('show_field_underlines', config.show_field_underlines === '1' ? '0' : '1')}
                role="switch" aria-checked={config.show_field_underlines === '1'}
                className={`flex items-center gap-2 w-full p-2.5 border transition-all ${
                  config.show_field_underlines === '1' ? 'bg-green-900/15 border-green-700/40' : 'bg-[#0c0c0c] border-[#181818]'
                }`}
              >
                <Eye className={`w-4 h-4 ${config.show_field_underlines === '1' ? 'text-green-400' : 'text-rmpg-600'}`} />
                <div>
                  <span className={`text-[11px] font-medium block ${config.show_field_underlines === '1' ? 'text-green-300' : 'text-rmpg-400'}`}>
                    {config.show_field_underlines === '1' ? 'Underlines enabled' : 'No underlines'}
                  </span>
                  <span className="text-[9px] text-rmpg-500">Subtle rule beneath each field value</span>
                </div>
              </button>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Geography Strip</label>
              <button type="button"
                onClick={() => update('show_geography_strip', config.show_geography_strip === '1' ? '0' : '1')}
                role="switch" aria-checked={config.show_geography_strip === '1'}
                className={`flex items-center gap-2 w-full p-2.5 border transition-all ${
                  config.show_geography_strip === '1' ? 'bg-green-900/15 border-green-700/40' : 'bg-[#0c0c0c] border-[#181818]'
                }`}
              >
                <Eye className={`w-4 h-4 ${config.show_geography_strip === '1' ? 'text-green-400' : 'text-rmpg-600'}`} />
                <div>
                  <span className={`text-[11px] font-medium block ${config.show_geography_strip === '1' ? 'text-green-300' : 'text-rmpg-400'}`}>
                    {config.show_geography_strip === '1' ? 'Geography strip shown' : 'Geography strip hidden'}
                  </span>
                  <span className="text-[9px] text-rmpg-500">AREA | SECTOR | ZONE | BEAT | CONTRACT</span>
                </div>
              </button>
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
                config.show_classification_bar === '1' ? 'bg-green-900/15 border-green-700/40' : 'bg-[#0c0c0c] border-[#181818]'
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
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            {/* Preview of selected classification bar */}
            {(() => {
              const sel = CLASSIFICATION_OPTIONS.find(o => o.value === config.default_classification);
              return sel ? (
                <div className="mt-2 text-center py-1 text-[8px] font-bold tracking-[0.15em] text-white" style={{ backgroundColor: sel.color }}>
                  {sel.label}
                </div>
              ) : null;
            })()}
          </div>
        </div>

        <div>
          <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Confidential Watermark</label>
          <button type="button"
            onClick={() => update('show_confidential_watermark', config.show_confidential_watermark === '1' ? '0' : '1')}
            role="switch"
            aria-checked={config.show_confidential_watermark === '1'}
            className={`flex items-center gap-2 w-full p-2.5 border transition-all duration-150 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500/50 ${
              config.show_confidential_watermark === '1' ? 'bg-amber-900/15 border-amber-700/40' : 'bg-[#0c0c0c] border-[#181818]'
            }`}
          >
            {config.show_confidential_watermark === '1' ? <Eye className="w-4 h-4 text-amber-400" aria-hidden="true" /> : <Eye className="w-4 h-4 text-rmpg-600" aria-hidden="true" />}
            <div className="min-w-0">
              <span className={`text-[11px] font-medium block ${config.show_confidential_watermark === '1' ? 'text-amber-300' : 'text-rmpg-400'}`}>
                {config.show_confidential_watermark === '1' ? 'Watermark enabled' : 'No watermark on reports'}
              </span>
              <p className="text-[9px] text-rmpg-500 mt-0.5 leading-relaxed">Adds a diagonal watermark to all generated PDFs</p>
            </div>
          </button>
          {config.show_confidential_watermark === '1' && (
            <div className="mt-2">
              <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Watermark Text</label>
              <input className="input-dark text-xs w-full" value={config.watermark_text} onChange={(e) => update('watermark_text', e.target.value)} placeholder="CONFIDENTIAL" />
            </div>
          )}
        </div>
      </div>

      {/* Live Preview */}
      <div className="panel-beveled p-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Printer className="w-4 h-4 text-gray-400" />
          <h3 className="text-xs font-bold text-rmpg-200 uppercase tracking-wider">Report Header Preview</h3>
        </div>

        <div className="border border-rmpg-600 overflow-hidden bg-white" style={{ maxWidth: 600 }}>
          {/* Classification bar */}
          {config.show_classification_bar === '1' && (() => {
            const sel = CLASSIFICATION_OPTIONS.find(o => o.value === config.default_classification);
            return (
              <div className="text-center py-1 text-[8px] font-bold tracking-[0.2em]" style={{ backgroundColor: sel?.color || '#dc2626', color: '#ffffff' }}>
                {sel?.label || config.default_classification}
              </div>
            );
          })()}
          {/* Header bar */}
          <div className="px-6 py-4 flex items-center gap-4" style={{ backgroundColor: config.header_bg_color }}>
            <div className="w-12 h-12 rounded-full border-2 flex items-center justify-center" style={{ borderColor: config.accent_color }}>
              <Image className="w-6 h-6" style={{ color: config.accent_color }} />
            </div>
            <div className="flex-1 text-center">
              <div className="font-bold tracking-[0.15em]" style={{ color: '#ffffff', fontSize: 14, fontFamily: config.font_profile === 'courier' ? 'Courier, monospace' : config.font_profile === 'times' ? 'Times, serif' : 'Helvetica, sans-serif' }}>
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
          {/* Accent strip */}
          <div className="h-[3px]" style={{ background: config.section_accent_color }} />
          {/* Section header with gold accent strip */}
          <div className="flex" style={{ backgroundColor: '#f8f8f8' }}>
            <div style={{ width: 4, backgroundColor: config.section_accent_color }} />
            <div className="flex-1 px-3 py-1.5 text-[9px] font-bold tracking-wider" style={{ backgroundColor: '#232832', color: '#ffffff' }}>
              SUBJECT IDENTIFICATION
            </div>
          </div>
          {/* Sample field rows with underlines */}
          <div className="px-4 py-2 space-y-1.5" style={{ fontFamily: config.font_profile === 'courier' ? 'Courier, monospace' : config.font_profile === 'times' ? 'Times, serif' : 'Helvetica, sans-serif' }}>
            <div className="flex gap-6">
              <div className="flex-1">
                <div className="text-[7px] uppercase tracking-wider" style={{ color: '#4a5568' }}>Last Name</div>
                <div className="text-[10px] font-medium" style={{ color: '#000' }}>TURLEY</div>
                {config.show_field_underlines === '1' && <div className="border-b" style={{ borderColor: '#c8c8d0' }} />}
              </div>
              <div className="flex-1">
                <div className="text-[7px] uppercase tracking-wider" style={{ color: '#4a5568' }}>First Name</div>
                <div className="text-[10px] font-medium" style={{ color: '#000' }}>KARL</div>
                {config.show_field_underlines === '1' && <div className="border-b" style={{ borderColor: '#c8c8d0' }} />}
              </div>
              <div className="w-24">
                <div className="text-[7px] uppercase tracking-wider" style={{ color: '#4a5568' }}>DOB</div>
                <div className="text-[10px] font-medium" style={{ color: '#000' }}>07/10/1991</div>
                {config.show_field_underlines === '1' && <div className="border-b" style={{ borderColor: '#c8c8d0' }} />}
              </div>
            </div>
          </div>
          {/* Geography strip preview */}
          {config.show_geography_strip === '1' && (
            <div className="flex border-t" style={{ borderColor: config.section_accent_color, backgroundColor: '#f8f8fc' }}>
              {['AREA', 'SECTOR', 'ZONE', 'BEAT', 'CONTRACT'].map((label, i) => (
                <div key={label} className="flex-1 px-2 py-1" style={{ borderLeft: i > 0 ? '1px solid #ddd' : 'none' }}>
                  <div className="text-[6px] uppercase" style={{ color: '#4a5568' }}>{label}</div>
                  <div className="text-[8px] font-bold" style={{ color: '#000', fontFamily: 'Courier, monospace' }}>—</div>
                </div>
              ))}
            </div>
          )}
          {/* Section bottom rule */}
          <div className="h-[1px]" style={{ backgroundColor: config.section_accent_color }} />
          {/* Footer preview */}
          <div className="px-6 py-2" style={{ borderTop: `2px solid ${config.section_accent_color}` }}>
            <div className="flex justify-between text-[7px]" style={{ color: '#999' }}>
              <span>FORM {config.form_number_prefix}-201 | INTERNAL USE ONLY</span>
              <span style={{ fontFamily: 'Helvetica, sans-serif', fontSize: 6 }}>{config.report_header_text}</span>
              <span>PAGE 1 OF 1</span>
            </div>
          </div>
        </div>
        <p className="text-[9px] text-rmpg-500 mt-1">
          Approximate preview. Actual PDF uses jsPDF rendering with agency seal image, page breaks, and full data.
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
