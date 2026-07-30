import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api';

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

type Message = {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  content_type: 'text' | 'parts';
};

type ModelOption = { id: string; label: string; vision: boolean; tools: boolean };

const FREE_MODELS: ModelOption[] = [
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'Nemotron 3 Ultra 550B (free)', vision: false, tools: true },
  { id: 'nvidia/nemotron-3-super-120b-a12b:free', label: 'Nemotron 3 Super 120B (free)', vision: false, tools: true },
  { id: 'google/gemma-4-26b-a4b-it:free', label: 'Gemma 4 26B (free, vision)', vision: true, tools: true },
  { id: 'openai/gpt-oss-20b:free', label: 'GPT-OSS 20B (free)', vision: false, tools: true },
  { id: 'inclusionai/ling-3.0-flash:free', label: 'Ling 3.0 Flash (free)', vision: false, tools: false },
  { id: 'poolside/laguna-xs-2.1:free', label: 'Laguna XS 2.1 (free)', vision: false, tools: true },
  { id: 'cohere/north-mini-code:free', label: 'North Mini Code (free)', vision: false, tools: true },
];
const KIMI_K3_MODEL: ModelOption = { id: 'moonshotai/kimi-k3', label: 'Kimi K3 (paid)', vision: true, tools: true };

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ChatPane({ conversationId, enableKimiK3 }: { conversationId: string; enableKimiK3: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [model, setModel] = useState(FREE_MODELS[0].id);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const allModels = [...FREE_MODELS, KIMI_K3_MODEL];
  const selectedModel = allModels.find((m) => m.id === model) ?? FREE_MODELS[0];

  useEffect(() => {
    apiFetch(`/conversations/${conversationId}`)
      .then((res) => res.json() as Promise<{ messages: Message[] }>)
      .then((data) => setMessages(data.messages))
      .catch(() => setError('Failed to load conversation.'));
    setAttachments([]);
    setToolStatus(null);
  }, [conversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, toolStatus]);

  async function handleFiles(files: FileList | null) {
    if (!files || !selectedModel.vision) return;
    setError(null);
    const rejected: string[] = [];
    for (const file of Array.from(files)) {
      if (file.size > MAX_IMAGE_BYTES) {
        rejected.push(file.name);
        continue;
      }
      const dataUrl = await fileToDataUrl(file);
      setAttachments((prev) => [...prev, dataUrl]);
    }
    if (rejected.length > 0) {
      setError(`Over 5MB, not attached: ${rejected.join(', ')}`);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    if (!selectedModel.vision) return;
    const items = Array.from(e.clipboardData.items).filter((item) => item.type.startsWith('image/'));
    if (items.length === 0) return;
    const files = items.map((item) => item.getAsFile()).filter((f): f is File => f !== null);
    const list = new DataTransfer();
    files.forEach((f) => list.items.add(f));
    handleFiles(list.files);
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if ((!trimmed && attachments.length === 0) || streaming) return;
    setError(null);
    setToolStatus(null);

    const contentType: 'text' | 'parts' = attachments.length > 0 ? 'parts' : 'text';
    const outgoingContent: string =
      contentType === 'parts'
        ? JSON.stringify([
            ...(trimmed ? [{ type: 'text', text: trimmed } as ContentPart] : []),
            ...attachments.map((url) => ({ type: 'image_url', image_url: { url } }) as ContentPart),
          ])
        : trimmed;

    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', content: outgoingContent, content_type: contentType };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setAttachments([]);
    setStreaming(true);

    const assistantId = crypto.randomUUID();
    setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '', content_type: 'text' }]);

    try {
      const res = await apiFetch(`/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: outgoingContent, model, contentType }),
      });

      if (!res.ok || !res.body) {
        setError(`Request failed (${res.status}). Try again or pick a different model.`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice('event: '.length);
            continue;
          }
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice('data: '.length);

          if (currentEvent === 'error') {
            try {
              const parsed = JSON.parse(raw);
              setError(parsed.message ?? 'Something went wrong, try again or pick a different model.');
            } catch {
              setError('Something went wrong, try again or pick a different model.');
            }
            currentEvent = null;
            continue;
          }

          if (currentEvent === 'tool_call') {
            try {
              const parsed = JSON.parse(raw);
              setToolStatus(`Searching the web for "${parsed.query}"…`);
            } catch {
              // ignore malformed tool_call frame
            }
            currentEvent = null;
            continue;
          }

          if (raw === '[DONE]') {
            setToolStatus(null);
            currentEvent = null;
            continue;
          }

          try {
            const parsed = JSON.parse(raw);
            const delta: string = parsed.choices?.[0]?.delta?.content ?? '';
            if (delta) {
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m))
              );
            }
          } catch {
            // ignore malformed lines (including our own non-content event data lines)
          }
          currentEvent = null;
        }
      }
    } catch {
      setError('Network error, try again or pick a different model.');
    } finally {
      setStreaming(false);
      setToolStatus(null);
    }
  }

  function renderContent(m: Message) {
    if (m.content_type === 'text') return <span>{m.content}</span>;
    try {
      const parts = JSON.parse(m.content) as ContentPart[];
      return (
        <>
          {parts.map((p, i) =>
            p.type === 'text' ? (
              <span key={i}>{p.text}</span>
            ) : (
              <img key={i} className="msg__image" src={p.image_url.url} alt="attachment" />
            )
          )}
        </>
      );
    } catch {
      return <span>{m.content}</span>;
    }
  }

  const lastMessage = messages[messages.length - 1];

  return (
    <div className="chat">
      <div className="chat__header">
        <select className="chat__model" value={model} onChange={(e) => setModel(e.target.value)}>
          {FREE_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
          <option value={KIMI_K3_MODEL.id} disabled={!enableKimiK3}>
            {KIMI_K3_MODEL.label}
          </option>
        </select>
        {!selectedModel.vision && <span className="chat__model-tag">No image attachments on this model</span>}
      </div>

      <div className="chat__messages">
        {messages.map((m) => {
          const isStreamingHere = streaming && m.id === lastMessage?.id && m.role === 'assistant';
          return (
            <div key={m.id} className={`msg msg--${m.role}`}>
              <div className="msg__role">{m.role === 'user' ? 'You' : m.role === 'assistant' ? 'Assistant' : 'Tool'}</div>
              <div className="msg__bubble">
                {renderContent(m)}
                {isStreamingHere && <span className="msg__caret" />}
              </div>
            </div>
          );
        })}
        {toolStatus && (
          <div className="tool-status" aria-live="polite">
            <span className="pulse" />
            {toolStatus}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {error && (
        <p className="chat__error" role="alert">
          {error}
        </p>
      )}

      {attachments.length > 0 && (
        <div className="chat__attachments">
          {attachments.map((url, i) => (
            <div key={i} className="chat__attachment">
              <img src={url} alt="pending attachment" />
              <button type="button" onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <form className="chat__composer" onSubmit={handleSend}>
        <div className="chat__composer-inner">
          <label className="chat__attach-btn" title={selectedModel.vision ? 'Attach image' : 'This model does not support images'}>
            +
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              disabled={streaming || !selectedModel.vision}
              onChange={(e) => handleFiles(e.target.files)}
            />
          </label>
          <input
            className="chat__input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={handlePaste}
            placeholder="Message kimi-connect…"
            disabled={streaming}
          />
          <button className="chat__send" type="submit" disabled={streaming} aria-label="Send">
            ↑
          </button>
        </div>
      </form>
    </div>
  );
}
