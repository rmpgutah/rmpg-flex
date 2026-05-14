import { useState } from 'react';

import RichTextArea from './RichTextArea';
interface Props {
  onSend: (to: string[], cc: string[], subject: string, body: string) => void;
  onCancel: () => void;
  defaultSubject?: string;
}

export function PdfEmailDialog({ onSend, onCancel, defaultSubject = '' }: Props) {
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState('');

  const parse = (s: string) => s.split(',').map((v) => v.trim()).filter(Boolean);

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center">
      <div className="bg-[#141414] border border-[#2e2e2e] w-[480px] p-4">
        <h3 className="text-[#d4a017] font-bold text-sm mb-3">Email PDF</h3>
        <label className="block mb-2 text-xs">
          <span className="block text-gray-400 uppercase mb-1">To (comma-separated)</span>
          <input
            aria-label="To"
            className="w-full bg-[#050505] text-white border border-[#2e2e2e] p-1"
            value={to} onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label className="block mb-2 text-xs">
          <span className="block text-gray-400 uppercase mb-1">Cc (optional)</span>
          <input
            aria-label="Cc"
            className="w-full bg-[#050505] text-white border border-[#2e2e2e] p-1"
            value={cc} onChange={(e) => setCc(e.target.value)}
          />
        </label>
        <label className="block mb-2 text-xs">
          <span className="block text-gray-400 uppercase mb-1">Subject</span>
          <input
            aria-label="Subject"
            className="w-full bg-[#050505] text-white border border-[#2e2e2e] p-1"
            value={subject} onChange={(e) => setSubject(e.target.value)}
          />
        </label>
        <label className="block mb-3 text-xs">
          <span className="block text-gray-400 uppercase mb-1">Body</span>
          <RichTextArea
            aria-label="Body"
            rows={5}
            className="w-full bg-[#050505] text-white border border-[#2e2e2e] p-1"
            value={body} onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="px-3 py-1 bg-gray-700 text-white text-xs">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSend(parse(to), parse(cc), subject, body)}
            className="px-3 py-1 bg-[#d4a017] text-black font-bold text-xs"
            disabled={!to.trim() || !subject.trim()}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
