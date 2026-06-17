import { useState } from 'react';
import { Bookmark as BookmarkIcon, Plus, Trash2, X, CornerDownRight } from 'lucide-react';
import IconButton from '../../../components/IconButton';
import { Bookmark } from '../types';

// In-app bookmarks / outline editor. Named markers point at a page; clicking
// one jumps the canvas there. Bookmarks live in editor state (snapshotted to
// history) and survive page reorders via the page-remap callers apply.
//
// Bookmarks support one level of nesting: each top-level bookmark can hold
// child bookmarks (parentId). The "+ child" action on a row adds a bookmark at
// the current page nested under that row; the saved /Outlines mirrors the tree.

interface Props {
  bookmarks: Bookmark[];
  activePage: number;
  pageCount: number;
  onAdd: (title: string, page: number, parentId?: string) => void;
  onDelete: (id: string) => void;
  onJump: (page: number) => void;
  onClose: () => void;
}

export default function BookmarksPanel({ bookmarks, activePage, pageCount, onAdd, onDelete, onJump, onClose }: Props) {
  const [title, setTitle] = useState('');

  const add = (parentId?: string) => {
    const t = title.trim() || `Page ${activePage}`;
    onAdd(t, activePage, parentId);
    setTitle('');
  };

  const roots = bookmarks.filter(b => !b.parentId).sort((a, b) => a.page - b.page);
  const childrenOf = (id: string) => bookmarks.filter(b => b.parentId === id).sort((a, b) => a.page - b.page);

  const Row = ({ b, child }: { b: Bookmark; child?: boolean }) => (
    <div className={`group flex items-center gap-1 rounded-sm px-1.5 py-1 ${child ? 'ml-3' : ''} ${b.page === activePage ? 'bg-[#d4a017]/15' : 'hover:bg-rmpg-700/30'}`}>
      {child && <CornerDownRight className="w-3 h-3 text-rmpg-600 flex-shrink-0" aria-hidden="true" />}
      <button type="button" onClick={() => onJump(b.page)} className="flex-1 text-left min-w-0" title={`Go to page ${b.page}`}>
        <div className="text-[10px] text-rmpg-200 truncate">{b.title}</div>
        <div className="text-[9px] text-rmpg-600">Page {b.page > pageCount ? '?' : b.page}</div>
      </button>
      {!child && (
        <IconButton onClick={() => add(b.id)} aria-label={`Add child bookmark under ${b.title}`} title={`Add child bookmark (page ${activePage}) under "${b.title}"`}
          className="p-0.5 text-rmpg-500 hover:text-[#d4a017] opacity-0 group-hover:opacity-100"><Plus className="w-3 h-3" /></IconButton>
      )}
      <IconButton onClick={() => onDelete(b.id)} aria-label="Delete bookmark"
        className="p-0.5 text-rmpg-500 hover:text-red-400 opacity-0 group-hover:opacity-100"><Trash2 className="w-3 h-3" /></IconButton>
    </div>
  );

  return (
    <div className="bg-[#0d0d0d] border border-[#222222] rounded-[2px] w-[220px] flex-shrink-0 p-2 overflow-y-auto">
      <div className="flex items-center gap-1.5 mb-2 px-1">
        <BookmarkIcon className="w-3.5 h-3.5 text-[#d4a017]" />
        <div className="text-[9px] uppercase tracking-wider text-[#d4a017] font-semibold">Bookmarks</div>
        <IconButton onClick={onClose} aria-label="Close bookmarks" className="ml-auto p-0.5 text-rmpg-400 hover:text-rmpg-100"><X className="w-3 h-3" /></IconButton>
      </div>

      <div className="flex items-center gap-1 mb-2">
        <input
          id="ff-bookmark-title"
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add(); }}
          placeholder={`Name (pg ${activePage})`}
          className="flex-1 bg-[#0a0a0a] border border-[#222] text-[10px] text-rmpg-100 px-1.5 py-1 rounded-sm focus:outline-none focus:border-[#d4a017]"
        />
        <IconButton onClick={() => add()} aria-label="Add bookmark at current page" title={`Bookmark page ${activePage}`}
          className="p-1 text-[#d4a017] hover:text-rmpg-100 border border-[#222] rounded-sm"><Plus className="w-3 h-3" /></IconButton>
      </div>

      {roots.length === 0 ? (
        <div className="text-[10px] text-rmpg-600 px-1 py-2">No bookmarks. Add one to jump quickly between pages. Hover a row and press + to nest a child under it.</div>
      ) : (
        <div className="space-y-0.5">
          {roots.map(b => (
            <div key={b.id}>
              <Row b={b} />
              {childrenOf(b.id).map(c => <Row key={c.id} b={c} child />)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
