// ═══════════════════════════════════════════════════════════════
// Feature 23: Right-click Context Menu on records
// ═══════════════════════════════════════════════════════════════
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  separator?: boolean;
  danger?: boolean;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  children: React.ReactNode;
  disabled?: boolean;
}

export default function ContextMenu({ items, children, disabled }: ContextMenuProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();

    // Compute position, ensure menu stays within viewport
    const x = Math.min(e.clientX, window.innerWidth - 200);
    const y = Math.min(e.clientY, window.innerHeight - items.length * 32 - 20);

    setPosition({ x, y });
    setVisible(true);
  }, [disabled, items.length]);

  const handleClick = useCallback((item: ContextMenuItem) => {
    if (item.disabled) return;
    item.onClick();
    setVisible(false);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const close = () => setVisible(false);
    document.addEventListener('click', close);
    document.addEventListener('contextmenu', close);
    document.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('contextmenu', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [visible]);

  return (
    <>
      <div onContextMenu={handleContextMenu}>{children}</div>
      {visible && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[9999] min-w-[180px] bg-surface-base border border-[#2a3e58] shadow-xl py-1"
          style={{ left: position.x, top: position.y }}
        >
          {items.map((item, i) => (
            item.separator ? (
              <div key={i} className="border-t border-[#1e3048] my-1" />
            ) : (
              <button
                key={i}
                onClick={() => handleClick(item)}
                disabled={item.disabled}
                className={`
                  w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2
                  transition-colors duration-100
                  ${item.disabled
                    ? 'text-rmpg-600 cursor-not-allowed'
                    : item.danger
                      ? 'text-red-400 hover:bg-red-900/20'
                      : 'text-rmpg-200 hover:bg-surface-raised'
                  }
                `}
              >
                {item.icon && <span className="w-4 h-4 flex items-center justify-center">{item.icon}</span>}
                {item.label}
              </button>
            )
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
