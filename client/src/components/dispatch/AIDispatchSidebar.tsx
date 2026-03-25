import React from 'react';
import { Brain, Shield, AlertTriangle, Check, X } from 'lucide-react';

interface AIAnalysis {
  safetyBriefing?: string;
  severityOverride?: 'low' | 'medium' | 'high' | 'critical';
  suggestedFlags?: string[];
  confidence?: number;
}

interface AIDispatchSidebarProps {
  selectedCall: { id: string; [key: string]: any } | null;
  aiAnalyses: Record<string, AIAnalysis>;
  onAcceptFlag: (callId: string, flag: string) => void;
  onDismiss: () => void;
}

const SEVERITY_COLORS: Record<string, { bg: string; border: string; text: string; label: string }> = {
  low: { bg: '#22c55e20', border: '#22c55e50', text: '#4ade80', label: 'LOW' },
  medium: { bg: '#f59e0b20', border: '#f59e0b50', text: '#fbbf24', label: 'MEDIUM' },
  high: { bg: '#ef444420', border: '#ef444450', text: '#f87171', label: 'HIGH' },
  critical: { bg: '#dc262620', border: '#dc262680', text: '#ef4444', label: 'CRITICAL' },
};

export default function AIDispatchSidebar({ selectedCall, aiAnalyses, onAcceptFlag, onDismiss }: AIDispatchSidebarProps) {
  const analysis = selectedCall ? aiAnalyses[selectedCall.id] : null;

  if (!selectedCall) return null;

  return (
    <div className="w-[260px] flex-shrink-0 border-l flex flex-col overflow-hidden" style={{ background: '#111', borderColor: '#1a1a1a' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: '#1a1a1a', background: '#0d0d15' }}>
        <div className="flex items-center gap-1.5">
          <Brain className="w-3.5 h-3.5 text-purple-400" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-purple-300">AI Analysis</span>
        </div>
        <button onClick={onDismiss} className="p-0.5 rounded hover:bg-[#ffffff10] transition-colors" title="Close AI panel">
          <X className="w-3.5 h-3.5 text-[#6b7280]" />
        </button>
      </div>

      {!analysis ? (
        /* AI Unavailable state */
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center">
            <Brain className="w-8 h-8 mx-auto mb-2" style={{ opacity: 0.2, color: '#6b7280' }} />
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6b7280] mb-1">AI Unavailable</p>
            <p className="text-[9px] text-[#4b5563] leading-relaxed max-w-[180px] mx-auto">
              No AI analysis available for this call. Analysis runs automatically when calls are created or updated.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {/* Safety Briefing */}
          <div>
            <label className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider mb-1.5" style={{ color: '#d4a017' }}>
              <Shield className="w-3 h-3" /> Safety Briefing
            </label>
            {analysis.severityOverride && SEVERITY_COLORS[analysis.severityOverride] && (
              <span
                className="inline-block px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider rounded-sm mb-1.5 border"
                style={{
                  background: SEVERITY_COLORS[analysis.severityOverride].bg,
                  borderColor: SEVERITY_COLORS[analysis.severityOverride].border,
                  color: SEVERITY_COLORS[analysis.severityOverride].text,
                }}
              >
                {SEVERITY_COLORS[analysis.severityOverride].label}
              </span>
            )}
            <p className="text-[11px] text-rmpg-200 leading-relaxed">
              {analysis.safetyBriefing || 'No safety concerns identified.'}
            </p>
          </div>

          {/* Suggested Flags */}
          {analysis.suggestedFlags && analysis.suggestedFlags.length > 0 && (
            <div>
              <label className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider mb-1.5" style={{ color: '#a78bfa' }}>
                <AlertTriangle className="w-3 h-3" /> Suggested Flags
              </label>
              <div className="flex flex-wrap gap-1">
                {analysis.suggestedFlags.map((flag) => {
                  const alreadySet = !!(selectedCall as any)[flag];
                  return (
                    <button
                      key={flag}
                      disabled={alreadySet}
                      onClick={() => onAcceptFlag(selectedCall.id, flag)}
                      className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-semibold rounded-sm border transition-colors"
                      style={alreadySet
                        ? { background: '#22c55e15', borderColor: '#22c55e40', color: '#4ade80', cursor: 'default', opacity: 0.7 }
                        : { background: '#a855f715', borderColor: '#a855f740', color: '#c084fc', cursor: 'pointer' }
                      }
                      title={alreadySet ? `${flag} already set` : `Accept flag: ${flag}`}
                    >
                      {alreadySet ? <Check className="w-2.5 h-2.5" /> : <AlertTriangle className="w-2.5 h-2.5" />}
                      {flag.replace(/_/g, ' ')}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Confidence Meter */}
          {analysis.confidence != null && (
            <div>
              <label className="flex items-center justify-between text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: '#6b7280' }}>
                <span>Confidence</span>
                <span className="font-mono tabular-nums">{Math.round(analysis.confidence)}%</span>
              </label>
              <div className="w-full h-1.5 rounded-full" style={{ background: '#1a1a2e' }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, Math.max(0, analysis.confidence))}%`,
                    background: analysis.confidence >= 75 ? '#4ade80' : analysis.confidence >= 50 ? '#fbbf24' : '#f87171',
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
