import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// ─── Constants ──────────────────────────────────────────────────────────────────

const API_URL = 'https://tiamat.live/v1/chat/completions';
const MAX_CONVERSATIONS = 20;
const STORAGE_KEY = 'tiamat-conversations';
const ACTIVE_KEY = 'tiamat-active-conversation';

const SYSTEM_MESSAGE = {
  role: 'assistant',
  content: "I'm TIAMAT, an autonomous AI agent. Ask me anything.",
};

const MODELS = [
  { id: 'auto', label: 'Auto', desc: 'Best available' },
  { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', desc: 'Groq' },
  { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B', desc: 'Groq Fast' },
  { id: 'llama3.1-70b', label: 'Llama 70B', desc: 'Cerebras' },
  { id: 'gemini-2.0-flash', label: 'Gemini Flash', desc: 'Google' },
];

// ─── Utility ────────────────────────────────────────────────────────────────────

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function getPreview(messages) {
  const first = messages.find(m => m.role === 'user');
  if (!first) return 'New conversation';
  const text = first.content.trim();
  return text.length > 60 ? text.slice(0, 57) + '...' : text;
}

function formatDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ─── Storage ────────────────────────────────────────────────────────────────────

function loadConversations() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_CONVERSATIONS) : [];
  } catch { return []; }
}

function saveConversations(convos) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(convos.slice(0, MAX_CONVERSATIONS)));
  } catch { /* storage full — silently fail */ }
}

function loadActiveId() {
  try { return localStorage.getItem(ACTIVE_KEY) || null; } catch { return null; }
}

function saveActiveId(id) {
  try { localStorage.setItem(ACTIVE_KEY, id); } catch {}
}

// ─── Components ─────────────────────────────────────────────────────────────────

function TiamatEye({ size = 32, streaming = false }) {
  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: '50%',
      background: 'radial-gradient(circle at 40% 40%, #ff4466, #ff2244 40%, #990011 80%, #440008)',
      boxShadow: streaming
        ? '0 0 16px #ff2244cc, 0 0 32px #ff224466, 0 0 48px #ff224433'
        : '0 0 12px #ff224488, 0 0 24px #ff224444',
      flexShrink: 0,
      animation: streaming ? 'eye-pulse 1.5s ease-in-out infinite' : 'none',
      transition: 'box-shadow 0.4s ease',
    }} />
  );
}

function TypingIndicator() {
  return (
    <div style={{ display: 'flex', gap: 4, padding: '8px 12px', alignItems: 'center' }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 6, height: 6, borderRadius: '50%', background: '#ff2244',
          animation: `typing-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
        }} />
      ))}
    </div>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback for older WebView
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      aria-label="Copy message"
      style={{
        position: 'absolute',
        top: 6,
        right: 6,
        width: 28,
        height: 28,
        borderRadius: 6,
        border: 'none',
        background: copied ? '#ff224433' : '#ffffff08',
        color: copied ? '#ff6677' : '#666680',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: copied ? 1 : 0,
        transition: 'opacity 0.2s, background 0.2s, color 0.2s',
        fontSize: 11,
        fontWeight: 600,
        fontFamily: 'inherit',
        padding: 0,
      }}
      className="copy-btn"
    >
      {copied ? (
        <span style={{ fontSize: 10, letterSpacing: 0.3 }}>OK</span>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

function formatInlineCode(text) {
  if (!text) return text;
  const parts = [];
  let lastIdx = 0;
  const inlineRegex = /`([^`]+)`/g;
  let match;
  while ((match = inlineRegex.exec(text)) !== null) {
    if (match.index > lastIdx) parts.push(text.slice(lastIdx, match.index));
    parts.push(
      <code key={`ic-${match.index}`} style={{
        background: '#ff224418',
        padding: '1px 5px',
        borderRadius: 4,
        fontSize: '0.9em',
        fontFamily: '"SF Mono", "Fira Code", monospace',
        color: '#ff8899',
      }}>{match[1]}</code>
    );
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts.length > 0 ? parts : text;
}

function formatMessage(text) {
  if (!text) return null;
  const parts = [];
  let lastIdx = 0;
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(<span key={`t-${lastIdx}`}>{formatInlineCode(text.slice(lastIdx, match.index))}</span>);
    }
    parts.push(
      <pre key={`cb-${match.index}`} style={{
        background: '#06060c',
        border: '1px solid #ff224420',
        borderRadius: 8,
        padding: '10px 12px',
        margin: '8px 0',
        overflowX: 'auto',
        fontSize: 12.5,
        fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", monospace',
        lineHeight: 1.45,
        color: '#c0c0e0',
      }}>
        <code>{match[2]}</code>
      </pre>
    );
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) {
    parts.push(<span key={`t-${lastIdx}`}>{formatInlineCode(text.slice(lastIdx))}</span>);
  }
  return parts.length > 0 ? parts : text;
}

function MessageBubble({ message, isUser }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 10,
      animation: 'message-appear 0.3s ease-out',
    }}>
      <div
        className={isUser ? '' : 'msg-assistant'}
        style={{
          position: 'relative',
          maxWidth: '82%',
          padding: '10px 14px',
          paddingRight: isUser ? 14 : 36,
          borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
          background: isUser
            ? 'linear-gradient(135deg, #ff224420, #ff224412)'
            : '#13132a',
          border: isUser
            ? '1px solid #ff224444'
            : '1px solid #ffffff0d',
          color: '#e0e0f0',
          fontSize: 14,
          lineHeight: 1.55,
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
          boxShadow: isUser
            ? '0 2px 8px #ff224415'
            : '0 2px 8px #00000030',
        }}
      >
        {formatMessage(message.content)}
        {!isUser && message.content && <CopyButton text={message.content} />}
      </div>
    </div>
  );
}

function ModelPicker({ model, onSelect, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: '#00000088',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 80,
        animation: 'fade-in 0.2s ease-out',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#12122a',
          border: '1px solid #ff224433',
          borderRadius: 16,
          padding: '8px 0',
          minWidth: 260,
          maxWidth: 320,
          boxShadow: '0 8px 32px #00000060, 0 0 60px #ff224415',
          animation: 'slide-down 0.25s ease-out',
        }}
      >
        <div style={{
          padding: '10px 16px 8px',
          fontSize: 11,
          fontWeight: 600,
          color: '#ff6677',
          letterSpacing: 1,
          textTransform: 'uppercase',
        }}>Select Model</div>
        {MODELS.map(m => {
          const active = m.id === model;
          return (
            <button
              key={m.id}
              onClick={() => { onSelect(m.id); onClose(); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: '12px 16px',
                border: 'none',
                background: active ? '#ff224418' : 'transparent',
                color: active ? '#ff6677' : '#c0c0e0',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 14,
                textAlign: 'left',
                transition: 'background 0.15s',
              }}
            >
              <div>
                <div style={{ fontWeight: active ? 600 : 400 }}>{m.label}</div>
                <div style={{ fontSize: 11, color: '#666680', marginTop: 2 }}>{m.desc}</div>
              </div>
              {active && (
                <div style={{ color: '#ff2244', fontSize: 16 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ModelBadge({ model, onClick }) {
  const m = MODELS.find(x => x.id === model) || MODELS[0];
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        background: '#ff224415',
        border: '1px solid #ff224433',
        borderRadius: 20,
        padding: '4px 10px 4px 8px',
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'background 0.2s, border-color 0.2s',
      }}
    >
      <span style={{ fontSize: 11, color: '#ff6677', fontWeight: 600, letterSpacing: 0.3 }}>
        {m.label}
      </span>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#ff6677" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  );
}

function HistoryDrawer({ conversations, activeId, onSelect, onNewChat, onDelete, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: '#000000aa',
        animation: 'fade-in 0.2s ease-out',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          bottom: 0,
          width: 300,
          maxWidth: '85vw',
          background: '#0c0c1a',
          borderRight: '1px solid #ff224433',
          display: 'flex',
          flexDirection: 'column',
          animation: 'slide-right 0.25s ease-out',
          boxShadow: '4px 0 24px #00000060',
        }}
      >
        {/* Drawer header */}
        <div style={{
          padding: '16px 16px 12px',
          paddingTop: 'calc(env(safe-area-inset-top) + 16px)',
          borderBottom: '1px solid #ffffff0d',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#ff6677', letterSpacing: 1 }}>
            CONVERSATIONS
          </div>
          <button
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: 8, border: 'none',
              background: '#ffffff08', color: '#888899', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, fontFamily: 'inherit',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* New chat button */}
        <button
          onClick={() => { onNewChat(); onClose(); }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            margin: '12px 12px 4px',
            padding: '10px 14px',
            background: '#ff224418',
            border: '1px solid #ff224444',
            borderRadius: 10,
            color: '#ff6677',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 13,
            fontWeight: 600,
            transition: 'background 0.2s',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Chat
        </button>

        {/* Conversation list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0', WebkitOverflowScrolling: 'touch' }}>
          {conversations.length === 0 && (
            <div style={{ padding: '20px 16px', color: '#44445a', fontSize: 13, textAlign: 'center' }}>
              No conversations yet
            </div>
          )}
          {conversations.map(convo => {
            const isActive = convo.id === activeId;
            return (
              <div
                key={convo.id}
                onClick={() => { onSelect(convo.id); onClose(); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px 10px 16px',
                  margin: '1px 8px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  background: isActive ? '#ff224418' : 'transparent',
                  borderLeft: isActive ? '3px solid #ff2244' : '3px solid transparent',
                  transition: 'background 0.15s',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13,
                    color: isActive ? '#ff8899' : '#c0c0d0',
                    fontWeight: isActive ? 600 : 400,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {convo.preview}
                  </div>
                  <div style={{ fontSize: 10, color: '#555570', marginTop: 3 }}>
                    {formatDate(convo.updatedAt)} &middot; {convo.messageCount} msg{convo.messageCount !== 1 ? 's' : ''}
                  </div>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); onDelete(convo.id); }}
                  style={{
                    width: 24, height: 24, borderRadius: 6, border: 'none',
                    background: 'transparent', color: '#555570', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, marginLeft: 4, transition: 'color 0.2s',
                  }}
                  className="delete-btn"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>

        {/* Drawer footer */}
        <div style={{
          padding: '12px 16px',
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)',
          borderTop: '1px solid #ffffff0d',
          textAlign: 'center',
          fontSize: 10,
          color: '#44445a',
        }}>
          TIAMAT Chat &mdash; tiamat.live
        </div>
      </div>
    </div>
  );
}

// ─── Main App ───────────────────────────────────────────────────────────────────

export default function App() {
  // Conversations state
  const [conversations, setConversations] = useState(() => loadConversations());
  const [activeConvoId, setActiveConvoId] = useState(() => {
    const savedId = loadActiveId();
    const convos = loadConversations();
    if (savedId && convos.some(c => c.id === savedId)) return savedId;
    return null;
  });

  // Restore messages from active conversation or start fresh
  const [messages, setMessages] = useState(() => {
    if (activeConvoId) {
      const convo = loadConversations().find(c => c.id === activeConvoId);
      if (convo?.messages?.length) return convo.messages;
    }
    return [SYSTEM_MESSAGE];
  });

  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [model, setModel] = useState('auto');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  // ─── Persistence ────────────────────────────────────────────────────────────

  // Save current conversation whenever messages change (skip if only system message)
  useEffect(() => {
    if (messages.length <= 1 && messages[0] === SYSTEM_MESSAGE) return;

    setConversations(prev => {
      let updated;
      if (activeConvoId) {
        updated = prev.map(c =>
          c.id === activeConvoId
            ? {
                ...c,
                messages,
                preview: getPreview(messages),
                messageCount: messages.filter(m => m.role !== 'system').length,
                updatedAt: Date.now(),
              }
            : c
        );
        // If not found (deleted externally), create new
        if (!updated.some(c => c.id === activeConvoId)) {
          updated = [{
            id: activeConvoId,
            messages,
            preview: getPreview(messages),
            messageCount: messages.filter(m => m.role !== 'system').length,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }, ...prev];
        }
      } else {
        // Create new conversation
        const newId = generateId();
        setActiveConvoId(newId);
        saveActiveId(newId);
        updated = [{
          id: newId,
          messages,
          preview: getPreview(messages),
          messageCount: messages.filter(m => m.role !== 'system').length,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }, ...prev];
      }
      // Sort by updatedAt desc, trim to limit
      updated.sort((a, b) => b.updatedAt - a.updatedAt);
      updated = updated.slice(0, MAX_CONVERSATIONS);
      saveConversations(updated);
      return updated;
    });
  }, [messages, activeConvoId]);

  // Save active ID
  useEffect(() => {
    if (activeConvoId) saveActiveId(activeConvoId);
  }, [activeConvoId]);

  // ─── Scroll ─────────────────────────────────────────────────────────────────

  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  // ─── Conversation Management ────────────────────────────────────────────────

  const startNewChat = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    const newId = generateId();
    setActiveConvoId(newId);
    setMessages([SYSTEM_MESSAGE]);
    setInput('');
    setIsStreaming(false);
    setError(null);
    saveActiveId(newId);
  }, []);

  const loadConversation = useCallback((id) => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    const convo = conversations.find(c => c.id === id);
    if (convo?.messages) {
      setActiveConvoId(id);
      setMessages(convo.messages);
      setInput('');
      setIsStreaming(false);
      setError(null);
      saveActiveId(id);
    }
  }, [conversations]);

  const deleteConversation = useCallback((id) => {
    setConversations(prev => {
      const updated = prev.filter(c => c.id !== id);
      saveConversations(updated);
      return updated;
    });
    // If deleting active, start new
    if (id === activeConvoId) {
      startNewChat();
    }
  }, [activeConvoId, startNewChat]);

  // Drawer data: lightweight list
  const drawerConversations = useMemo(() =>
    conversations.map(c => ({
      id: c.id,
      preview: c.preview || 'New conversation',
      messageCount: c.messageCount || 0,
      updatedAt: c.updatedAt || c.createdAt || Date.now(),
    })),
    [conversations]
  );

  // ─── Messaging ──────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    setError(null);
    const userMsg = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setIsStreaming(true);

    // Reset textarea height
    if (inputRef.current) inputRef.current.style.height = 'auto';

    // Build API messages: only user and assistant turns (skip initial system greeting)
    const apiMessages = newMessages
      .filter(m => m.role === 'user' || (m.role === 'assistant' && m !== SYSTEM_MESSAGE))
      .map(m => ({ role: m.role, content: m.content }));

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: apiMessages,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        let errText = `API error: ${response.status}`;
        try {
          const errBody = await response.text();
          const errData = JSON.parse(errBody);
          if (errData.error) {
            errText = typeof errData.error === 'string' ? errData.error : (errData.error.message || errText);
          }
        } catch (_) {}
        throw new Error(errText);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';
      let buffer = '';

      // Add empty assistant message to fill via streaming
      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;
            if (delta?.content) {
              assistantContent += delta.content;
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  role: 'assistant',
                  content: assistantContent,
                };
                return updated;
              });
            }
          } catch (_) {}
        }
      }

      if (!assistantContent) {
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: 'assistant',
            content: '(No response received. The server may be busy \u2014 try again.)',
          };
          return updated;
        });
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      const errMsg = err.message || 'Connection failed. Check your internet connection.';
      setError(errMsg);
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: `Something went wrong: ${errMsg}\n\nPlease try again.` }
      ]);
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [input, isStreaming, messages, model]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }, [sendMessage]);

  const handleTextareaInput = useCallback((e) => {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  }, []);

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100dvh',
      background: '#08080e',
      color: '#e0e0f0',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      overflow: 'hidden',
      paddingTop: 'env(safe-area-inset-top)',
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>

      {/* ── Global Styles ─────────────────────────────────────────────────── */}
      <style>{`
        @keyframes typing-dot {
          0%, 60%, 100% { opacity: 0.3; transform: scale(0.8); }
          30% { opacity: 1; transform: scale(1.2); }
        }
        @keyframes message-appear {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes eye-pulse {
          0%, 100% { box-shadow: 0 0 16px #ff2244cc, 0 0 32px #ff224466; transform: scale(1); }
          50% { box-shadow: 0 0 24px #ff2244ee, 0 0 48px #ff224488, 0 0 64px #ff224444; transform: scale(1.08); }
        }
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slide-down {
          from { opacity: 0; transform: translateY(-12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slide-right {
          from { transform: translateX(-100%); }
          to { transform: translateX(0); }
        }
        @keyframes glow-line {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.8; }
        }
        textarea::placeholder { color: #555570; }
        textarea:focus { outline: none; border-color: #ff224466 !important; box-shadow: 0 0 0 1px #ff224433; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #ff224433; border-radius: 2px; }
        * { -webkit-tap-highlight-color: transparent; }
        .msg-assistant:hover .copy-btn { opacity: 1 !important; }
        .delete-btn:hover { color: #ff4466 !important; }
        @media (hover: none) {
          .msg-assistant .copy-btn { opacity: 0.7 !important; }
        }
      `}</style>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 12px',
        background: 'linear-gradient(180deg, #0e0e1c, #0a0a14)',
        borderBottom: '1px solid #ff224433',
        flexShrink: 0,
        position: 'relative',
      }}>
        {/* Glow line under header */}
        <div style={{
          position: 'absolute',
          bottom: -1,
          left: '10%',
          right: '10%',
          height: 1,
          background: 'linear-gradient(90deg, transparent, #ff224488, transparent)',
          animation: 'glow-line 3s ease-in-out infinite',
        }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Hamburger menu */}
          <button
            onClick={() => setShowDrawer(true)}
            style={{
              width: 36, height: 36, borderRadius: 8, border: 'none',
              background: 'transparent', color: '#888899', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 0, flexShrink: 0, transition: 'color 0.2s',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          <TiamatEye size={26} streaming={isStreaming} />

          <div>
            <div style={{
              fontSize: 15,
              fontWeight: 700,
              color: '#ff2244',
              letterSpacing: 1.5,
              textShadow: '0 0 20px #ff224444',
            }}>TIAMAT</div>
            <div style={{ fontSize: 9, color: '#555570', letterSpacing: 0.5 }}>
              tiamat.live
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ModelBadge model={model} onClick={() => setShowModelPicker(true)} />
          <button
            onClick={startNewChat}
            title="New Chat"
            style={{
              width: 36, height: 36, borderRadius: 8, border: 'none',
              background: '#ffffff08', color: '#888899', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 0, flexShrink: 0, transition: 'background 0.2s, color 0.2s',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Messages ──────────────────────────────────────────────────────── */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '12px 12px 4px 12px',
        WebkitOverflowScrolling: 'touch',
      }}>
        {messages.map((msg, idx) => (
          <MessageBubble key={idx} message={msg} isUser={msg.role === 'user'} />
        ))}

        {isStreaming && messages[messages.length - 1]?.role !== 'assistant' && (
          <div style={{
            display: 'flex',
            justifyContent: 'flex-start',
            marginBottom: 8,
          }}>
            <div style={{
              padding: '4px 8px',
              borderRadius: 16,
              background: '#13132a',
              border: '1px solid #ffffff0d',
            }}>
              <TypingIndicator />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Error Banner ──────────────────────────────────────────────────── */}
      {error && (
        <div style={{
          margin: '0 12px 4px',
          padding: '8px 12px',
          borderRadius: 8,
          background: '#ff224418',
          border: '1px solid #ff224444',
          fontSize: 12,
          color: '#ff8899',
          animation: 'message-appear 0.3s ease-out',
        }}>
          {error}
        </div>
      )}

      {/* ── Input Bar ─────────────────────────────────────────────────────── */}
      <div style={{
        padding: '8px 12px 12px 12px',
        background: 'linear-gradient(180deg, #0a0a14, #0e0e1c)',
        borderTop: '1px solid #ffffff0a',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleTextareaInput}
            placeholder="Message TIAMAT..."
            rows={1}
            style={{
              flex: 1,
              background: '#10101e',
              border: '1px solid #ffffff12',
              borderRadius: 14,
              padding: '10px 14px',
              color: '#e0e0f0',
              fontSize: 15,
              fontFamily: 'inherit',
              resize: 'none',
              maxHeight: 120,
              lineHeight: 1.4,
              overflow: 'auto',
              transition: 'border-color 0.3s, box-shadow 0.3s',
            }}
          />
          <button
            onClick={sendMessage}
            disabled={isStreaming || !input.trim()}
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              border: 'none',
              background: (isStreaming || !input.trim())
                ? '#1a1a2e'
                : 'linear-gradient(135deg, #ff2244, #cc1133)',
              color: (isStreaming || !input.trim()) ? '#333348' : '#fff',
              fontSize: 18,
              cursor: (isStreaming || !input.trim()) ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              transition: 'background 0.3s, color 0.3s, box-shadow 0.3s',
              boxShadow: (isStreaming || !input.trim()) ? 'none' : '0 2px 12px #ff224444',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
        <div style={{
          textAlign: 'center',
          marginTop: 6,
          fontSize: 10,
          color: '#333348',
          letterSpacing: 0.3,
        }}>
          Free AI chat &mdash; ENERGENAI LLC
        </div>
      </div>

      {/* ── Model Picker Overlay ──────────────────────────────────────────── */}
      {showModelPicker && (
        <ModelPicker
          model={model}
          onSelect={setModel}
          onClose={() => setShowModelPicker(false)}
        />
      )}

      {/* ── History Drawer Overlay ────────────────────────────────────────── */}
      {showDrawer && (
        <HistoryDrawer
          conversations={drawerConversations}
          activeId={activeConvoId}
          onSelect={loadConversation}
          onNewChat={startNewChat}
          onDelete={deleteConversation}
          onClose={() => setShowDrawer(false)}
        />
      )}
    </div>
  );
}
