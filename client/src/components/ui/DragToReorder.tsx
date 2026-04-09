// ═══════════════════════════════════════════════════════════════
// Feature 29: Drag to Reorder items in lists
// ═══════════════════════════════════════════════════════════════
import React, { useState, useCallback, useRef } from 'react';
import { GripVertical } from 'lucide-react';

interface DragToReorderProps<T> {
  items: T[];
  onReorder: (items: T[]) => void;
  renderItem: (item: T, index: number) => React.ReactNode;
  keyExtractor: (item: T) => string | number;
  className?: string;
}

export default function DragToReorder<T>({ items, onReorder, renderItem, keyExtractor, className = '' }: DragToReorderProps<T>) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const handleDragStart = useCallback((idx: number) => {
    setDragIdx(idx);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setOverIdx(idx);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, dropIdx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === dropIdx) {
      setDragIdx(null);
      setOverIdx(null);
      return;
    }

    const newItems = [...items];
    const [removed] = newItems.splice(dragIdx, 1);
    newItems.splice(dropIdx, 0, removed);
    onReorder(newItems);
    setDragIdx(null);
    setOverIdx(null);
  }, [dragIdx, items, onReorder]);

  const handleDragEnd = useCallback(() => {
    setDragIdx(null);
    setOverIdx(null);
  }, []);

  return (
    <div ref={listRef} className={`space-y-1 ${className}`}>
      {items.map((item, idx) => (
        <div
          key={keyExtractor(item)}
          draggable
          onDragStart={() => handleDragStart(idx)}
          onDragOver={(e) => handleDragOver(e, idx)}
          onDrop={(e) => handleDrop(e, idx)}
          onDragEnd={handleDragEnd}
          className={`
            flex items-center gap-2 transition-all duration-150
            ${dragIdx === idx ? 'opacity-40' : ''}
            ${overIdx === idx && dragIdx !== idx ? 'border-t-2 border-brand-400' : ''}
          `}
        >
          <div className="cursor-grab active:cursor-grabbing p-1 text-rmpg-500 hover:text-rmpg-300 flex-shrink-0">
            <GripVertical className="w-3.5 h-3.5" />
          </div>
          <div className="flex-1">{renderItem(item, idx)}</div>
        </div>
      ))}
    </div>
  );
}
