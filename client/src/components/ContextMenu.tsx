import { useState, useEffect, useRef, useCallback, ReactNode, ReactElement, cloneElement, isValidElement } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  label: string;
  icon?: React.ElementType;
  onClick: () => void;
  divider?: boolean;
  disabled?: boolean;
  danger?: boolean;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  children: ReactNode;
}

const MENU_MIN_WIDTH = 180;

function ContextMenu({ items, children }: ContextMenuProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [focusIndex, setFocusIndex] = useState(-1);
  const menuRef = useRef<HTMLDivElement>(null);

  const selectableIndices = items
    .map((item, i) => (!item.divider && !item.disabled ? i : -1))
    .filter((i) => i !== -1);

  const close = useCallback(() => {
    setVisible(false);
    setFocusIndex(-1);
  }, []);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const menuHeight = items.length * 32 + 8;
      const menuWidth = MENU_MIN_WIDTH;

      let x = e.clientX;
      let y = e.clientY;

      if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 4;
      if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 4;
      if (x < 0) x = 4;
      if (y < 0) y = 4;

      setPos({ x, y });
      setFocusIndex(-1);
      setVisible(true);
    },
    [items.length],
  );

  useEffect(() => {
    if (!visible) return;

    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) close();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIndex((prev) => {
          const cur = selectableIndices.indexOf(prev);
          const next = cur < selectableIndices.length - 1 ? cur + 1 : 0;
          return selectableIndices[next];
        });
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIndex((prev) => {
          const cur = selectableIndices.indexOf(prev);
          const next = cur > 0 ? cur - 1 : selectableIndices.length - 1;
          return selectableIndices[next];
        });
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        if (focusIndex >= 0 && items[focusIndex] && !items[focusIndex].disabled && !items[focusIndex].divider) {
          items[focusIndex].onClick();
          close();
        }
      }
    };

    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [visible, close, focusIndex, items, selectableIndices]);

  // Adjust position after render if menu overflows viewport
  useEffect(() => {
    if (!visible || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    let { x, y } = pos;
    let adjusted = false;

    if (rect.right > window.innerWidth) {
      x = window.innerWidth - rect.width - 4;
      adjusted = true;
    }
    if (rect.bottom > window.innerHeight) {
      y = window.innerHeight - rect.height - 4;
      adjusted = true;
    }
    if (adjusted) setPos({ x, y });
  }, [visible, pos]);

  const menu = visible
    ? createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 9999, minWidth: MENU_MIN_WIDTH }}
          className="bg-[#141414] border border-[#2a2a2a] rounded-sm py-1 shadow-lg"
        >
          {items.map((item, i) => {
            if (item.divider) {
              return <div key={i} className="border-t border-[#2a2a2a] my-1" />;
            }

            const Icon = item.icon;
            const focused = focusIndex === i;

            return (
              <button
                key={i}
                role="menuitem"
                type="button"
                disabled={item.disabled}
                className={`
                  w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px]
                  ${item.danger ? 'text-red-400' : 'text-[#cccccc]'}
                  ${item.disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
                  ${focused ? 'bg-[#1e1e1e]' : ''}
                  ${!item.disabled ? 'hover:bg-[#1e1e1e]' : ''}
                `}
                onClick={() => {
                  if (!item.disabled) {
                    item.onClick();
                    close();
                  }
                }}
              >
                {Icon && <Icon className="w-3.5 h-3.5 flex-shrink-0" />}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>,
        document.body,
      )
    : null;

  // Attach onContextMenu to the child element
  const child = isValidElement(children)
    ? cloneElement(children as ReactElement<any>, { onContextMenu: handleContextMenu })
    : <span onContextMenu={handleContextMenu}>{children}</span>;

  return (
    <>
      {child}
      {menu}
    </>
  );
}

ContextMenu.displayName = 'ContextMenu';

export default ContextMenu;
