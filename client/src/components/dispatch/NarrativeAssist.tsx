import { useState } from 'react';
import { Brain, Check, X, Loader2, ScanLine } from 'lucide-react';

interface NarrativeAssistProps {
  notes: string;
  incidentType?: string;
  locationAddress?: string;
  onAccept: (narrative: string) => void;
  onExtractFields?: (fields: Record<string, unknown>) => void;
}

export default function NarrativeAssist({ notes, incidentType, locationAddress, onAccept, onExtractFields }: NarrativeAssistProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiUnavailable, setAiUnavailable] = useState(false);
  const [extracting, setExtracting] = useState(false);

  const handleGenerate = async () => {
    setIsLoading(true);
    setError(null);
    setPreview(null);
    try {
      const token = localStorage.getItem('rmpg_token');
      const res = await fetch('/api/ai/narrative', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ notes, incident_type: incidentType, location_address: locationAddress }),
      });
      if (!res.ok) {
        if (res.status === 503 || res.status === 501) {
          setAiUnavailable(true);
          setError('AI service unavailable');
        } else {
          const data = await res.json().catch(() => ({}));
          setError(data.error || 'Failed to generate narrative');
        }
        return;
      }
      const data = await res.json();
      setPreview(data.narrative || data.text || '');
    } catch {
      setError('Network error — could not reach AI service');
      setAiUnavailable(true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAccept = () => {
    if (preview) {
      onAccept(preview);
      setPreview(null);
    }
  };

  const handleDiscard = () => {
    setPreview(null);
  };

  const handleExtractFields = async () => {
    if (!onExtractFields || notes.length < 20) return;
    setExtracting(true);
    try {
      const token = localStorage.getItem('rmpg_token');
      const res = await fetch('/api/ai/extract-fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: notes }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.result) onExtractFields(data.result);
      }
    } catch { /* best-effort */ }
    finally { setExtracting(false); }
  };

  return (
    <div className="mt-1">
      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={isLoading || aiUnavailable || !notes?.trim()}
        className="flex items-center gap-1 px-2 py-1 text-[9px] font-semibold rounded-sm border transition-colors"
        style={aiUnavailable
          ? { background: 'var(--surface-raised)', borderColor: 'var(--border-default)', color: 'var(--rmpg-500)', cursor: 'not-allowed' }
          : { background: '#7c3aed15', borderColor: '#7c3aed40', color: '#a78bfa', cursor: isLoading ? 'wait' : 'pointer' }
        }
        title={aiUnavailable ? 'AI service is unavailable' : !notes?.trim() ? 'Enter notes first' : 'Generate narrative from notes using AI'}
      >
        {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Brain className="w-3 h-3" />}
        {aiUnavailable ? 'AI Unavailable' : isLoading ? 'Generating...' : 'AI Assist'}
      </button>

      {/* Extract Fields button */}
      {onExtractFields && (
        <button
          onClick={handleExtractFields}
          disabled={extracting || !notes?.trim() || notes.length < 20}
          className="flex items-center gap-1 px-2 py-1 text-[9px] font-semibold rounded-sm border transition-colors ml-1.5"
          style={{ background: '#06b6d415', borderColor: '#06b6d440', color: '#22d3ee' }}
          title={notes.length < 20 ? 'Enter at least 20 characters of text first' : 'Extract caller name, address, persons, and incident type from notes'}
        >
          {extracting ? <Loader2 className="w-3 h-3 animate-spin" /> : <ScanLine className="w-3 h-3" />}
          {extracting ? 'Extracting...' : 'Auto-Fill Fields'}
        </button>
      )}

      {/* Error message */}
      {error && !preview && (
        <p className="text-[9px] text-red-400 mt-1">{error}</p>
      )}

      {/* Preview box */}
      {preview && (
        <div className="mt-2 rounded-sm border p-2" style={{ background: 'var(--surface-overlay)', borderColor: '#7c3aed30' }}>
          <label className="flex items-center gap-1 text-[8px] font-bold uppercase tracking-wider text-purple-400 mb-1">
            <Brain className="w-2.5 h-2.5" /> AI Draft — Review Before Accepting
          </label>
          <p className="text-[11px] text-rmpg-200 leading-relaxed whitespace-pre-wrap mb-2">{preview}</p>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleAccept}
              className="flex items-center gap-1 px-2 py-0.5 text-[9px] font-semibold rounded-sm border transition-colors"
              style={{ background: '#22c55e15', borderColor: '#22c55e40', color: '#4ade80' }}
            >
              <Check className="w-2.5 h-2.5" /> Use This
            </button>
            <button
              onClick={handleDiscard}
              className="flex items-center gap-1 px-2 py-0.5 text-[9px] font-semibold rounded-sm border transition-colors"
              style={{ background: '#ef444415', borderColor: '#ef444440', color: '#f87171' }}
            >
              <X className="w-2.5 h-2.5" /> Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
