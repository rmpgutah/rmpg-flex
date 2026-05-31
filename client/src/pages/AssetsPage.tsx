import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import { Package, Wrench, Crosshair, Dog, AlertTriangle, RefreshCw } from 'lucide-react';

export default function AssetsPage() {
  const [assets, setAssets] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ totalAssets: 0, issuedAssets: 0, totalWeapons: 0, activeK9: 0 });

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      apiFetch<{ data: Record<string, unknown>[] }>('/assets/inventory').then(r => setAssets(r.data || [])),
      apiFetch<{ totalAssets: number; issuedAssets: number; totalWeapons: number; activeK9: number }>('/assets/stats').then(r => setStats(r)),
    ]).catch(_err => setError('Failed to load asset records.')).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
      <AlertTriangle size={28} color="#ef4444" style={{ opacity: 0.5, marginBottom: 12 }} />
      <p className="text-[10px] text-[#fca5a5] mb-3">{error}</p>
      <button onClick={load} className="btn-gold flex items-center gap-1.5"><RefreshCw size={12} />Retry</button>
    </div>
  );

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="ASSET MANAGEMENT" icon={Package} />
      {loading ? (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-3">{Array(4).fill(0).map((_,i)=><div key={i} className="h-16 bg-[#0a0a0a] border border-[#1a1a1a] skeleton-block" />)}</div>
          <div className="h-48 bg-[#0a0a0a] border border-[#1a1a1a] skeleton-block" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-3">
            <StatsCard icon={Package} label="Total Assets" value={stats.totalAssets} />
            <StatsCard icon={Wrench} label="Issued" value={stats.issuedAssets} />
            <StatsCard icon={Crosshair} label="Weapons" value={stats.totalWeapons} />
            <StatsCard icon={Dog} label="K9 Units" value={stats.activeK9} />
          </div>
          <DataTable
            columns={[{ key: 'asset_tag', label: 'Tag' },{ key: 'asset_type', label: 'Type' },{ key: 'make', label: 'Make' },{ key: 'status', label: 'Status' }]}
            data={assets}
            emptyMessage="No assets registered"
          />
        </>
      )}
    </div>
  );
}
