import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function QuickActionsCard() {
  const navigate = useNavigate();

  const actions: { label: string; path: string }[] = [
    { label: 'FI', path: '/field-interviews?new=1' },
    { label: 'Citation', path: '/citations?new=1' },
    { label: 'Incident', path: '/incidents?new=1' },
  ];

  return (
    <section className="bg-[#141414] border border-[#222] p-3">
      <h2 className="text-[#d4a017] text-[10px] font-bold tracking-widest mb-2">QUICK ACTIONS</h2>
      <div className="space-y-2">
        {actions.map((a) => (
          <button
            key={a.path}
            type="button"
            onClick={() => navigate(a.path)}
            className="w-full min-h-[56px] bg-[#1a1a1a] border border-[#222] text-[#d4a017] text-sm font-bold tracking-wider uppercase flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>{a.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
