import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MessageSquare, Plus, Trash2, Send, Loader2, FileCode, X, Bot, User, Circle, Wifi, WifiOff } from 'lucide-react';
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

interface ThinkStep {
  phase: string;       // Phase label (shown as header)
  icon: string;        // Emoji icon
  detail: string;      // Detailed reasoning text
  files?: string[];    // Files being examined
}

// Generate rich, contextual thinking narrative based on query
function generateThinkingSteps(query: string): ThinkStep[] {
  const q = query.toLowerCase();
  const words = query.split(/\s+/).length;
  const steps: ThinkStep[] = [];

  // Phase 1: Query Analysis (always)
  steps.push({
    phase: 'QUERY ANALYSIS',
    icon: '🔍',
    detail: `Parsing input: "${query.slice(0, 100)}${query.length > 100 ? '...' : ''}"\n` +
      `Tokens: ~${words} words | Complexity: ${words > 20 ? 'HIGH' : words > 10 ? 'MEDIUM' : 'LOW'}\n` +
      `Intent classification: ${
        q.match(/how|what|why|explain/) ? 'INFORMATIONAL' :
        q.match(/fix|bug|error|broken/) ? 'DIAGNOSTIC' :
        q.match(/add|create|build|implement/) ? 'GENERATIVE' :
        q.match(/improve|optimize|enhance/) ? 'OPTIMIZATION' :
        'GENERAL'
      }`,
  });

  // Phase 2: Context-aware knowledge retrieval
  if (q.includes('dispatch') || q.includes('call') || q.includes('cad') || q.includes('unit')) {
    steps.push({
      phase: 'INTEL RETRIEVAL — DISPATCH SYSTEM',
      icon: '📡',
      detail: 'Accessing dispatch architecture knowledge base...\n' +
        'Key components identified:\n' +
        '  ├─ WebSocket real-time broadcast system (ws://)\n' +
        '  ├─ Call lifecycle: PENDING → DISPATCHED → EN_ROUTE → ON_SCENE → CLOSED\n' +
        '  ├─ Unit status tracking: AVAILABLE → DISPATCHED → BUSY → OUT_OF_SERVICE\n' +
        '  └─ Auto-assignment algorithm with priority weighting',
      files: ['client/src/pages/dispatch/DispatchPage.tsx', 'server/src/routes/dispatch/', 'server/src/utils/websocket.ts'],
    });
  } else if (q.includes('map') || q.includes('gps') || q.includes('location') || q.includes('geo')) {
    steps.push({
      phase: 'INTEL RETRIEVAL — GEOSPATIAL SYSTEM',
      icon: '🗺️',
      detail: 'Accessing geospatial architecture knowledge base...\n' +
        'Key components identified:\n' +
        '  ├─ Google Maps JS API (dark styled) — primary map provider\n' +
        '  ├─ CartoDB dark_matter tiles — offline fallback layer\n' +
        '  ├─ GPS tracking via WebSocket (real-time unit positions)\n' +
        '  └─ Service Worker tile caching: Z7-Z15 coverage for SLC metro',
      files: ['client/src/pages/map/MapPage.tsx', 'client/src/utils/googleMapsLoader.ts', 'server/src/utils/geocode.ts'],
    });
  } else if (q.includes('database') || q.includes('schema') || q.includes('table') || q.includes('sql') || q.includes('data')) {
    steps.push({
      phase: 'INTEL RETRIEVAL — DATABASE ARCHITECTURE',
      icon: '🗄️',
      detail: 'Accessing database schema knowledge base...\n' +
        'Engine: SQLite via better-sqlite3 (WAL mode)\n' +
        'Key tables identified:\n' +
        '  ├─ users, sessions (auth layer)\n' +
        '  ├─ calls, units, bolos (dispatch layer)\n' +
        '  ├─ incidents, warrants, citations (records layer)\n' +
        '  ├─ persons, vehicles, properties (entity layer)\n' +
        '  └─ ai_dev_chat, ai_activity_log (intelligence layer)',
      files: ['server/src/models/database.ts', 'server/data/rmpg-flex.db'],
    });
  } else if (q.includes('api') || q.includes('endpoint') || q.includes('route') || q.includes('backend')) {
    steps.push({
      phase: 'INTEL RETRIEVAL — API ARCHITECTURE',
      icon: '⚡',
      detail: 'Accessing API route architecture...\n' +
        'Pattern: Express Router → authenticateToken → requireRole → handler\n' +
        'Route domains identified:\n' +
        '  ├─ /api/dispatch/ — call & unit management\n' +
        '  ├─ /api/records/ — persons, vehicles, properties\n' +
        '  ├─ /api/incidents/ — incident reports & narratives\n' +
        '  ├─ /api/ai/ — AI operations & admin config\n' +
        '  └─ /api/admin/ — system config & user management',
      files: ['server/src/routes/', 'server/src/middleware/auth.ts'],
    });
  } else if (q.includes('bug') || q.includes('error') || q.includes('fix') || q.includes('broken') || q.includes('fail')) {
    steps.push({
      phase: 'DIAGNOSTIC SCAN',
      icon: '🔧',
      detail: 'Initiating diagnostic analysis...\n' +
        'Checking common failure vectors:\n' +
        '  ├─ ESM compatibility (require → import)\n' +
        '  ├─ Database query errors (column names, table references)\n' +
        '  ├─ WebSocket connection state (auth, reconnect logic)\n' +
        '  ├─ API response handling (null checks, error boundaries)\n' +
        '  └─ Memory/performance (large page components, stale closures)',
    });
  } else if (q.includes('ui') || q.includes('design') || q.includes('component') || q.includes('page') || q.includes('frontend')) {
    steps.push({
      phase: 'INTEL RETRIEVAL — UI/DESIGN SYSTEM',
      icon: '🎨',
      detail: 'Accessing design system knowledge base...\n' +
        'Theme: Spillman Flex / Motorola Solutions CAD aesthetic\n' +
        '  ├─ Surfaces: #0a0a0a (base), #141414 (raised), #050505 (sunken)\n' +
        '  ├─ Brand: blue #888888, gold #d4a017\n' +
        '  ├─ Border-radius: 2px (flat retro console)\n' +
        '  ├─ Font: system sans-serif, monospace for data\n' +
        '  └─ Layout: toolbar + dropdown menus (no sidebar)',
      files: ['client/src/components/Layout.tsx', 'client/src/index.css', 'client/tailwind.config.js'],
    });
  } else if (q.includes('auth') || q.includes('login') || q.includes('security') || q.includes('jwt') || q.includes('password')) {
    steps.push({
      phase: 'INTEL RETRIEVAL — SECURITY ARCHITECTURE',
      icon: '🔒',
      detail: 'Accessing security architecture knowledge base...\n' +
        'Authentication stack:\n' +
        '  ├─ JWT (access + refresh tokens)\n' +
        '  ├─ WebAuthn / FIDO2 (YubiKey hardware keys)\n' +
        '  ├─ TOTP 2FA (AES-256-GCM encrypted secrets)\n' +
        '  ├─ Role-based access: admin, manager, supervisor, officer, dispatcher\n' +
        '  └─ Account lockout + password policy enforcement',
      files: ['server/src/middleware/auth.ts', 'server/src/routes/auth.ts'],
    });
  } else if (q.includes('improve') || q.includes('suggest') || q.includes('optimize') || q.includes('enhance') || q.includes('better')) {
    steps.push({
      phase: 'OPTIMIZATION ANALYSIS',
      icon: '📊',
      detail: 'Running optimization assessment...\n' +
        'Evaluation criteria:\n' +
        '  ├─ Performance: bundle size, render count, query efficiency\n' +
        '  ├─ UX: loading states, error handling, responsiveness\n' +
        '  ├─ Security: input validation, auth coverage, OWASP compliance\n' +
        '  ├─ Maintainability: code splitting, patterns, tech debt\n' +
        '  └─ Reliability: error boundaries, retries, graceful degradation',
    });
  } else {
    steps.push({
      phase: 'KNOWLEDGE BASE SEARCH',
      icon: '🧠',
      detail: 'Scanning full RMPG Flex knowledge base...\n' +
        'Cross-referencing query against:\n' +
        '  ├─ System architecture documentation\n' +
        '  ├─ Code patterns and conventions\n' +
        '  ├─ Database schema and relationships\n' +
        '  └─ Operational procedures and workflows',
    });
  }

  // Phase 3: Planning (always)
  steps.push({
    phase: 'RESPONSE PLANNING',
    icon: '📋',
    detail: 'Structuring response strategy...\n' +
      'Output format: detailed analysis with actionable specifics\n' +
      'Including: file paths, code examples, architecture context',
  });

  // Phase 4: Generation (always)
  steps.push({
    phase: 'GENERATING RESPONSE',
    icon: '✍️',
    detail: 'Composing answer from analyzed context...',
  });

  return steps;
}

export default function AIDevChatPanel() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSession, setActiveSession] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [thinkingText, setThinkingText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [fileContext, setFileContext] = useState('');
  const [showFileInput, setShowFileInput] = useState(false);
  const [aiStatus, setAiStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [aiModel, setAiModel] = useState<string>('');
  const [elapsedSec, setElapsedSec] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check AI connection on mount
  useEffect(() => {
    (async () => {
      try {
        const status = await apiFetch<{ provider: string; available: boolean; model: string; providers: any[] }>('/ai/status');
        const ollamaProvider = status.providers?.find((p: any) => p.name === 'ollama');
        setAiStatus(ollamaProvider?.available ? 'online' : 'offline');
        setAiModel(ollamaProvider?.model || status.model || 'unknown');
      } catch {
        setAiStatus('offline');
      }
    })();
  }, []);

  // Elapsed time counter while streaming
  useEffect(() => {
    if (isStreaming) {
      setElapsedSec(0);
      timerRef.current = setInterval(() => setElapsedSec(s => s + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isStreaming]);

  // Generate session ID
  const newSessionId = () => {
    const arr = new Uint8Array(6);
    crypto.getRandomValues(arr);
    return `dev-${Date.now()}-${Array.from(arr, b => b.toString(16).padStart(2, '0')).join('')}`;
  };

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
    setThinkingText('');
    setIsThinking(true);

    // Generate rich contextual thinking steps
    const thinkSteps = generateThinkingSteps(text);
    let thinkIdx = 0;
    let charIdx = 0;
    let currentStepText = '';
    const thinkInterval = setInterval(() => {
      if (thinkIdx >= thinkSteps.length) return;
      const step = thinkSteps[thinkIdx];
      const fullStepText = `${step.icon} ── ${step.phase} ──────────────\n${step.detail}${step.files ? '\n📁 ' + step.files.join(', ') : ''}`;

      if (charIdx < fullStepText.length) {
        // Type out characters for a typewriter effect
        const charsPerTick = 3;
        currentStepText = fullStepText.slice(0, charIdx + charsPerTick);
        charIdx += charsPerTick;
        setThinkingText(prev => {
          const lines = prev.split('\n\n');
          if (lines.length > thinkIdx + 1) lines.pop(); // remove in-progress step
          if (thinkIdx > 0 && lines.length <= thinkIdx) lines.push(currentStepText);
          else if (thinkIdx === 0) return currentStepText;
          else { lines[thinkIdx] = currentStepText; }
          return lines.join('\n\n');
        });
      } else {
        // Step complete, move to next
        thinkIdx++;
        charIdx = 0;
        currentStepText = '';
      }
    }, 50); // Fast typewriter — 50ms per tick, 3 chars each = ~60 chars/sec

    try {
      // Get auth token
      const token = localStorage.getItem('rmpg_token');

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
            if (parsed.thinking_token) {
              // Stream AI's internal reasoning as visible text
              setIsThinking(true);
              setThinkingText(prev => prev + parsed.thinking_token);
            } else if (parsed.thinking_done) {
              // Thinking phase complete, response coming next
              setIsThinking(false);
            } else if (parsed.thinking) {
              // Legacy: generic thinking signal
              setIsThinking(true);
            } else if (parsed.token) {
              clearInterval(thinkInterval); // Stop simulated thinking
              setIsThinking(false);
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
      clearInterval(thinkInterval);
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err?.message || 'Connection failed'}` }]);
    } finally {
      clearInterval(thinkInterval);
      setIsStreaming(false);
      setIsThinking(false);
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
              <div className="text-[10px] text-gray-500 bg-[#050505] border border-[#222222] border-b-0 rounded-t px-2 py-0.5 font-mono">
                {lang}
              </div>
            )}
            <pre
              className={`bg-[#050505] border border-[#222222] text-green-400 font-mono text-xs p-3 overflow-x-auto ${
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
                <code key={j} className="bg-[#050505] text-amber-400 px-1 py-0.5 rounded text-xs font-mono">
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
    <>
    <style>{`
      @keyframes shimmer { 0% { transform: translateX(-200%); } 100% { transform: translateX(400%); } }
    `}</style>
    <div className="flex h-[calc(100dvh-280px)] min-h-[500px] bg-[#050505] rounded border border-[#222222] overflow-hidden">
      {/* Session Sidebar */}
      <div className="w-60 flex-shrink-0 bg-[#050505] border-r border-[#222222] flex flex-col">
        <div className="p-3 border-b border-[#222222]">
          <button
            onClick={createNewSession}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-[#888888] hover:bg-[#666666] text-white text-xs font-medium rounded transition-colors"
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
              className={`group flex items-start gap-2 px-3 py-2 cursor-pointer border-b border-[#222222]/50 transition-colors ${
                activeSession === s.session_id ? 'bg-[#222222]/50' : 'hover:bg-[#0a0a0a]'
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
        {/* AI Status Bar */}
        <div className="flex items-center justify-between px-4 py-1.5 border-b border-[#222222] bg-[#0a0a0a]">
          <div className="flex items-center gap-2">
            {aiStatus === 'checking' && <Loader2 className="w-3 h-3 text-yellow-500 animate-spin" />}
            {aiStatus === 'online' && <Circle className="w-2.5 h-2.5 text-green-500 fill-green-500" />}
            {aiStatus === 'offline' && <Circle className="w-2.5 h-2.5 text-red-500 fill-red-500" />}
            <span className="text-[10px] text-gray-400">
              {aiStatus === 'checking' ? 'Connecting...' : aiStatus === 'online' ? `AI Online — ${aiModel}` : 'AI Offline'}
            </span>
          </div>
          {isStreaming && (
            <div className="flex items-center gap-2">
              <div className="flex gap-0.5">
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <span className="text-[10px] text-gray-400 font-mono">{elapsedSec}s</span>
            </div>
          )}
        </div>

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
                    className="text-left text-[11px] text-gray-500 hover:text-gray-300 bg-[#0a0a0a] hover:bg-[#141414] border border-[#222222] rounded p-2 transition-colors"
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
                <div className="w-7 h-7 rounded bg-[#888888] flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 text-white" />
                </div>
              )}
              <div
                className={`max-w-[80%] ${
                  msg.role === 'user'
                    ? 'bg-[#888888] text-white rounded-sm px-3 py-2'
                    : 'bg-[#141414] text-gray-200 rounded-sm px-3 py-2 border border-[#222222]'
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
                <div className="w-7 h-7 rounded bg-[#141414] flex items-center justify-center flex-shrink-0">
                  <User className="w-4 h-4 text-gray-300" />
                </div>
              )}
            </div>
          ))}

          {/* Streaming message */}
          {isStreaming && (
            <div className="flex gap-3 justify-start">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-gray-600 to-gray-800 flex items-center justify-center flex-shrink-0 shadow-lg shadow-gray-500/20">
                <Bot className={`w-4.5 h-4.5 text-white ${!streamingContent ? 'animate-pulse' : ''}`} />
              </div>
              <div className="max-w-[80%]">
                {/* Thinking phase — rich visual reasoning display (stays visible during response) */}
                {(isThinking || thinkingText) && (
                  <div className={`bg-gradient-to-b from-[#141414] to-[#0a0a0a] rounded-sm border overflow-hidden mb-2 min-w-[340px] transition-all duration-300 ${
                    streamingContent ? 'border-amber-500/10 max-h-28' : 'border-amber-500/20'
                  }`}>
                    {/* Animated header bar */}
                    <div className="relative">
                      <div className="h-1 bg-[#050505] overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-amber-600 via-amber-400 to-amber-600"
                          style={{ width: '30%', animation: 'shimmer 1.2s infinite linear' }} />
                      </div>
                      <div className="flex items-center justify-between px-3 py-1.5 bg-amber-500/5 border-b border-amber-500/10">
                        <div className="flex items-center gap-2">
                          <div className="relative">
                            <div className="w-5 h-5 rounded bg-amber-500/20 flex items-center justify-center">
                              <Bot className="w-3 h-3 text-amber-400" />
                            </div>
                            {isThinking && <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-amber-400 rounded-full animate-ping opacity-75" />}
                            {isThinking && <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-amber-400 rounded-full" />}
                          </div>
                          <span className="text-[10px] text-amber-400 font-bold tracking-[0.15em] uppercase">
                            {streamingContent ? 'REASONING (COMPLETE)' : isThinking ? 'AI REASONING' : 'ANALYSIS COMPLETE'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {isThinking && (
                            <div className="flex gap-0.5">
                              {[0, 1, 2, 3, 4].map(i => (
                                <div key={i} className="w-1 bg-amber-400/60 rounded-full animate-pulse"
                                  style={{ height: `${6 + Math.sin(Date.now() / 300 + i) * 4}px`, animationDelay: `${i * 100}ms` }} />
                              ))}
                            </div>
                          )}
                          <span className="text-[10px] text-gray-600 font-mono tabular-nums">{elapsedSec}s</span>
                        </div>
                      </div>
                    </div>
                    {/* Thinking content with terminal-style display */}
                    <div className="p-2">
                      <div className={`text-[11px] text-gray-300 whitespace-pre-wrap leading-[1.6] overflow-y-auto font-mono bg-[#050505] rounded p-3 border border-[#222222] shadow-inner transition-all duration-300 ${
                        streamingContent ? 'max-h-16 opacity-70' : 'max-h-48'
                      }`}
                        style={{ scrollBehavior: 'smooth' }}
                        ref={el => { if (el && isThinking) el.scrollTop = el.scrollHeight; }}>
                        {thinkingText ? thinkingText.split('\n').map((line, i) => {
                          // Color-code different line types
                          if (line.match(/^[🔍📡🗺️🗄️⚡🔧🎨🔒📊🧠📋✍️]/)) {
                            return <div key={i} className="text-amber-400 font-bold mt-2 first:mt-0">{line}</div>;
                          }
                          if (line.startsWith('  ├─') || line.startsWith('  └─')) {
                            return <div key={i} className="text-cyan-400/80">{line}</div>;
                          }
                          if (line.startsWith('📁')) {
                            return <div key={i} className="text-gray-400/70 text-[10px] mt-0.5">{line}</div>;
                          }
                          if (line.match(/^(Tokens|Intent|Engine|Pattern|Theme|Output|Including|Evaluation|Authentication|Checking)/)) {
                            return <div key={i} className="text-gray-400">{line}</div>;
                          }
                          return <div key={i} className="text-gray-400">{line}</div>;
                        }) : (
                          <span className="text-gray-600">Initializing analysis...</span>
                        )}
                        {isThinking && <span className="inline-block w-1.5 h-3.5 bg-amber-400 animate-pulse ml-0.5 align-text-bottom" />}
                      </div>
                    </div>
                  </div>
                )}

                {/* Response content — streams alongside reasoning */}
                {streamingContent ? (
                  <div className="bg-[#141414] text-gray-200 rounded-sm px-3 py-2 border border-gray-500/30">
                    <div className="flex items-center gap-2 mb-1.5 pb-1.5 border-b border-[#222222]">
                      <div className="w-2 h-2 bg-gray-500 rounded-full animate-pulse" />
                      <span className="text-[10px] text-gray-400 font-bold tracking-[0.1em] uppercase">RESPONSE</span>
                      <span className="text-[10px] text-gray-600 font-mono ml-auto">{elapsedSec}s</span>
                    </div>
                    <div className="text-sm whitespace-pre-wrap leading-relaxed">
                      {renderContent(streamingContent)}
                      <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse ml-0.5" />
                    </div>
                  </div>
                ) : !thinkingText && (
                  <div className="bg-[#141414] rounded-sm border border-gray-500/30 overflow-hidden">
                    <div className="h-0.5 bg-[#050505] overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-transparent via-gray-500 to-transparent"
                        style={{ width: '40%', animation: 'shimmer 1.5s infinite linear' }} />
                    </div>
                    <div className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                        <span className="text-sm text-gray-400">
                          {elapsedSec < 3 ? 'Connecting to AI model...' :
                           elapsedSec < 10 ? 'Waiting for response...' :
                           'Processing — this may take a moment...'}
                        </span>
                        <span className="text-[10px] text-gray-600 font-mono ml-auto">{elapsedSec}s</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* File context bar */}
        {showFileInput && (
          <div className="px-4 py-2 border-t border-[#222222] bg-[#0a0a0a] flex items-center gap-2">
            <FileCode className="w-4 h-4 text-gray-500" />
            <input
              type="text"
              value={fileContext}
              onChange={e => setFileContext(e.target.value)}
              placeholder="Enter file path for context (e.g., client/src/pages/AdminPage.tsx)"
              className="flex-1 bg-[#050505] border border-[#222222] text-white text-xs px-2 py-1.5 rounded focus:outline-none focus:border-gray-500"
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
        <div className="p-3 border-t border-[#222222] bg-[#0a0a0a]">
          <div className="flex items-end gap-2">
            <button
              onClick={() => setShowFileInput(!showFileInput)}
              className={`p-2 rounded transition-colors ${
                showFileInput || fileContext ? 'text-gray-400 bg-gray-500/10' : 'text-gray-500 hover:text-gray-300'
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
              className="flex-1 bg-[#050505] border border-[#222222] text-white text-sm px-3 py-2 rounded resize-none focus:outline-none focus:border-gray-500 max-h-32"
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
              className="p-2 bg-gray-600 hover:bg-gray-700 disabled:bg-[#141414] disabled:text-gray-500 text-white rounded transition-colors"
            >
              {isStreaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
          {fileContext && (
            <p className="text-[10px] text-gray-400 mt-1 ml-10">Context: {fileContext}</p>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
