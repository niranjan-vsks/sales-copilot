import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Send, MessageSquare, ExternalLink, Loader2, Zap, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import api from '@/lib/api';

// ── Suggested prompts ─────────────────────────────────────────────────────────
const SUGGESTED_PROMPTS = [
  'Is my webhook connected?',
  'What file did I upload last?',
  'Log a phone call with Visaka Industries, 30 minutes, Q1 review',
  'Show my recent activities',
];

// ── Workflow execution card (shown when AI triggers a workflow from chat) ──────
function WorkflowCard({ workflowType, result }) {
  const statusMap = {
    success: { cls: 'text-[#22c55e]', label: 'Logged successfully' },
    pending: { cls: 'text-[#f59e0b]', label: 'Submitted — awaiting D365 confirmation' },
    failed:  { cls: 'text-[#ef4444]', label: 'Failed' },
  };
  const s = statusMap[result?.status] || statusMap.pending;

  return (
    <div className="mt-2 bg-[#0f0f10] border border-[#1f2022] px-4 py-3">
      <p className="text-[10px] text-[#9CA3AF] mb-1 uppercase tracking-wider font-medium">
        Workflow triggered by AI
      </p>
      <p className="text-sm text-[#F2F3F5] font-medium mb-1.5">
        {workflowType?.charAt(0).toUpperCase() + workflowType?.slice(1)} — D365 Activity
      </p>
      <span className={`text-xs ${s.cls}`}>{s.label}</span>
      {result?.record_url && (
        <a
          href={result.record_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[#FF4500] text-xs hover:underline ml-3"
        >
          View in D365 <ExternalLink className="w-3 h-3" />
        </a>
      )}
      {result?.status === 'failed' && result?.error && (
        <p className="text-xs text-[#ef4444] mt-1">{result.error}</p>
      )}
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────
function MessageBubble({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className={`max-w-[75%] ${isUser ? 'order-2' : 'order-1'}`}>
        <div
          className={`px-4 py-2.5 text-sm leading-relaxed ${
            isUser
              ? 'bg-[#FF4500] text-white'
              : 'bg-[#141416] border border-[#1f2022] text-[#F2F3F5]'
          }`}
        >
          {msg.content}
        </div>

        {/* Workflow card — shown when AI triggered a workflow */}
        {msg.workflow_triggered && msg.workflow_result && (
          <WorkflowCard
            workflowType={msg.workflow_triggered}
            result={msg.workflow_result}
          />
        )}

        <p className="text-[10px] text-[#9CA3AF] mt-1 px-1">
          {msg.created_at
            ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : ''}
        </p>
      </div>
    </div>
  );
}

// ── Typing indicator ──────────────────────────────────────────────────────────
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

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState({ onPrompt }) {
  return (
    <div className="flex flex-col items-center justify-center h-full">
      <div className="w-12 h-12 bg-[#FF4500]/10 border border-[#FF4500]/20 flex items-center justify-center mb-4">
        <MessageSquare className="w-6 h-6 text-[#FF4500]" />
      </div>
      <p className="text-[#F2F3F5] font-medium mb-1">Context-aware AI</p>
      <p className="text-[#9CA3AF] text-xs mb-6 max-w-xs text-center">
        Knows your connections, uploaded files, and recent activities in real time.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-md">
        {SUGGESTED_PROMPTS.map((p) => (
          <button
            key={p}
            onClick={() => onPrompt(p)}
            className="px-3 py-2.5 bg-[#141416] border border-[#1f2022] text-[#9CA3AF] text-xs text-left hover:border-[#FF4500]/40 hover:text-[#F2F3F5] transition-colors"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ChatPage() {
  const [messages, setMessages]     = useState([]);
  const [input, setInput]           = useState('');
  const [sending, setSending]       = useState(false);
  const [loading, setLoading]       = useState(true);
  const [contextLoaded, setContextLoaded] = useState(false);
  const bottomRef   = useRef(null);
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

  const sendMessage = async (text) => {
    const msg = (text || input).trim();
    if (!msg || sending) return;

    const userMsg = {
      role: 'user',
      content: msg,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const res = await api.post('/chat', { message: msg });

      if (res.app_context_loaded) setContextLoaded(true);

      const assistantMsg = {
        role: 'assistant',
        content: res.message || '',
        workflow_triggered: res.workflow_triggered,
        workflow_result: res.workflow_result,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // Toast for successful workflow trigger
      if (res.workflow_triggered && res.workflow_result?.status === 'success') {
        toast.success('Activity logged from chat', {
          description: res.workflow_result?.record_url
            ? 'View in D365 via the chat card below.'
            : 'D365 record created.',
        });
      }
    } catch (err) {
      toast.error('Failed to send message', { description: err.message });
      setMessages((prev) => prev.slice(0, -1));
      setInput(msg);
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-[#FF4500]" />
            <h1 className="font-['Space_Grotesk'] text-lg font-bold text-[#F2F3F5]">AI Chat</h1>
          </div>

          {/* Context indicator */}
          {contextLoaded && (
            <motion.div
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-1.5 text-[10px] text-[#22c55e]"
            >
              <CheckCircle className="w-3 h-3" />
              App context loaded
            </motion.div>
          )}
        </div>
        <p className="text-[#9CA3AF] text-xs mt-0.5">
          Ask about your connections, accounts, or log an activity…
        </p>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-5 h-5 text-[#FF4500] animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <EmptyState onPrompt={(p) => sendMessage(p)} />
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
            placeholder="Ask about your connections, accounts, or log an activity…"
            rows={1}
            className="flex-1 bg-[#141416] border-[#1f2022] text-[#F2F3F5] placeholder:text-[#9CA3AF]/60 rounded-none text-sm resize-none focus-visible:ring-[#FF4500] focus-visible:border-[#FF4500] min-h-[38px] max-h-32"
            style={{ overflow: 'auto' }}
          />
          <Button
            data-testid="chat-send"
            onClick={() => sendMessage()}
            disabled={!input.trim() || sending}
            className="bg-[#FF4500] hover:bg-[#e63e00] text-white rounded-none h-9 w-9 p-0 shrink-0 transition-colors disabled:opacity-50"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
        <div className="flex items-center justify-between mt-2 max-w-4xl mx-auto">
          <div className="flex items-center gap-1 text-[#9CA3AF]/60 text-[10px]">
            <Zap className="w-3 h-3" />
            Context-aware — knows your live app state
          </div>
          <p className="text-[#9CA3AF] text-[10px]">Enter to send · Shift+Enter for new line</p>
        </div>
      </div>
    </div>
  );
}
