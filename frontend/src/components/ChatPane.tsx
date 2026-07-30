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
  { id: 'deepseek/deepseek-r1:free', label: 'DeepSeek R1 (free)', vision: false, tools: false },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B (free)', vision: false, tools: false },
  { id: 'qwen/qwen-2.5-72b-instruct:free', label: 'Qwen 2.5 72B (free)', vision: false, tools: false },
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

  const allModels = [...FREE_MODELS, KIMI_K3_MODEL];
  const selectedModel = allModels.find((m) => m.id === model) ?? FREE_MODELS[0];

  useEffect(() => {
    apiFetch(`/conversations/${conversationId}`)
      .then((res) => res.json() as Promise<{ messages: Message[] }>)
      .then((data) => setMessages(data.messages));
    setAttachments([]);
    setToolStatus(null);
  }, [conversationId]);

  async function handleFiles(files: FileList | null) {
    if (!files || !selectedModel.vision) return;
    setError(null);
    for (const file of Array.from(files)) {
      if (file.size > MAX_IMAGE_BYTES) {
        setError(`"${file.name}" is over 5MB and was not attached.`);
        continue;
      }
      const dataUrl = await fileToDataUrl(file);
      setAttachments((prev) => [...prev, dataUrl]);
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
    if ((!input.trim() && attachments.length === 0) || streaming) return;
    setError(null);
    setToolStatus(null);

    const contentType: 'text' | 'parts' = attachments.length > 0 ? 'parts' : 'text';
    const outgoingContent: string =
      contentType === 'parts'
        ? JSON.stringify([
            ...(input.trim() ? [{ type: 'text', text: input } as ContentPart] : []),
            ...attachments.map((url) => ({ type: 'image_url', image_url: { url } }) as ContentPart),
          ])
        : input;

    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', content: outgoingContent, content_type: contentType };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setAttachments([]);
    setStreaming(true);

    const assistantId = crypto.randomUUID();
    setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '', content_type: 'text' }]);

    const res = await apiFetch(`/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content: outgoingContent, model, contentType }),
    });

    const reader = res.body!.getReader();
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
            setToolStatus(`🔍 Searching the web for "${parsed.query}"…`);
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

    setStreaming(false);
    setToolStatus(null);
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
              <img key={i} src={p.image_url.url} alt="attachment" style={{ maxWidth: 200, display: 'block' }} />
            )
          )}
        </>
      );
    } catch {
      return <span>{m.content}</span>;
    }
  }

  return (
    <div>
      <select value={model} onChange={(e) => setModel(e.target.value)}>
        {FREE_MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
        <option value={KIMI_K3_MODEL.id} disabled={!enableKimiK3}>
          {KIMI_K3_MODEL.label}
        </option>
      </select>

      <ul>
        {messages.map((m) => (
          <li key={m.id}>
            <strong>{m.role}:</strong> {renderContent(m)}
          </li>
        ))}
        {toolStatus && <li aria-live="polite">{toolStatus}</li>}
      </ul>

      {error && <p role="alert">{error}</p>}

      <form onSubmit={handleSend}>
        {attachments.length > 0 && (
          <div>
            {attachments.map((url, i) => (
              <span key={i}>
                <img src={url} alt="pending attachment" style={{ maxWidth: 60, maxHeight: 60 }} />
                <button type="button" onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}>
                  remove
                </button>
              </span>
            ))}
          </div>
        )}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={handlePaste}
          disabled={streaming}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          disabled={streaming || !selectedModel.vision}
          onChange={(e) => handleFiles(e.target.files)}
        />
        <button type="submit" disabled={streaming}>
          Send
        </button>
      </form>
    </div>
  );
}
