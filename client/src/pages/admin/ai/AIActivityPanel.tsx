import { useState, useEffect } from 'react';
import { RefreshCw, Loader2, Activity } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';

interface ActivityEntry {
  id: number;
  task_type: string;
  provider: string;
  latency_ms: number;
  status: string;
  prompt_preview: string;
  created_at: string;
}

export default function AIActivityPanel() {
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => { fetchActivity(); }, []);

  const fetchActivity = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<ActivityEntry[]>('/ai/activity?limit=50');
      setActivity(Array.isArray(data) ? data : []);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  const taskTypes = ['all', ...new Set(activity.map(a => a.task_type))];
  const filtered = filter === 'all' ? activity : activity.filter(a => a.task_type === filter);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h3 className="text-xs font-semibold text-white uppercase tracking-wide flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-brand-400" />
          Activity Log
        </h3>

        <select
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="ml-auto bg-[#0b0b0b] border border-[#1c1c1c] text-white text-xs rounded px-2 py-1 focus:border-brand-500 focus:outline-none"
        >
          {taskTypes.map(t => (
            <option key={t} value={t}>{t === 'all' ? 'All Types' : t}</option>
          ))}
        </select>

        <button
          onClick={fetchActivity}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white text-xs font-medium rounded transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh
        </button>
      </div>

      <div className="bg-[#121212] border border-[#1c1c1c] rounded overflow-hidden">
        {/* Header row */}
        <div className="grid grid-cols-[140px_1fr_80px_70px_60px_1fr] gap-2 px-3 py-2 bg-[#0b0b0b] border-b border-[#1c1c1c] text-[10px] text-rmpg-500 uppercase font-medium">
          <div>Timestamp</div>
          <div>Task Type</div>
          <div>Provider</div>
          <div>Latency</div>
          <div>Status</div>
          <div>Prompt Preview</div>
        </div>

        {loading ? (
          <div className="px-3 py-8 text-center">
            <Loader2 className="w-5 h-5 animate-spin text-rmpg-500 mx-auto" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-rmpg-500">No activity records found</div>
        ) : (
          <div className="divide-y divide-[#1c1c1c] max-h-[500px] overflow-y-auto">
            {filtered.map((a, i) => (
              <div key={a.id || i} className="grid grid-cols-[140px_1fr_80px_70px_60px_1fr] gap-2 px-3 py-2 text-xs hover:bg-[#0b0b0b]/50">
                <div className="text-rmpg-500 font-mono text-[10px] truncate">
                  {a.created_at ? new Date(a.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}
                </div>
                <div className="text-white font-mono truncate">{a.task_type}</div>
                <div className="text-rmpg-400 truncate">{a.provider}</div>
                <div className="text-rmpg-400 font-mono">{a.latency_ms}ms</div>
                <div>
                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    a.status === 'success'
                      ? 'bg-green-900/20 text-green-400'
                      : 'bg-red-900/20 text-red-400'
                  }`}>
                    {a.status === 'success' ? 'OK' : 'ERR'}
                  </span>
                </div>
                <div className="text-rmpg-500 truncate">{a.prompt_preview}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
