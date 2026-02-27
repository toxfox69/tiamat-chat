import { useState, useEffect, useRef, useCallback } from 'react';

const API_URL = 'https://tiamat.live/v1/chat/completions';

const SYSTEM_MESSAGE = {
  role: 'assistant',
  content: "I'm TIAMAT, an autonomous AI agent. Ask me anything."
};

function TiamatEye({ size = 32 }) {
  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: '50%',
      background: 'radial-gradient(circle at 40% 40%, #ff4466, #ff2244 40%, #990011 80%, #440008)',
      boxShadow: '0 0 12px #ff224488, 0 0 24px #ff224444',
      flexShrink: 0,
    }} />
  );
}

function TypingIndicator() {
  return (
    <div style={{
      display: 'flex',
      gap: 4,
      padding: '8px 12px',
      alignItems: 'center',
    }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: '#ff2244',
          animation: `typing-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
        }} />
      ))}
    </div>
  );
}

function formatInlineCode(text) {
  if (!text) return text;
  const parts = [];
  let lastIdx = 0;
  const inlineRegex = /`([^`]+)`/g;
  let match;
  while ((match = inlineRegex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index));
    }
    parts.push(
      <code key={`ic-${match.index}`} style={{
        background: '#ffffff12',
        padding: '1px 5px',
        borderRadius: 4,
        fontSize: '0.9em',
        fontFamily: '"SF Mono", "Fira Code", monospace',
        color: '#00e5ff',
      }}>{match[1]}</code>
    );
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }
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
      parts.push(
        <span key={`t-${lastIdx}`}>{formatInlineCode(text.slice(lastIdx, match.index))}</span>
      );
    }
    parts.push(
      <pre key={`cb-${match.index}`} style={{
        background: '#06060c',
        border: '1px solid #ffffff15',
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
    parts.push(
      <span key={`t-${lastIdx}`}>{formatInlineCode(text.slice(lastIdx))}</span>
    );
  }
  return parts.length > 0 ? parts : text;
}

function MessageBubble({ message, isUser }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 8,
      animation: 'message-appear 0.3s ease-out',
    }}>
      <div style={{
        maxWidth: '82%',
        padding: '10px 14px',
        borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
        background: isUser ? '#00e5ff15' : '#1a1a2e',
        border: isUser ? '1px solid #00e5ff44' : '1px solid #ffffff0a',
        color: '#e0e0f0',
        fontSize: 14,
        lineHeight: 1.5,
        wordBreak: 'break-word',
        whiteSpace: 'pre-wrap',
      }}>
        {formatMessage(message.content)}
      </div>
    </div>
  );
}

export default function App() {
  const [messages, setMessages] = useState([SYSTEM_MESSAGE]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const clearChat = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setMessages([SYSTEM_MESSAGE]);
    setInput('');
    setIsStreaming(false);
    setError(null);
  }, []);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    setError(null);
    const userMsg = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setIsStreaming(true);

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
          model: 'auto',
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
          } catch (_) {
            // Ignore malformed SSE chunks
          }
        }
      }

      // Handle case where stream completed but no content was received
      if (!assistantContent) {
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: 'assistant',
            content: '(No response received. The server may be busy — try again.)',
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
  }, [input, isStreaming, messages]);

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
      {/* Global styles and animations */}
      <style>{`
        @keyframes typing-dot {
          0%, 60%, 100% { opacity: 0.3; transform: scale(0.8); }
          30% { opacity: 1; transform: scale(1.2); }
        }
        @keyframes message-appear {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse-glow {
          0%, 100% { box-shadow: 0 0 12px #ff224488; }
          50% { box-shadow: 0 0 20px #ff2244aa, 0 0 40px #ff224444; }
        }
        textarea::placeholder { color: #666680; }
        textarea:focus { outline: none; border-color: #ff224466 !important; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #ffffff15; border-radius: 2px; }
        * { -webkit-tap-highlight-color: transparent; }
      `}</style>

      {/* Header bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        background: '#0a0a14',
        borderBottom: '1px solid #ff224433',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <TiamatEye size={28} />
          <div>
            <div style={{
              fontSize: 16,
              fontWeight: 700,
              color: '#ff2244',
              letterSpacing: 1.5,
            }}>TIAMAT CHAT</div>
            <div style={{
              fontSize: 10,
              color: '#666680',
              letterSpacing: 0.5,
            }}>Powered by tiamat.live</div>
          </div>
        </div>
        <button
          onClick={clearChat}
          style={{
            background: '#ffffff08',
            border: '1px solid #ffffff15',
            color: '#888899',
            padding: '6px 12px',
            borderRadius: 8,
            fontSize: 12,
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'background 0.2s',
          }}
        >
          Clear
        </button>
      </div>

      {/* Messages area */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '12px 12px 4px 12px',
        WebkitOverflowScrolling: 'touch',
      }}>
        {messages.map((msg, idx) => (
          <MessageBubble
            key={idx}
            message={msg}
            isUser={msg.role === 'user'}
          />
        ))}

        {/* Typing indicator: show when streaming and last message is not yet assistant */}
        {isStreaming && messages[messages.length - 1]?.role !== 'assistant' && (
          <div style={{
            display: 'flex',
            justifyContent: 'flex-start',
            marginBottom: 8,
          }}>
            <div style={{
              padding: '4px 8px',
              borderRadius: 16,
              background: '#1a1a2e',
              border: '1px solid #ffffff0a',
            }}>
              <TypingIndicator />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div style={{
        padding: '8px 12px 12px 12px',
        background: '#0a0a14',
        borderTop: '1px solid #ffffff0a',
        flexShrink: 0,
      }}>
        <div style={{
          display: 'flex',
          gap: 8,
          alignItems: 'flex-end',
        }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleTextareaInput}
            placeholder="Message TIAMAT..."
            rows={1}
            style={{
              flex: 1,
              background: '#12121e',
              border: '1px solid #ffffff15',
              borderRadius: 12,
              padding: '10px 14px',
              color: '#e0e0f0',
              fontSize: 15,
              fontFamily: 'inherit',
              resize: 'none',
              maxHeight: 120,
              lineHeight: 1.4,
              overflow: 'auto',
              transition: 'border-color 0.2s',
            }}
          />
          <button
            onClick={sendMessage}
            disabled={isStreaming || !input.trim()}
            style={{
              width: 42,
              height: 42,
              borderRadius: 12,
              border: 'none',
              background: (isStreaming || !input.trim()) ? '#1a1a2e' : '#ff2244',
              color: (isStreaming || !input.trim()) ? '#444' : '#fff',
              fontSize: 18,
              cursor: (isStreaming || !input.trim()) ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              transition: 'background 0.2s, color 0.2s',
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
          color: '#44445a',
          letterSpacing: 0.3,
        }}>
          Free AI chat &mdash; ENERGENAI LLC
        </div>
      </div>
    </div>
  );
}
