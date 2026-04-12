import React from 'react';

interface QuickCommand {
  label: string;
  code: string;
}

const DEFAULT_COMMANDS: QuickCommand[] = [
  { label: '10-4', code: '10-4' },
  { label: '10-8', code: '10-8' },
  { label: 'BACKUP', code: 'BACKUP' },
  { label: 'EMS', code: 'EMS' },
  { label: 'SITREP', code: 'SITREP' },
  { label: 'CODE 4', code: 'CODE 4' },
  { label: '10-7', code: '10-7' },
];

interface QuickCommandsProps {
  onCommand?: (code: string) => void;
}

export default function QuickCommands({ onCommand }: QuickCommandsProps) {
  return (
    <div className="border border-[#222222] rounded-[2px] p-2 bg-[#0d0d0d]">
      <div className="text-[9px] font-semibold text-[#888888] uppercase tracking-[0.5px] mb-1.5">
        QUICK COMMANDS
      </div>

      <div className="grid grid-cols-3 gap-1">
        {DEFAULT_COMMANDS.map((cmd) => (
          <button
            key={cmd.code}
            onClick={() => onCommand?.(cmd.code)}
            className="py-1 px-1.5 rounded-[2px] text-[9px] font-bold uppercase tracking-wide transition-colors border"
            style={{
              background: '#0a0a0a',
              color: '#888888',
              borderColor: '#222222',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#d4a017';
              e.currentTarget.style.borderColor = '#d4a017';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = '#888888';
              e.currentTarget.style.borderColor = '#222222';
            }}
          >
            {cmd.label}
          </button>
        ))}
      </div>
    </div>
  );
}
