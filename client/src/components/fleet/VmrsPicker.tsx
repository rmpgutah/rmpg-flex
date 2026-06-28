import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

interface VmrsSystem {
  code: string;
  name: string;
  active: number;
}
interface VmrsAssembly {
  system_code: string;
  code: string;
  name: string;
  active: number;
}
interface VmrsComponent {
  system_code: string;
  assembly_code: string;
  code: string;
  name: string;
  active: number;
}

export interface VmrsSelection {
  systemCode: string;
  systemName: string;
  assemblyCode: string;
  assemblyName: string;
  componentCode: string;
  componentName: string;
  label: string;
}

interface Props {
  value?: VmrsSelection | null;
  onChange: (selection: VmrsSelection | null) => void;
  className?: string;
  disabled?: boolean;
}

const LIST_STYLE = 'w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100';

export function VmrsPicker({ value, onChange, className, disabled }: Props) {
  const [systems, setSystems] = useState<VmrsSystem[]>([]);
  const [assemblies, setAssemblies] = useState<VmrsAssembly[]>([]);
  const [components, setComponents] = useState<VmrsComponent[]>([]);
  const [loading, setLoading] = useState(true);

  const [sysCode, setSysCode] = useState(value?.systemCode ?? '');
  const [asmCode, setAsmCode] = useState(value?.assemblyCode ?? '');
  const [cmpCode, setCmpCode] = useState(value?.componentCode ?? '');

  useEffect(() => {
    if (value) {
      setSysCode(value.systemCode);
      setAsmCode(value.assemblyCode);
      setCmpCode(value.componentCode);
    }
  }, [value?.systemCode, value?.assemblyCode, value?.componentCode]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiFetch<VmrsSystem[]>('/ref-data/vmrs-systems'),
      apiFetch<VmrsAssembly[]>('/ref-data/vmrs-assemblies'),
      apiFetch<VmrsComponent[]>('/ref-data/vmrs-components'),
    ])
      .then(([sys, asm, cmp]) => {
        setSystems(sys ?? []);
        setAssemblies(asm ?? []);
        setComponents(cmp ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const activeSystems = useMemo(() => systems.filter((s) => s.active), [systems]);
  const activeAssemblies = useMemo(
    () => assemblies.filter((a) => a.active && a.system_code === sysCode),
    [assemblies, sysCode],
  );
  const activeComponents = useMemo(
    () => components.filter((c) => c.active && c.system_code === sysCode && c.assembly_code === asmCode),
    [components, sysCode, asmCode],
  );

  const currentSelection = useMemo((): VmrsSelection | null => {
    if (!sysCode || !asmCode || !cmpCode) return null;
    const sys = systems.find((s) => s.code === sysCode);
    const asm = assemblies.find((a) => a.system_code === sysCode && a.code === asmCode);
    const cmp = components.find(
      (c) => c.system_code === sysCode && c.assembly_code === asmCode && c.code === cmpCode,
    );
    if (!sys || !asm || !cmp) return null;
    const parts = [sys.name, asm.name, cmp.name];
    return {
      systemCode: sys.code,
      systemName: sys.name,
      assemblyCode: asm.code,
      assemblyName: asm.name,
      componentCode: cmp.code,
      componentName: cmp.name,
      label: parts.join(' > '),
    };
  }, [sysCode, asmCode, cmpCode, systems, assemblies, components]);

  const handleClear = () => {
    setSysCode('');
    setAsmCode('');
    setCmpCode('');
    onChange(null);
  };

  const handleSysChange = (code: string) => {
    setSysCode(code);
    setAsmCode('');
    setCmpCode('');
    onChange(null);
  };

  const handleAsmChange = (code: string) => {
    setAsmCode(code);
    setCmpCode('');
    onChange(null);
  };

  const handleCmpChange = (code: string) => {
    setCmpCode(code);
  };

  useEffect(() => {
    if (cmpCode && currentSelection) {
      onChange(currentSelection);
    }
  }, [cmpCode, currentSelection, onChange]);

  if (loading) {
    return (
      <div className={className}>
        <div className={`${LIST_STYLE} text-rmpg-400`}>Loading VMRS codes…</div>
      </div>
    );
  }

  return (
    <div className={`flex items-start gap-2 ${className ?? ''}`}>
      <div className="flex-1 grid grid-cols-3 gap-2">
        <select
          className={LIST_STYLE}
          value={sysCode}
          onChange={(e) => handleSysChange(e.target.value)}
          disabled={disabled}
          aria-label="VMRS System"
        >
          <option value="">System</option>
          {activeSystems.map((s) => (
            <option key={s.code} value={s.code}>
              {s.code} — {s.name}
            </option>
          ))}
        </select>

        <select
          className={LIST_STYLE}
          value={asmCode}
          onChange={(e) => handleAsmChange(e.target.value)}
          disabled={disabled || !sysCode}
          aria-label="VMRS Assembly"
        >
          <option value="">Assembly</option>
          {activeAssemblies.map((a) => (
            <option key={`${a.system_code}-${a.code}`} value={a.code}>
              {a.code} — {a.name}
            </option>
          ))}
        </select>

        <select
          className={LIST_STYLE}
          value={cmpCode}
          onChange={(e) => handleCmpChange(e.target.value)}
          disabled={disabled || !asmCode}
          aria-label="VMRS Component"
        >
          <option value="">Component</option>
          {activeComponents.map((c) => (
            <option
              key={`${c.system_code}-${c.assembly_code}-${c.code}`}
              value={c.code}
            >
              {c.code} — {c.name}
            </option>
          ))}
        </select>
      </div>

      {sysCode || asmCode || cmpCode ? (
        <button
          type="button"
          onClick={handleClear}
          className="mt-0.5 p-1 text-rmpg-400 hover:text-rmpg-100 shrink-0"
          aria-label="Clear VMRS selection"
          disabled={disabled}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      ) : null}
    </div>
  );
}
