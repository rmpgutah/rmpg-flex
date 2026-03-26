import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MessageSquare, Plus, Trash2, Send, Loader2, FileCode, X, Bot, User } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';

interface ChatMessage {
  id?: number;
  role: 'user' | 'assistant';
  content: string;
  latency_ms?: number;
  created_at?: string;
}

interface ChatSession {
  session_id: string;
  started_at: string;
  last_message: string;
  message_count: number;
  first_message: string;
}

export default function AIDevChatPanel() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSession, setActiveSession] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [fileContext, setFileContext] = useState('');
  const [showFileInput, setShowFileInput] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Generate session ID
  const newSessionId = () => `dev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Fetch sessions
  const fetchSessions = useCallback(async () => {
    try {
      const data = await apiFetch<ChatSession[]>('/ai/dev-chat/history');
      setSessions(data);
    } catch { /* ignore */ }
  }, []);

  // Load session messages
  const loadSession = useCallback(async (sessionId: string) => {
    setActiveSession(sessionId);
    try {
      const data = await apiFetch<ChatMessage[]>(`/ai/dev-chat/history/${sessionId}`);
      setMessages(data);
    } catch { /* ignore */ }
  }, []);

  // Create new session
  const createNewSession = useCallback(() => {
    const id = newSessionId();
    setActiveSession(id);
    setMessages([]);
    setStreamingContent('');
  }, []);

  // Delete session
  const deleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this conversation?')) return;
    try {
      await apiFetch(`/ai/dev-chat/history/${sessionId}`, { method: 'DELETE' });
      setSessions(s => s.filter(x => x.session_id !== sessionId));
      if (activeSession === sessionId) {
        createNewSession();
      }
    } catch { /* ignore */ }
  };

  // Send message with SSE streaming
  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    const sessionId = activeSession || newSessionId();
    if (!activeSession) setActiveSession(sessionId);

    // Add user message to UI immediately
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setInput('');
    setIsStreaming(true);
    setStreamingContent('');

    try {
      // Get auth token
      const token = localStorage.getItem('token');

      const response = await fetch('/api/ai/dev-chat/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: text,
          sessionId,
          context: fileContext || undefined,
        }),
      });

      if (!response.ok || !response.body) {
        // Fallback to non-streaming
        const data = await apiFetch<{ content: string; latencyMs: number }>('/ai/dev-chat/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, sessionId, context: fileContext || undefined }),
        });
        setMessages(prev => [...prev, { role: 'assistant', content: data.content, latency_ms: data.latencyMs }]);
        setIsStreaming(false);
        fetchSessions();
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let latencyMs = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const parsed = JSON.parse(line.slice(6));
            if (parsed.thinking) {
              // Model is reasoning — show status but don't add to content
              setStreamingContent('...');
            } else if (parsed.token) {
              fullContent += parsed.token;
              setStreamingContent(fullContent);
            }
            if (parsed.done) {
              latencyMs = parsed.latencyMs || 0;
            }
            if (parsed.error) {
              fullContent = `Error: ${parsed.error}`;
              setStreamingContent(fullContent);
            }
          } catch { /* ignore partial JSON */ }
        }
      }

      if (fullContent) {
        setMessages(prev => [...prev, { role: 'assistant', content: fullContent, latency_ms: latencyMs }]);
      }
      setStreamingContent('');
      fetchSessions();
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err?.message || 'Connection failed'}` }]);
    } finally {
      setIsStreaming(false);
      setFileContext('');
      setShowFileInput(false);
    }
  };

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Initial load
  useEffect(() => {
    fetchSessions();
    createNewSession();
  }, [fetchSessions, createNewSession]);

  // Handle Enter key (Shift+Enter for newline)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Render markdown-like content (code blocks, inline code, bold)
  const renderContent = (content: string) => {
    const parts = content.split(/(```[\s\S]*?```)/g);
    return parts.map((part, i) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        const lines = part.slice(3, -3);
        const firstNewline = lines.indexOf('\n');
        const lang = firstNewline > 0 ? lines.slice(0, firstNewline).trim() : '';
        const code = firstNewline > 0 ? lines.slice(firstNewline + 1) : lines;
        return (
          <div key={i} className="my-2">
            {lang && (
              <div className="text-[10px] text-gray-500 bg-[#0d1520] border border-[#1a3550] border-b-0 rounded-t px-2 py-0.5 font-mono">
                {lang}
              </div>
            )}
            <pre
              className={`bg-[#0d1520] border border-[#1a3550] text-green-400 font-mono text-xs p-3 overflow-x-auto ${
                lang ? 'rounded-b' : 'rounded'
              }`}
            >
              <code>{code}</code>
            </pre>
          </div>
        );
      }
      // Render inline code and bold
      return (
        <span key={i}>
          {part.split(/(`[^`]+`)/g).map((seg, j) => {
            if (seg.startsWith('`') && seg.endsWith('`')) {
              return (
                <code key={j} className="bg-[#0d1520] text-amber-400 px-1 py-0.5 rounded text-xs font-mono">
                  {seg.slice(1, -1)}
                </code>
              );
            }
            // Bold
            return seg.split(/(\*\*[^*]+\*\*)/g).map((s, k) => {
              if (s.startsWith('**') && s.endsWith('**')) {
                return (
                  <strong key={`${j}-${k}`} className="text-white font-semibold">
                    {s.slice(2, -2)}
                  </strong>
                );
              }
              return <React.Fragment key={`${j}-${k}`}>{s}</React.Fragment>;
            });
          })}
        </span>
      );
    });
  };

  return (
    <div className="flex h-[calc(100vh-280px)] min-h-[500px] bg-[#0d1520] rounded border border-[#1a3550] overflow-hidden">
      {/* Session Sidebar */}
      <div className="w-60 flex-shrink-0 bg-[#0d1520] border-r border-[#1a3550] flex flex-col">
        <div className="p-3 border-b border-[#1a3550]">
          <button
            onClick={createNewSession}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-[#1a5a9e] hover:bg-[#1a6abe] text-white text-xs font-medium rounded transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New Chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sessions.map(s => (
            <div
              key={s.session_id}
              onClick={() => loadSession(s.session_id)}
              className={`group flex items-start gap-2 px-3 py-2 cursor-pointer border-b border-[#1a3550]/50 transition-colors ${
                activeSession === s.session_id ? 'bg-[#1a3550]/50' : 'hover:bg-[#141e2b]'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5 text-gray-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-300 truncate">{s.first_message || 'New conversation'}</p>
                <p className="text-[10px] text-gray-600">{s.message_count} messages</p>
              </div>
              <button
                onClick={(e) => deleteSession(s.session_id, e)}
                className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
          {sessions.length === 0 && (
            <p className="text-center text-gray-600 text-xs py-8">No conversations yet</p>
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && !streamingContent && (
            <div className="flex flex-col items-center justify-center h-full text-gray-600">
              <Bot className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm font-medium">RMPG Flex Dev Assistant</p>
              <p className="text-xs mt-1">Ask about the codebase, request features, debug issues</p>
              <div className="mt-4 grid grid-cols-2 gap-2 max-w-md">
                {[
                  'How does the dispatch system work?',
                  'Show me the database schema for incidents',
                  'How do I add a new API endpoint?',
                  'Suggest improvements for the map page',
                ].map((suggestion, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setInput(suggestion);
                      inputRef.current?.focus();
                    }}
                    className="text-left text-[11px] text-gray-500 hover:text-gray-300 bg-[#141e2b] hover:bg-[#1a2636] border border-[#1a3550] rounded p-2 transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' && (
                <div className="w-7 h-7 rounded bg-[#1a5a9e] flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 text-white" />
                </div>
              )}
              <div
                className={`max-w-[80%] ${
                  msg.role === 'user'
                    ? 'bg-[#1a5a9e] text-white rounded-lg rounded-tr-sm px-3 py-2'
                    : 'bg-[#1a2636] text-gray-200 rounded-lg rounded-tl-sm px-3 py-2 border border-[#1a3550]'
                }`}
              >
                <div className="text-sm whitespace-pre-wrap leading-relaxed">
                  {msg.role === 'assistant' ? renderContent(msg.content) : msg.content}
                </div>
                {msg.latency_ms ? (
                  <p className="text-[10px] text-gray-500 mt-1">{(msg.latency_ms / 1000).toFixed(1)}s</p>
                ) : null}
              </div>
              {msg.role === 'user' && (
                <div className="w-7 h-7 rounded bg-gray-700 flex items-center justify-center flex-shrink-0">
                  <User className="w-4 h-4 text-gray-300" />
                </div>
              )}
            </div>
          ))}

          {/* Streaming message */}
          {isStreaming && (
            <div className="flex gap-3 justify-start">
              <div className="w-7 h-7 rounded bg-[#1a5a9e] flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-white" />
              </div>
              <div className="max-w-[80%] bg-[#1a2636] text-gray-200 rounded-lg rounded-tl-sm px-3 py-2 border border-[#1a3550]">
                {streamingContent ? (
                  <div className="text-sm whitespace-pre-wrap leading-relaxed">
                    {renderContent(streamingContent)}
                    <span className="inline-block w-2 h-4 bg-blue-400 animate-pulse ml-0.5" />
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-gray-500 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Thinking...
                  </div>
                )}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* File context bar */}
        {showFileInput && (
          <div className="px-4 py-2 border-t border-[#1a3550] bg-[#141e2b] flex items-center gap-2">
            <FileCode className="w-4 h-4 text-gray-500" />
            <input
              type="text"
              value={fileContext}
              onChange={e => setFileContext(e.target.value)}
              placeholder="Enter file path for context (e.g., client/src/pages/AdminPage.tsx)"
              className="flex-1 bg-[#0d1520] border border-[#1a3550] text-white text-xs px-2 py-1.5 rounded focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={() => {
                setShowFileInput(false);
                setFileContext('');
              }}
              className="text-gray-500 hover:text-gray-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Input area */}
        <div className="p-3 border-t border-[#1a3550] bg-[#141e2b]">
          <div className="flex items-end gap-2">
            <button
              onClick={() => setShowFileInput(!showFileInput)}
              className={`p-2 rounded transition-colors ${
                showFileInput || fileContext ? 'text-blue-400 bg-blue-500/10' : 'text-gray-500 hover:text-gray-300'
              }`}
              title="Attach file context"
            >
              <FileCode className="w-4 h-4" />
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about the codebase, request changes, debug issues..."
              rows={1}
              className="flex-1 bg-[#0d1520] border border-[#1a3550] text-white text-sm px-3 py-2 rounded resize-none focus:outline-none focus:border-blue-500 max-h-32"
              style={{ minHeight: '36px' }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = Math.min(el.scrollHeight, 128) + 'px';
              }}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || isStreaming}
              className="p-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded transition-colors"
            >
              {isStreaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
          {fileContext && (
            <p className="text-[10px] text-blue-400 mt-1 ml-10">Context: {fileContext}</p>
          )}
        </div>
      </div>
    </div>
  );
}
