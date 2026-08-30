import { useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/core';
import {
  X, Search, Clock, BookOpen, User, Phone, Sparkles, Mic, MicOff, Hash, FileSignature,
  QrCode, Type, BarChart3, Save, Eraser, ListTree, Footprints, Shield, Star,
} from 'lucide-react';
import { SNIPPETS, type Snippet } from '../features/snippets';
import {
  insertDate, insertTime, insertDateTime, insertISO, insertMilitary, insertWeekday, insertEpoch, insertCaseDate,
  redactSelection, insertChainOfCustody, insertBates, currentBates, resetBates,
  insertFootnote, buildTOC, readability, listUserTemplates, saveUserTemplate, deleteUserTemplate,
  searchStatutes, insertStatute, searchPersons, insertPersonBlock, searchCalls, insertCallBlock,
  startDictation, type DictationSession, type StatuteHit, type PersonHit, type CallHit,
  insertSignatureFromFile, insertQRCode,
} from '../features';
import ConfirmDialog from '../../../components/ConfirmDialog';
import PromptDialog from '../../../components/PromptDialog';

type Tab = 'snippets' | 'statutes' | 'persons' | 'calls' | 'tools' | 'userTemplates';

interface Props {
  editor: Editor | null;
  onClose: () => void;
  /** Optional case URL used by the QR-linkback tool. */
  caseUrl?: string;
}

const SNIP_FAV_KEY = 'rmpg_writer_snip_favs';
function readFavs(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SNIP_FAV_KEY) || '[]')); } catch { return new Set(); }
}
function writeFavs(s: Set<string>) { localStorage.setItem(SNIP_FAV_KEY, JSON.stringify([...s])); }

// Convert common HTML entities back to plain text for display in the panel.
function decode(s: string): string {
  // Decode &amp; LAST: doing it first lets "&amp;lt;" collapse into "<" (double-unescaping).
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&rsquo;/g, '’').replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”').replace(/&amp;/g, '&');
}

export default function FeaturesPanel({ editor, onClose, caseUrl }: Props) {
  const [tab, setTab] = useState<Tab>('snippets');
  const [q, setQ] = useState('');
  const [favs, setFavs] = useState<Set<string>>(readFavs);

  const [statuteHits, setStatuteHits] = useState<StatuteHit[]>([]);
  const [personHits, setPersonHits] = useState<PersonHit[]>([]);
  const [callHits, setCallHits] = useState<CallHit[]>([]);
  const [searching, setSearching] = useState(false);

  const [dictation, setDictation] = useState<DictationSession | null>(null);
  const [readout, setReadout] = useState<string | null>(null);
  const [userTpls, setUserTpls] = useState(listUserTemplates());
  const [deleteTpl, setDeleteTpl] = useState<{ id: string; name: string } | null>(null);
  const [promptKind, setPromptKind] = useState<'template' | 'qr' | 'footnote' | null>(null);

  const toggleFav = (id: string) => {
    setFavs(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      writeFavs(next);
      return next;
    });
  };

  const filteredSnips = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return SNIPPETS;
    return SNIPPETS.filter(s =>
      s.label.toLowerCase().includes(term) ||
      s.text.toLowerCase().includes(term) ||
      s.group.toLowerCase().includes(term) ||
      (s.tags?.some(t => t.includes(term)) ?? false),
    );
  }, [q]);
  const grouped = useMemo(() => {
    const m = new Map<string, Snippet[]>();
    for (const s of filteredSnips) {
      const arr = m.get(s.group) || [];
      arr.push(s); m.set(s.group, arr);
    }
    return [...m.entries()];
  }, [filteredSnips]);

  useEffect(() => {
    if (tab !== 'statutes' || !q.trim()) { setStatuteHits([]); return; }
    const t = setTimeout(async () => { setSearching(true); setStatuteHits(await searchStatutes(q)); setSearching(false); }, 250);
    return () => clearTimeout(t);
  }, [tab, q]);
  useEffect(() => {
    if (tab !== 'persons' || !q.trim()) { setPersonHits([]); return; }
    const t = setTimeout(async () => { setSearching(true); setPersonHits(await searchPersons(q)); setSearching(false); }, 250);
    return () => clearTimeout(t);
  }, [tab, q]);
  useEffect(() => {
    if (tab !== 'calls' || !q.trim()) { setCallHits([]); return; }
    const t = setTimeout(async () => { setSearching(true); setCallHits(await searchCalls(q)); setSearching(false); }, 250);
    return () => clearTimeout(t);
  }, [tab, q]);

  const insertSnip = (s: Snippet) => {
    if (!editor) return;
    editor.chain().focus().insertContent(s.text).run();
  };

  const doReadability = () => {
    if (!editor) return;
    const r = readability(editor.getText());
    setReadout(`${r.words} words · ${r.sentences} sentences · F-K grade ${r.fleschKincaid} (${r.grade}) · Flesch ${r.flesch}`);
  };

  const doSaveAsTemplate = () => {
    if (!editor) return;
    setPromptKind('template');
  };

  const doSigUpload = () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => { const f = inp.files?.[0]; if (f) insertSignatureFromFile(editor, f); };
    inp.click();
  };

  const doQR = () => setPromptKind('qr');

  const doFootnote = () => setPromptKind('footnote');

  const doDictation = () => {
    if (dictation) { dictation.stop(); setDictation(null); return; }
    const s = startDictation(editor, (m) => setReadout(m));
    if (s) setDictation(s);
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: 'snippets', label: 'Snippets', icon: <Type className="w-3 h-3" />, count: SNIPPETS.length },
    { id: 'statutes', label: 'Statutes', icon: <BookOpen className="w-3 h-3" /> },
    { id: 'persons', label: 'Persons', icon: <User className="w-3 h-3" /> },
    { id: 'calls', label: 'CFS', icon: <Phone className="w-3 h-3" /> },
    { id: 'tools', label: 'Tools', icon: <Sparkles className="w-3 h-3" /> },
    { id: 'userTemplates', label: 'My Templates', icon: <Save className="w-3 h-3" />, count: userTpls.length },
  ];

  return (
    <>
    <div className="w-[360px] flex-shrink-0 bg-surface-sunken border border-border-default rounded-[2px] flex flex-col text-rmpg-200 text-xs">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default">
        <span className="font-semibold text-rmpg-100 uppercase tracking-wider text-[10px]">Tools &amp; Snippets</span>
        <button aria-label="Close" type="button" onClick={onClose} className="text-rmpg-500 hover:text-rmpg-100"><X className="w-3.5 h-3.5" /></button>
      </div>

      <div className="flex flex-wrap gap-1 px-2 py-2 border-b border-border-default">
        {tabs.map(t => {
          const active = tab === t.id;
          return (
            <button key={t.id} type="button"
              onClick={() => { setTab(t.id); setQ(''); }}
              className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded-[2px] border transition-colors ${active ? 'bg-accent-silver-500/15 border-accent-silver-500/40 text-accent-silver-300' : 'bg-surface-base border-border-default text-rmpg-400 hover:text-rmpg-200'}`}>
              {t.icon}<span>{t.label}</span>{t.count !== undefined && <span className="text-rmpg-600">{t.count}</span>}
            </button>
          );
        })}
      </div>

      {tab !== 'tools' && tab !== 'userTemplates' && (
        <div className="px-3 py-2 border-b border-border-default relative">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-600" />
          <input
            type="text" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={
              tab === 'snippets' ? 'Filter snippets...' :
              tab === 'statutes' ? 'Search Utah Code (76-5-102, "assault"...)' :
              tab === 'persons' ? 'Search persons by name or DOB...' :
              'Search calls by # or address...'
            }
            className="w-full bg-surface-sunken border border-border-default rounded-[2px] pl-6 pr-2 py-1 text-[11px] focus:border-accent-silver-500/40 focus:outline-none"
            aria-label="Search writer tools"
          />
        </div>
      )}

      <div className="flex-1 overflow-auto p-2 space-y-3">
        {tab === 'snippets' && grouped.map(([group, items]) => (
          <div key={group}>
            <h4 className="text-[9px] uppercase tracking-wider text-rmpg-500 mb-1 px-1">{decode(group)}</h4>
            <div className="space-y-0.5">
              {items.map(s => {
                const isFav = favs.has(s.id);
                return (
                  <div key={s.id} className="group flex items-start gap-1 hover:bg-surface-sunken rounded-[2px] p-1">
                    <button type="button" title={isFav ? 'Unfavorite' : 'Favorite'} onClick={() => toggleFav(s.id)}
                      className={`flex-shrink-0 mt-0.5 ${isFav ? 'text-accent-silver-300' : 'text-rmpg-700 hover:text-accent-silver-300'}`}>
                      <Star className="w-3 h-3" fill={isFav ? 'currentColor' : 'none'} />
                    </button>
                    <button type="button" onClick={() => insertSnip(s)}
                      className="flex-1 text-left text-[10px] text-rmpg-300 hover:text-rmpg-100 leading-snug"
                      title={decode(s.text)}>
                      <span className="font-medium">{decode(s.label)}</span>
                      <span className="text-rmpg-600 block line-clamp-2 text-[9px] mt-0.5">{decode(s.text)}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {tab === 'statutes' && (
          <div className="space-y-1">
            {searching && <p className="text-[10px] text-rmpg-500">Searching...</p>}
            {!searching && q && statuteHits.length === 0 && <p className="text-[10px] text-rmpg-500">No matches. Try a code number (e.g. 76-5-102) or keyword.</p>}
            {statuteHits.map((h) => (
              <button key={h.code} type="button" onClick={() => insertStatute(editor, h)}
                className="w-full text-left p-2 bg-surface-base border border-border-default rounded-[2px] hover:border-accent-silver-500/40">
                <div className="text-rmpg-100 text-[11px] font-mono">§{h.code}</div>
                {h.title && <div className="text-[10px] text-rmpg-200">{h.title}</div>}
                {h.text && <div className="text-[9px] text-rmpg-500 line-clamp-2 mt-0.5">{h.text}</div>}
              </button>
            ))}
          </div>
        )}

        {tab === 'persons' && (
          <div className="space-y-1">
            {searching && <p className="text-[10px] text-rmpg-500">Searching...</p>}
            {personHits.map((p, i) => {
              const name = p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unknown';
              return (
                <button key={p.person_id || p.id || i} type="button" onClick={() => insertPersonBlock(editor, p)}
                  className="w-full text-left p-2 bg-surface-base border border-border-default rounded-[2px] hover:border-accent-silver-500/40">
                  <div className="text-[11px] text-rmpg-100 font-medium">{name}</div>
                  <div className="text-[9px] text-rmpg-500">DOB {p.dob || '—'} · {p.address || ''}</div>
                </button>
              );
            })}
          </div>
        )}

        {tab === 'calls' && (
          <div className="space-y-1">
            {searching && <p className="text-[10px] text-rmpg-500">Searching...</p>}
            {callHits.map((c, i) => (
              <button key={c.call_id || i} type="button" onClick={() => insertCallBlock(editor, c)}
                className="w-full text-left p-2 bg-surface-base border border-border-default rounded-[2px] hover:border-accent-silver-500/40">
                <div className="text-rmpg-100 text-[11px] font-mono">{c.call_number}</div>
                <div className="text-[10px] text-rmpg-200">{c.call_type} · {c.status}</div>
                <div className="text-[9px] text-rmpg-500">{c.address}</div>
              </button>
            ))}
          </div>
        )}

        {tab === 'tools' && (
          <div className="space-y-3">
            <Section label="Date & Time">
              <Btn icon={<Clock />} label="Date" onClick={() => insertDate(editor)} />
              <Btn icon={<Clock />} label="Time" onClick={() => insertTime(editor)} />
              <Btn icon={<Clock />} label="Date+Time" onClick={() => insertDateTime(editor)} />
              <Btn icon={<Clock />} label="Military" onClick={() => insertMilitary(editor)} />
              <Btn icon={<Clock />} label="ISO 8601" onClick={() => insertISO(editor)} />
              <Btn icon={<Clock />} label="Weekday" onClick={() => insertWeekday(editor)} />
              <Btn icon={<Clock />} label="Epoch" onClick={() => insertEpoch(editor)} />
              <Btn icon={<Clock />} label="YYYYMMDD" onClick={() => insertCaseDate(editor)} />
            </Section>
            <Section label="Insert">
              <Btn icon={<FileSignature />} label="Signature image" onClick={doSigUpload} />
              <Btn icon={<QrCode />} label="QR linkback" onClick={doQR} />
              <Btn icon={<Shield />} label="Chain of custody" onClick={() => insertChainOfCustody(editor)} />
              <Btn icon={<Hash />} label={`Bates (${currentBates()})`} onClick={() => insertBates(editor)} />
              <Btn icon={<Footprints />} label="Footnote" onClick={doFootnote} />
              <Btn icon={<ListTree />} label="TOC from headings" onClick={() => buildTOC(editor)} />
            </Section>
            <Section label="Transform">
              <Btn icon={<Eraser />} label="Redact selection" onClick={() => redactSelection(editor)} />
              <Btn icon={dictation ? <MicOff /> : <Mic />} label={dictation ? 'Stop dictation' : 'Dictate (voice)'} onClick={doDictation} active={!!dictation} />
              <Btn icon={<BarChart3 />} label="Readability score" onClick={doReadability} />
              <Btn icon={<Save />} label="Save as my template" onClick={doSaveAsTemplate} />
              <Btn icon={<Hash />} label="Reset Bates counter" onClick={() => { resetBates(); setReadout('Bates counter reset to 1.'); }} />
            </Section>
            {readout && <div className="text-[10px] text-rmpg-300 bg-surface-base border border-border-default p-2 rounded-[2px]">{readout}</div>}
          </div>
        )}

        {tab === 'userTemplates' && (
          <div className="space-y-1">
            {userTpls.length === 0 && <p className="text-[10px] text-rmpg-500">No saved templates yet. Use the &ldquo;Save as my template&rdquo; tool to add one.</p>}
            {userTpls.map(t => (
              <div key={t.id} className="flex items-center gap-1 p-2 bg-surface-base border border-border-default rounded-[2px]">
                <button type="button" onClick={() => editor?.chain().focus().setContent(t.html).run()}
                  className="flex-1 text-left">
                  <div className="text-[11px] text-rmpg-200">{t.name}</div>
                  <div className="text-[9px] text-rmpg-600">{new Date(t.createdAt).toLocaleString()}</div>
                </button>
                <button aria-label={`Delete template ${t.name}`} type="button" onClick={() => setDeleteTpl({ id: t.id, name: t.name })}
                  className="text-rmpg-600 hover:text-red-400 px-1"><X className="w-3 h-3" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
    <ConfirmDialog
      isOpen={deleteTpl != null}
      onClose={() => setDeleteTpl(null)}
      onConfirm={() => {
        if (!deleteTpl) return;
        deleteUserTemplate(deleteTpl.id);
        setUserTpls(listUserTemplates());
        setDeleteTpl(null);
      }}
      title="Delete template"
      message={`Delete "${deleteTpl?.name ?? ''}"?`}
      confirmLabel="Delete"
      confirmVariant="danger"
    />
    <PromptDialog
      isOpen={promptKind === 'template'}
      onClose={() => setPromptKind(null)}
      onSubmit={(name) => {
        if (!editor) return;
        saveUserTemplate(name, editor.getHTML());
        setUserTpls(listUserTemplates());
        setPromptKind(null);
      }}
      title="Save template"
      message="Name this document template."
      label="Template name"
      confirmLabel="Save"
    />
    <PromptDialog
      isOpen={promptKind === 'qr'}
      onClose={() => setPromptKind(null)}
      onSubmit={(url) => {
        void insertQRCode(editor, url);
        setPromptKind(null);
      }}
      title="QR linkback"
      message="URL to encode in the QR code."
      label="URL"
      defaultValue={caseUrl || (typeof window !== 'undefined' ? window.location.href : '')}
      confirmLabel="Insert"
    />
    <PromptDialog
      isOpen={promptKind === 'footnote'}
      onClose={() => setPromptKind(null)}
      onSubmit={(t) => {
        insertFootnote(editor, t);
        setPromptKind(null);
      }}
      title="Footnote"
      message="Footnote text inserted at the caret."
      label="Text"
      confirmLabel="Insert"
    />
    </>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-[9px] uppercase tracking-wider text-rmpg-500 mb-1.5 px-1">{label}</h4>
      <div className="grid grid-cols-2 gap-1">{children}</div>
    </div>
  );
}

function Btn({ icon, label, onClick, active }: { icon: React.ReactNode; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex items-center gap-1.5 px-2 py-1.5 text-[10px] rounded-[2px] border transition-colors ${active ? 'bg-accent-silver-500/15 border-accent-silver-500/40 text-accent-silver-300' : 'bg-surface-base border-border-default text-rmpg-300 hover:border-accent-silver-500/40 hover:text-rmpg-100'}`}>
      <span className="[&>svg]:w-3 [&>svg]:h-3 flex-shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}
