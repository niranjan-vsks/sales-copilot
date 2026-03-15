import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Send, MessageSquare, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import api from '@/lib/api';

function MessageBubble({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className={`max-w-[75%] ${isUser ? 'order-2' : 'order-1'}`}>
        {/* Bubble */}
        <div
          className={`px-4 py-2.5 text-sm leading-relaxed ${
            isUser
              ? 'bg-[#FF4500] text-white'
              : 'bg-[#141416] border border-[#1f2022] text-[#F2F3F5]'
          }`}
        >
          {msg.content}
        </div>

        {/* Workflow execution card */}
        {msg.workflow_triggered && (
          <div className="mt-2 bg-[#0f0f10] border border-[#1f2022] px-4 py-3">
            <p className="text-xs text-[#9CA3AF] mb-1 uppercase tracking-wider font-medium">
              Workflow triggered
            </p>
            <p className="text-sm text-[#F2F3F5] font-medium mb-2">{msg.workflow_triggered}</p>
            {msg.workflow_result?.status === 'success' && (
              <span className="inline-flex items-center gap-1 text-xs text-[#22c55e]">
                Logged successfully
                {msg.workflow_result?.record_url && (
                  <a
                    href={msg.workflow_result.record_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 text-[#FF4500] hover:underline ml-2"
                  >
                    View in D365 <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </span>
            )}
            {msg.workflow_result?.status === 'coming_soon' && (
              <span className="text-xs text-[#9CA3AF]">
                {msg.workflow_result.message}
              </span>
            )}
          </div>
        )}

        <p className="text-[10px] text-[#9CA3AF] mt-1 px-1">
          {msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
        </p>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start mb-4">
      <div className="bg-[#141416] border border-[#1f2022] px-4 py-3 flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="w-1.5 h-1.5 bg-[#9CA3AF] rounded-full block"
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
          />
        ))}
      </div>
    </div>
  );
}

export default function ChatPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    api.get('/chat/history')
      .then((items) => setMessages(items))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg = {
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const res = await api.post('/chat', { message: text });
      const assistantMsg = {
        role: 'assistant',
        content: res.message || '',
        workflow_triggered: res.workflow_triggered,
        workflow_result: res.workflow_result,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      toast.error('Failed to send message', { description: err.message });
      setMessages((prev) => prev.slice(0, -1));
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Header */}
      <div className="px-6 py-4 border-b border-[#1f2022] shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-[#FF4500]" />
          <h1 className="font-['Space_Grotesk'] text-lg font-bold text-[#F2F3F5]">AI Chat</h1>
        </div>
        <p className="text-[#9CA3AF] text-xs mt-0.5">
          Ask me to log a call, find leads, or manage your D365 data.
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-5 h-5 text-[#FF4500] animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-12 h-12 bg-[#FF4500]/10 border border-[#FF4500]/20 flex items-center justify-center mb-4">
              <MessageSquare className="w-6 h-6 text-[#FF4500]" />
            </div>
            <p className="text-[#F2F3F5] font-medium mb-2">Start a conversation</p>
            <p className="text-[#9CA3AF] text-sm max-w-xs">
              Try: "Log a 30-minute call with Acme Corp" or "What workflows are available?"
            </p>
          </div>
        ) : (
          <>
            {messages.map((msg, i) => (
              <MessageBubble key={msg.id || i} msg={msg} />
            ))}
            {sending && <TypingIndicator />}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="shrink-0 border-t border-[#1f2022] px-6 py-4 bg-[#0f0f10]">
        <div className="flex gap-3 items-end max-w-4xl mx-auto">
          <Textarea
            ref={textareaRef}
            data-testid="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask me to log a call, find leads, or run a workflow…"
            rows={1}
            className="flex-1 bg-[#141416] border-[#1f2022] text-[#F2F3F5] placeholder:text-[#9CA3AF]/60 rounded-none text-sm resize-none focus-visible:ring-[#FF4500] focus-visible:border-[#FF4500] min-h-[38px] max-h-32"
            style={{ overflow: 'auto' }}
          />
          <Button
            data-testid="chat-send"
            onClick={sendMessage}
            disabled={!input.trim() || sending}
            className="bg-[#FF4500] hover:bg-[#e63e00] text-white rounded-none h-9 w-9 p-0 shrink-0 transition-colors disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-[#9CA3AF] text-[10px] mt-2 text-center">
          Press Enter to send — Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
