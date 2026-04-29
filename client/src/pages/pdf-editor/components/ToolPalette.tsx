import { MousePointer2, Hand, Type, Highlighter, Square, Circle, Minus, MoveUpRight, Pencil, PenTool, Image as ImageIcon, Stamp, EyeOff, Link2, Crop, QrCode } from 'lucide-react';
import IconButton from '../../../components/IconButton';
import { Tool } from '../types';

interface Props {
  tool: Tool;
  onTool: (t: Tool) => void;
  color: string;
  onColor: (c: string) => void;
  strokeWidth: number;
  onStrokeWidth: (n: number) => void;
}

const TOOLS: { id: Tool; icon: typeof MousePointer2; label: string }[] = [
  { id: 'select', icon: MousePointer2, label: 'Select' },
  { id: 'hand', icon: Hand, label: 'Pan' },
  { id: 'text', icon: Type, label: 'Text' },
  { id: 'highlight', icon: Highlighter, label: 'Highlight' },
  { id: 'redact', icon: EyeOff, label: 'Redact (visual)' },
  { id: 'rect', icon: Square, label: 'Rectangle' },
  { id: 'ellipse', icon: Circle, label: 'Ellipse' },
  { id: 'line', icon: Minus, label: 'Line' },
  { id: 'arrow', icon: MoveUpRight, label: 'Arrow' },
  { id: 'pen', icon: Pencil, label: 'Free-hand' },
  { id: 'signature', icon: PenTool, label: 'Signature' },
  { id: 'image', icon: ImageIcon, label: 'Insert image' },
  { id: 'stamp', icon: Stamp, label: 'Stamp' },
  { id: 'link', icon: Link2, label: 'Hyperlink' },
  { id: 'crop', icon: Crop, label: 'Crop page' },
  { id: 'barcode', icon: QrCode, label: 'Barcode / QR' },
];

const PRESETS = ['#0a0a0a', '#d4a017', '#c62828', '#1976d2', '#2e7d32', '#fbc02d', '#ffffff'];

export default function ToolPalette({ tool, onTool, color, onColor, strokeWidth, onStrokeWidth }: Props) {
  return (
    <div className="flex flex-col gap-1 bg-[#0d0d0d] border border-[#222222] rounded-[2px] p-1 w-[44px] flex-shrink-0">
      {TOOLS.map(t => {
        const Icon = t.icon;
        const active = tool === t.id;
        return (
          <IconButton
            key={t.id}
            onClick={() => onTool(t.id)}
            aria-label={t.label}
            title={t.label}
            className={`p-1.5 rounded-sm transition-colors ${active ? 'bg-[#d4a017]/20 text-[#d4a017]' : 'text-rmpg-400 hover:text-white hover:bg-rmpg-700/50'}`}
          >
            <Icon className="w-4 h-4" />
          </IconButton>
        );
      })}

      <div className="h-px bg-[#222222] my-1" />

      <div className="flex flex-col gap-1 items-center">
        <input
          type="color"
          aria-label="Stroke color"
          value={color}
          onChange={e => onColor(e.target.value)}
          className="w-7 h-7 bg-transparent border border-[#222222] rounded-sm cursor-pointer"
          title="Stroke color"
        />
        <div className="flex flex-wrap gap-0.5 w-[36px]">
          {PRESETS.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => onColor(c)}
              aria-label={`Use color ${c}`}
              title={c}
              className={`w-3.5 h-3.5 rounded-sm border ${color.toLowerCase() === c ? 'border-[#d4a017]' : 'border-[#333]'}`}
              style={{ background: c }}
            />
          ))}
        </div>
        <input
          type="range"
          aria-label="Stroke width"
          min={1}
          max={12}
          value={strokeWidth}
          onChange={e => onStrokeWidth(parseInt(e.target.value, 10))}
          className="w-7 mt-1 accent-[#d4a017]"
          title={`Stroke ${strokeWidth}px`}
        />
        <span className="text-[8px] text-rmpg-500">{strokeWidth}px</span>
      </div>
    </div>
  );
}
