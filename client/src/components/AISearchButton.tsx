import React, { useState } from 'react';
import { Brain, Loader2 } from 'lucide-react';

interface AISearchButtonProps {
  query: string;
  searchType: 'persons' | 'vehicles' | 'incidents';
  onFiltersExtracted: (filters: Record<string, string>) => void;
}

export default function AISearchButton({ query, searchType, onFiltersExtracted }: AISearchButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [aiUnavailable, setAiUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSmartSearch = async () => {
    if (!query?.trim() || isLoading || aiUnavailable) return;
    setIsLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('rmpg_token');
      const res = await fetch('/api/ai/smart-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query: query.trim(), searchType }),
      });
      if (!res.ok) {
        if (res.status === 503 || res.status === 501) {
          setAiUnavailable(true);
          setError('AI unavailable');
        } else {
          setError('Search failed');
        }
        return;
      }
      const data = await res.json();
      if (data.available && data.filters) {
        onFiltersExtracted(data.filters);
      } else {
        setAiUnavailable(true);
        setError('AI unavailable');
      }
    } catch {
      setAiUnavailable(true);
      setError('Network error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={handleSmartSearch}
        disabled={isLoading || aiUnavailable || !query?.trim()}
        className="flex items-center gap-1 px-2 py-1.5 text-[9px] font-semibold rounded-sm border transition-colors shrink-0"
        style={aiUnavailable
          ? { background: '#1a1a2e', borderColor: '#2a2a3e', color: '#555', cursor: 'not-allowed' }
          : { background: '#7c3aed15', borderColor: '#7c3aed40', color: '#a78bfa', cursor: isLoading ? 'wait' : 'pointer' }
        }
        title={aiUnavailable ? 'AI service is unavailable' : !query?.trim() ? 'Type a search query first' : 'Use AI to parse your search into structured filters'}
      >
        {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Brain className="w-3 h-3" />}
        {aiUnavailable ? 'AI N/A' : isLoading ? 'Parsing...' : 'AI Search'}
      </button>
      {error && <span className="text-[9px] text-red-400">{error}</span>}
    </div>
  );
}
