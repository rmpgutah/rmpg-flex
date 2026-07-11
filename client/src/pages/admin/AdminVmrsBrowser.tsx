import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, Search, X } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { asArray } from '../../utils/asArray';

interface VmrsSystem {
  id: number;
  code: string;
  name: string;
  active: number;
}
interface VmrsAssembly {
  id: number;
  system_code: string;
  code: string;
  name: string;
  active: number;
}
interface VmrsComponent {
  id: number;
  system_code: string;
  assembly_code: string;
  code: string;
  name: string;
  active: number;
}

type Expanded = Record<string, boolean>;

export function AdminVmrsBrowser() {
  const [systems, setSystems] = useState<VmrsSystem[]>([]);
  const [assemblies, setAssemblies] = useState<VmrsAssembly[]>([]);
  const [components, setComponents] = useState<VmrsComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'inactive'>('active');
  const [expanded, setExpanded] = useState<Expanded>({});

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiFetch<VmrsSystem[]>('/ref-data/vmrs-systems'),
      apiFetch<VmrsAssembly[]>('/ref-data/vmrs-assemblies'),
      apiFetch<VmrsComponent[]>('/ref-data/vmrs-components'),
    ])
      .then(([sys, asm, cmp]) => {
        setSystems(asArray(sys));
        setAssemblies(asArray(asm));
        setComponents(asArray(cmp));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const toggleExpand = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const filteredSystems = useMemo(() => {
    let list = systems;
    if (filterActive === 'active') list = list.filter((s) => s.active);
    else if (filterActive === 'inactive') list = list.filter((s) => !s.active);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((s) => {
        if (s.code.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)) return true;
        const asms = (Array.isArray(assemblies) ? assemblies : []).filter((a) => a.system_code === s.code);
        const matchAsm = asms.some(
          (a) => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q),
        );
        if (matchAsm) return true;
        const cmps = (Array.isArray(components) ? components : []).filter((c) => c.system_code === s.code);
        const matchCmp = cmps.some(
          (c) => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q),
        );
        return matchCmp;
      });
    }
    return list;
  }, [systems, assemblies, components, search, filterActive]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-xs text-rmpg-400">Loading VMRS codes…</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-rmpg-700 bg-surface-base">
        <Search className="w-3.5 h-3.5 text-rmpg-400 shrink-0" />
        <input
          type="text"
          placeholder="Search systems, assemblies, or components…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-transparent text-[11px] text-rmpg-100 placeholder:text-rmpg-500 outline-none"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="text-rmpg-400 hover:text-rmpg-100"
            aria-label="Clear search"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <div className="flex items-center gap-1 ml-2">
          {(['all', 'active', 'inactive'] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setFilterActive(opt)}
              className={`px-2 py-0.5 text-[10px] rounded-sm uppercase tracking-wider font-bold ${
                filterActive === opt
                  ? 'bg-brand-400/20 text-brand-400 border border-brand-400/40'
                  : 'text-rmpg-400 hover:text-rmpg-200'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filteredSystems.length === 0 ? (
          <div className="p-4 text-xs text-rmpg-400">No VMRS codes match the current filters.</div>
        ) : (
          <div className="p-2 space-y-0.5">
            {filteredSystems.map((sys) => {
              const asms = (Array.isArray(assemblies) ? assemblies : []).filter((a) => a.system_code === sys.code);
              const isExpanded = expanded[sys.code];
              const dot = sys.active ? 'bg-emerald-500' : 'bg-rmpg-600';
              return (
                <div key={sys.code}>
                  <button
                    type="button"
                    onClick={() => toggleExpand(sys.code)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-rmpg-800/40 rounded-sm transition-colors"
                  >
                    <span className="w-4 shrink-0 text-rmpg-500">
                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                    </span>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                    <span className="font-mono text-rmpg-300 tabular-nums w-8 shrink-0">
                      {sys.code}
                    </span>
                    <span className="text-rmpg-100 font-medium">{sys.name}</span>
                    <span className="text-[10px] text-rmpg-500 ml-auto">
                      {asms.length} assembly{asms.length !== 1 ? 'ies' : 'y'}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="ml-8 space-y-0.5">
                      {asms.length === 0 ? (
                        <div className="px-3 py-1 text-[10px] text-rmpg-500 italic">
                          No assemblies
                        </div>
                      ) : (
                        asms.map((asm) => {
                          const cmps = (Array.isArray(components) ? components : []).filter(
                            (c) => c.system_code === sys.code && c.assembly_code === asm.code,
                          );
                          const asmKey = `${sys.code}-${asm.code}`;
                          const asmExpanded = expanded[asmKey];
                          const asmDot = asm.active ? 'bg-emerald-500' : 'bg-rmpg-600';
                          return (
                            <div key={asmKey}>
                              <button
                                type="button"
                                onClick={() => toggleExpand(asmKey)}
                                className="w-full flex items-center gap-2 px-3 py-1 text-left text-[11px] hover:bg-rmpg-800/30 rounded-sm transition-colors"
                              >
                                <span className="w-4 shrink-0 text-rmpg-500">
                                  {asmExpanded ? (
                                    <ChevronDown className="w-3 h-3" />
                                  ) : (
                                    <ChevronRight className="w-3 h-3" />
                                  )}
                                </span>
                                <span className={`w-1 h-1 rounded-full shrink-0 ${asmDot}`} />
                                <span className="font-mono text-rmpg-400 tabular-nums w-8 shrink-0">
                                  {asm.code}
                                </span>
                                <span className="text-rmpg-200">{asm.name}</span>
                                <span className="text-[10px] text-rmpg-500 ml-auto">
                                  {cmps.length} component{cmps.length !== 1 ? 's' : ''}
                                </span>
                              </button>

                              {asmExpanded && (
                                <div className="ml-8 space-y-0.5">
                                  {cmps.length === 0 ? (
                                    <div className="px-3 py-1 text-[10px] text-rmpg-500 italic">
                                      No components
                                    </div>
                                  ) : (
                                    cmps.map((cmp) => {
                                      const cmpDot = cmp.active
                                        ? 'bg-emerald-500'
                                        : 'bg-rmpg-600';
                                      return (
                                        <div
                                          key={`${cmp.system_code}-${cmp.assembly_code}-${cmp.code}`}
                                          className="flex items-center gap-2 px-3 py-1 text-[10px]"
                                        >
                                          <span className="w-4 shrink-0" />
                                          <span
                                            className={`w-1 h-1 rounded-full shrink-0 ${cmpDot}`}
                                          />
                                          <span className="font-mono text-rmpg-500 tabular-nums w-8 shrink-0">
                                            {cmp.code}
                                          </span>
                                          <span className="text-rmpg-300">{cmp.name}</span>
                                        </div>
                                      );
                                    })
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
