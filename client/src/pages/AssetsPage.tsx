import React, { useState, useEffect } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import { Package } from 'lucide-react';

export default function AssetsPage() {
  const [assets, setAssets] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ totalAssets: 0, issuedAssets: 0, totalWeapons: 0, activeK9: 0 });

  useEffect(() => {
    Promise.all([
      apiFetch<{ data: Record<string, unknown>[] }>('/assets/inventory').then(r => setAssets(r.data || [])),
      apiFetch<{ totalAssets: number; issuedAssets: number; totalWeapons: number; activeK9: number }>('/assets/stats').then(r => setStats(r)),
    ]).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 text-[#888888]">Loading asset records...</div>;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="ASSET MANAGEMENT" icon={Package} />
      <div className="grid grid-cols-4 gap-3">
        <StatsCard label="Total Assets" value={stats.totalAssets} />
        <StatsCard label="Issued" value={stats.issuedAssets} />
        <StatsCard label="Weapons" value={stats.totalWeapons} />
        <StatsCard label="K9 Units" value={stats.activeK9} />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <h3 className="text-[12px] font-semibold text-[#888888] mb-2 uppercase tracking-wide">Equipment</h3>
          <DataTable
            columns={[
              { key: 'asset_tag', label: 'Tag' },
              { key: 'asset_type', label: 'Type' },
              { key: 'make', label: 'Make' },
              { key: 'status', label: 'Status' },
            ]}
            rows={assets.slice(0, 20)}
            emptyText="No assets registered"
          />
        </div>
      </div>
    </div>
  );
}
