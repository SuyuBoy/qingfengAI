import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE, api, getToken } from "../api";
import { escapeHtml, renderMarkdown } from "../markdown";
import type {
  ArticleSummary,
  ChatMessage,
  ChatSession,
  CurrentUser,
  DebugLogEntry,
  DsCacheStats,
  DynamicItem,
  ToolCardData,
} from "../types";

const SESSIONS_KEY = "chat_sessions";
const ACTIVE_KEY = "chat_active_session";

interface AssistantDraft {
  content: string;
  reasoning: string;
  steps: Array<{ type: "think" | "tool"; text: string }>;
  typing: boolean;
  error?: string;
}

function loadSessions() {
  const raw = localStorage.getItem(SESSIONS_KEY);
  if (!raw) return [];
  return JSON.parse(raw) as ChatSession[];
}

function saveSessions(sessions: ChatSession[]) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

function getActiveId() {
  return localStorage.getItem(ACTIVE_KEY);
}

function setStoredActiveId(id: string | null) {
  if (id) localStorage.setItem(ACTIVE_KEY, id);
  else localStorage.removeItem(ACTIVE_KEY);
}

function makeSessionId() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function titleFromMessages(messages: ChatMessage[]) {
  const title = messages.find(m => m.role === "user")?.content?.slice(0, 30) || "新对话";
  return title.length >= 30 ? `${title}…` : title;
}

function cleanSnippet(s?: string) {
  return (s || "").replace(/!\[img:\d+\]/g, "[图]");
}

function parseToolKey(raw: string) {
  const idx = raw.indexOf(":");
  if (idx === -1) return { name: raw, query: raw };
  return { name: raw.slice(0, idx), query: raw.slice(idx + 1) };
}

function getInitialState() {
  const sessions = loadSessions();
  const activeId = getActiveId();
  const activeSession = activeId ? sessions.find(s => s.id === activeId) : null;
  return {
    sessions,
    activeSessionId: activeSession?.id || null,
    messages: activeSession?.messages || [],
  };
}

export default function ChatPage({ user }: { user: CurrentUser }) {
  const initial = useMemo(getInitialState, []);
  const [sessions, setSessions] = useState<ChatSession[]>(initial.sessions);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(initial.activeSessionId);
  const [messages, setMessages] = useState<ChatMessage[]>(initial.messages);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [assistantDraft, setAssistantDraft] = useState<AssistantDraft | null>(null);
  const [cards, setCards] = useState<ToolCardData[]>([]);
  const [historyCollapsed, setHistoryCollapsed] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [pastedImages, setPastedImages] = useState<string[]>([]);
  const [model, setModel] = useState("deepseek-v4-flash");
  const [effort, setEffort] = useState("high");
  const [maxRounds, setMaxRounds] = useState(10);
  const [debug, setDebug] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugLog, setDebugLog] = useState<DebugLogEntry[]>(window.__debugLog || []);
  const [cacheStats, setCacheStats] = useState<DsCacheStats>({ hit: 0, miss: 0 });
  const [articleId, setArticleId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // --- streaming throttling: use refs to accumulate, rAF to flush at ~60fps ---
  const draftAccRef = useRef<AssistantDraft | null>(null);
  const rafRef = useRef<number>(0);
  const localCardsRef = useRef<ToolCardData[]>([]);
  const localDebugLogRef = useRef<DebugLogEntry[]>([]);

  /** Flush accumulated streaming state to React state (called inside rAF). */
  const flushStreamState = useCallback(() => {
    if (draftAccRef.current) setAssistantDraft({ ...draftAccRef.current });
    if (localCardsRef.current.length) setCards([...localCardsRef.current]);
    if (localDebugLogRef.current.length) setDebugLog([...localDebugLogRef.current]);
    rafRef.current = 0;
  }, []);

  /** Schedule a rAF-bound flush. Multiple calls in the same frame only enqueue once. */
  const scheduleFlush = useCallback(() => {
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => flushStreamState());
    }
  }, [flushStreamState]);

  useEffect(() => {
    window.__debugMessages = messages;
  }, [messages]);

  useEffect(() => {
    window.__debugLog = debugLog;
  }, [debugLog]);

  // --- scroll on new messages (but NOT on every streaming token) ---
  const lastMessageCount = useRef(messages.length);
  useEffect(() => {
    // Only auto-scroll for user/assistant messages, not on streaming draft updates
    if (messages.length !== lastMessageCount.current) {
      lastMessageCount.current = messages.length;
      window.scrollTo(0, document.body.scrollHeight);
    }
  }, [messages]);

  // --- stable callbacks (useCallback so child memo works) ---
  const persistSessions = useCallback((nextSessions: ChatSession[]) => {
    setSessions(nextSessions);
    saveSessions(nextSessions);
  }, []);

  const persistActiveSession = useCallback(
    (sessionId: string | null, nextMessages: ChatMessage[], currentSessions?: ChatSession[]) => {
      if (!sessionId || !nextMessages.length) return;
      const base = currentSessions || sessions;
      const idx = base.findIndex(s => s.id === sessionId);
      const entry: ChatSession = {
        id: sessionId,
        title: titleFromMessages(nextMessages),
        messages: nextMessages,
        updatedAt: Date.now(),
        createdAt: idx >= 0 ? base[idx].createdAt : Date.now(),
      };
      const nextSessions = idx >= 0
        ? base.map((s, i) => i === idx ? entry : s)
        : [entry, ...base];
      persistSessions(nextSessions);
    },
    [sessions, persistSessions],
  );

  const beginNewSession = useCallback(() => {
    if (streaming) return;
    setMessages([]);
    setActiveSessionId(null);
    setStoredActiveId(null);
    setAssistantDraft(null);
    setCards([]);
    localCardsRef.current = [];
    setCacheStats({ hit: 0, miss: 0 });
    setDebugLog([]);
    localDebugLogRef.current = [];
    setDraft("");
    setPastedImages([]);
  }, [streaming]);

  const loadSession = useCallback((id: string) => {
    if (streaming || id === activeSessionId) return;
    const session = sessions.find(s => s.id === id);
    if (!session) return;
    setMessages(session.messages);
    setActiveSessionId(id);
    setStoredActiveId(id);
    setAssistantDraft(null);
    setCards([]);
    localCardsRef.current = [];
  }, [streaming, activeSessionId, sessions]);

  const deleteSession = useCallback((id: string) => {
    const nextSessions = sessions.filter(s => s.id !== id);
    persistSessions(nextSessions);
    if (id === activeSessionId) {
      setMessages([]);
      setActiveSessionId(null);
      setStoredActiveId(null);
      setAssistantDraft(null);
      setCards([]);
      localCardsRef.current = [];
    }
  }, [sessions, activeSessionId, persistSessions]);

  const removePastedImage = useCallback((idx: number) => {
    setPastedImages(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const onPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (!item.type.startsWith("image/")) continue;
      e.preventDefault();
      const blob = item.getAsFile();
      if (!blob) return;
      const reader = new FileReader();
      reader.onload = () => {
        const value = String(reader.result || "");
        const b64 = value.split(",")[1];
        if (b64) setPastedImages(prev => [...prev, b64]);
      };
      reader.readAsDataURL(blob);
      break;
    }
  }, []);

  const collapseHistory = useCallback(() => setHistoryCollapsed(true), []);
  const expandHistory = useCallback(() => setHistoryCollapsed(false), []);
  const collapseSidebar = useCallback(() => setSidebarCollapsed(true), []);
  const expandSidebar = useCallback(() => setSidebarCollapsed(false), []);
  const openArticle = useCallback((id: string) => setArticleId(id), []);
  const closeArticle = useCallback(() => setArticleId(null), []);
  const openDebug = useCallback(() => setDebugOpen(true), []);
  const closeDebug = useCallback(() => setDebugOpen(false), []);

  // --- send message (with rAF-throttled streaming updates) ---
  async function sendMessage() {
    const text = draft.trim();
    if (streaming || !text) return;

    const images = pastedImages.length ? [...pastedImages] : null;
    const previousMessages = messages;
    const sessionId = activeSessionId || makeSessionId();
    const userMessage: ChatMessage = { role: "user", content: text };
    const outboundMessages = [...messages, userMessage];

    setDraft("");
    setPastedImages([]);
    setMessages(outboundMessages);
    setActiveSessionId(sessionId);
    setStoredActiveId(sessionId);
    persistActiveSession(sessionId, outboundMessages);

    // Initialize streaming state
    draftAccRef.current = { content: "", reasoning: "", steps: [], typing: true };
    localCardsRef.current = [];
    localDebugLogRef.current = [];
    setCards([]);
    setDebugLog([]);
    setAssistantDraft(draftAccRef.current);
    setStreaming(true);

    let finalMessages = outboundMessages;
    let content = "";
    let reasoning = "";
    let steps: AssistantDraft["steps"] = [];
    let currentCardId: string | null = null;
    let receivedDoneMessages = false;
    const accumulatedCards: ToolCardData[] = [];
    const accumulatedDebugLog: DebugLogEntry[] = [];

    const flushReasoning = () => {
      if (!reasoning) return;
      steps = [...steps, { type: "think", text: reasoning.replace(/</g, "&lt;") }];
      reasoning = "";
    };

    const syncDraftAcc = () => {
      draftAccRef.current = { content, reasoning, steps, typing: !content };
      localCardsRef.current = accumulatedCards;
      localDebugLogRef.current = accumulatedDebugLog;
      scheduleFlush();
    };

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ messages: outboundMessages, model, effort, max_rounds: maxRounds, images, debug }),
      });

      if (res.status === 401) throw new Error("未登录");
      if (res.status === 403) throw new Error("未付费");
      if (!res.ok) throw new Error(res.statusText);
      if (!res.body) throw new Error("空响应");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const dataStr = line.slice(6);
          if (dataStr === "[DONE]") continue;
          try {
            const obj = JSON.parse(dataStr);
            if (obj.debug) {
              accumulatedDebugLog.push(obj.debug);
            } else if (obj.debug_response) {
              if (accumulatedDebugLog.length) {
                const last = accumulatedDebugLog[accumulatedDebugLog.length - 1];
                last.response = obj.debug_response;
              }
            } else if (obj.ds_usage) {
              setCacheStats({
                hit: obj.ds_usage.prompt_cache_hit_tokens || 0,
                miss: obj.ds_usage.prompt_cache_miss_tokens || 0,
              });
            } else if (obj.tool || obj.cached) {
              flushReasoning();
              const raw = obj.tool || obj.cached;
              const { name, query } = parseToolKey(raw);
              const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
              currentCardId = id;
              steps = [...steps, { type: "tool", text: `${obj.tool ? "🔧" : "📋"} ${escapeHtml(name)}: ${escapeHtml(query)}` }];
              accumulatedCards.unshift({ id, name, query, cached: Boolean(obj.cached), articles: [] });
            } else if (obj.articles) {
              const articles = (obj.articles || []) as ArticleSummary[];
              const cardIdx = accumulatedCards.findIndex(c => c.id === currentCardId);
              if (cardIdx >= 0) {
                accumulatedCards[cardIdx] = { ...accumulatedCards[cardIdx], articles };
              }
            } else if (obj.reasoning) {
              reasoning += obj.reasoning;
            } else if (obj.delta) {
              flushReasoning();
              content += obj.delta;
            } else if (obj.done && obj.messages) {
              receivedDoneMessages = true;
              finalMessages = [...finalMessages, ...(obj.messages as ChatMessage[])];
            }
            // Throttled update via rAF — no setState per token!
            syncDraftAcc();
          } catch {
            // Keep the stream alive when a single SSE line is malformed.
          }
        }
      }

      // Final flush
      flushReasoning();
      draftAccRef.current = { content, reasoning: "", steps, typing: false };
      localCardsRef.current = accumulatedCards;
      localDebugLogRef.current = accumulatedDebugLog;

      // Cancel any pending rAF and flush synchronously for the final frame
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      flushStreamState();

      if (!receivedDoneMessages && content) {
        finalMessages = [...finalMessages, { role: "assistant", content }];
      }
      setMessages(finalMessages);
      setCards(accumulatedCards);
      setDebugLog(accumulatedDebugLog);
      persistActiveSession(sessionId, finalMessages);

      // Clear draft after a tick so the final content is visible briefly as a draft
      window.setTimeout(() => {
        setAssistantDraft(null);
        draftAccRef.current = null;
      }, 0);
    } catch (e) {
      setMessages(previousMessages);
      persistActiveSession(sessionId, previousMessages);
      setAssistantDraft({
        content: `请求失败: ${e instanceof Error ? e.message : "未知错误"}`,
        reasoning: "",
        steps: [],
        typing: false,
        error: "1",
      });
      draftAccRef.current = null;
    } finally {
      setStreaming(false);
      window.setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }

  const chatViewClass = useMemo(() =>
    [sidebarCollapsed ? "collapsed" : "", historyCollapsed ? "history-collapsed" : ""]
      .filter(Boolean).join(" "),
    [sidebarCollapsed, historyCollapsed]);

  const sortedSessions = useMemo(() =>
    [...sessions].sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions]);

  return (
    <>
      <div id="chat-view" className={chatViewClass}>
        <HistorySidebar
          sessions={sortedSessions}
          activeSessionId={activeSessionId}
          onNew={beginNewSession}
          onLoad={loadSession}
          onDelete={deleteSession}
          onCollapse={collapseHistory}
        />
        <div className="chat-main">
          <div className="chat-messages">
            {!messages.length && !assistantDraft && <div className="chat-empty">向 AI 助手提问，基于清风文章库检索回答</div>}
            {messages.map((message, index) => (
              <MessageBubble key={`${message.role}-${index}`} message={message} />
            ))}
            {assistantDraft && <AssistantDraftBubble draft={assistantDraft} />}
          </div>
          <div className="chat-input-wrap">
            <div className="chat-controls">
              <select id="chat-model" value={model} onChange={e => setModel(e.target.value)}>
                <option value="deepseek-v4-flash">v4 Flash</option>
                <option value="deepseek-v4-pro">v4 Pro</option>
              </select>
              <select id="chat-effort" value={effort} onChange={e => setEffort(e.target.value)}>
                <option value="high">高思考</option>
                <option value="max">最强思考</option>
              </select>
              <label className="rounds-label">工具调用轮数
                <input
                  type="number"
                  id="chat-max-rounds"
                  value={maxRounds}
                  min="1"
                  max="50"
                  onChange={e => setMaxRounds(Number(e.target.value) || 10)}
                />
              </label>
              <CacheRing stats={cacheStats} />
              {user.is_admin && (
                <>
                  <label className="rounds-label" id="chat-debug-label">
                    <input type="checkbox" id="chat-debug-toggle" checked={debug} onChange={e => setDebug(e.target.checked)} /> 调试
                  </label>
                  <button className="model-btn" id="chat-debug-view" onClick={openDebug}>查看调试</button>
                </>
              )}
              <button className="model-btn" id="chat-clear" onClick={beginNewSession}>新对话</button>
            </div>
            <div className="chat-send-row">
              <textarea
                ref={textareaRef}
                id="chat-input"
                rows={1}
                placeholder="输入问题...（可直接粘贴图片）"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onPaste={onPaste}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
              />
              <button id="chat-send-btn" disabled={streaming || (!draft.trim() && !pastedImages.length)} onClick={sendMessage}>发送</button>
            </div>
            {pastedImages.length > 0 && (
              <div className="chat-paste-preview" id="paste-preview">
                {pastedImages.map((b64, i) => (
                  <div className="paste-thumb-wrap" key={`${i}-${b64.slice(0, 12)}`}>
                    <img src={`data:image/png;base64,${b64}`} className="paste-thumb" alt="" />
                    <button className="paste-remove" onClick={() => removePastedImage(i)}>&times;</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <ToolSidebar cards={cards} onCollapse={collapseSidebar} onReadArticle={openArticle} />
      </div>
      {historyCollapsed && (
        <button className="chat-sidebar-expand history-expand-btn" id="history-expand" title="展开历史" onClick={expandHistory}>历史 →</button>
      )}
      {sidebarCollapsed && (
        <button className="chat-sidebar-expand sidebar-expand-btn" id="sidebar-expand" title="展开工具调用" onClick={expandSidebar}>
          {cards.length ? `← 工具调用 (${cards.length})` : "← 工具调用"}
        </button>
      )}
      {articleId && <ArticleModal articleId={articleId} onClose={closeArticle} />}
      {debugOpen && <DebugModal messages={window.__debugMessages || messages} debugLog={debugLog} onClose={closeDebug} />}
    </>
  );
}

// ============================================================
// Memoized child components
// ============================================================

const HistorySidebar = memo(function HistorySidebar({ sessions, activeSessionId, onNew, onLoad, onDelete, onCollapse }: {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onNew: () => void;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onCollapse: () => void;
}) {
  return (
    <aside className="chat-sidebar history-sidebar" id="history-sidebar">
      <div className="tool-sidebar-title">
        <span>历史对话</span>
        <div className="chat-sidebar-actions">
          <button className="model-btn" id="history-new" onClick={onNew}>新对话</button>
          <button className="tool-sidebar-toggle" id="history-toggle" title="收起侧边栏" onClick={onCollapse}>&rarr;</button>
        </div>
      </div>
      {!sessions.length && <div className="tool-sidebar-empty" id="history-empty">暂无历史对话</div>}
      <div id="history-list">
        {sessions.map(session => (
          <HistoryCard
            key={session.id}
            session={session}
            isActive={session.id === activeSessionId}
            onLoad={onLoad}
            onDelete={onDelete}
          />
        ))}
      </div>
    </aside>
  );
});

const HistoryCard = memo(function HistoryCard({ session, isActive, onLoad, onDelete }: {
  session: ChatSession;
  isActive: boolean;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const date = useMemo(() => new Date(session.updatedAt).toLocaleDateString("zh-CN"), [session.updatedAt]);
  const count = useMemo(() => session.messages.filter(m => m.role === "user").length, [session.messages]);

  return (
    <div
      className={`history-card${isActive ? " active" : ""}`}
      data-id={session.id}
      onClick={() => onLoad(session.id)}
    >
      <div className="history-card-title">{session.title}</div>
      <div className="history-card-meta">{date} · {count} 轮</div>
      <button
        className="history-card-del"
        data-id={session.id}
        title="删除"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(session.id);
        }}
      >
        ×
      </button>
    </div>
  );
});

const ToolSidebar = memo(function ToolSidebar({ cards, onCollapse, onReadArticle }: {
  cards: ToolCardData[];
  onCollapse: () => void;
  onReadArticle: (id: string) => void;
}) {
  return (
    <aside className="chat-sidebar tool-sidebar" id="tool-sidebar">
      <div className="tool-sidebar-title">
        <span>工具调用</span>
        <button className="tool-sidebar-toggle" id="sidebar-toggle" title="收起侧边栏" onClick={onCollapse}>&larr;</button>
      </div>
      {!cards.length && <div className="tool-sidebar-empty">等待工具调用...</div>}
      {cards.map(card => (
        <div className="tool-card" key={card.id}>
          <div className="tool-card-head">
            <span className="tool-card-name">{card.name}</span>
          </div>
          <div className="tool-card-query">搜索："{card.query}"</div>
          <div className="tool-card-articles">
            {card.cached && !card.articles.length ? (
              <div style={{ fontSize: "0.65rem", color: "var(--muted)" }}>缓存命中</div>
            ) : card.articles.map(article => (
              <div className="article-item" key={article.id}>
                <div className="article-item-date">{article.date}</div>
                <div className="article-item-title">{article.title || "(无标题)"}</div>
                {article.snippet && <div className="article-item-snippet">{cleanSnippet(article.snippet)}</div>}
                <div className="article-item-more" data-id={article.id} onClick={() => onReadArticle(article.id)}>阅读全文 →</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </aside>
  );
});

const MessageBubble = memo(function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role !== "user" && message.role !== "assistant") return null;
  if (message.role === "assistant" && !message.content) return null;
  const label = message.role === "user" ? "你" : "AI";
  const html = useMemo(() => renderMarkdown(message.content || ""), [message.content]);
  return (
    <div className={`chat-msg ${message.role}`}>
      <div className="role-label">{label}</div>
      <div className="msg-body" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
});

const AssistantDraftBubble = memo(function AssistantDraftBubble({ draft }: { draft: AssistantDraft }) {
  const html = useMemo(() => {
    let h = "";
    if (draft.steps.length || draft.reasoning) {
      h += '<details class="msg-think" open><summary>思考过程</summary><div class="think-steps">';
      for (const step of draft.steps) {
        h += step.type === "tool"
          ? `<div class="think-tool">${step.text}</div>`
          : `<div class="think-step">${step.text}</div>`;
      }
      if (draft.reasoning) h += `<div class="think-step">${draft.reasoning.replace(/</g, "&lt;")}</div>`;
      h += "</div></details>";
    }
    h += renderMarkdown(draft.content || (draft.typing ? "思考中..." : ""));
    return h;
  }, [draft.content, draft.reasoning, draft.steps, draft.typing]);

  return (
    <div className={`chat-msg assistant${draft.typing ? " typing" : ""}${draft.error ? " error" : ""}`}>
      <div className="role-label">AI</div>
      <div className="msg-body" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
});

const CacheRing = memo(function CacheRing({ stats }: { stats: DsCacheStats }) {
  const total = stats.hit + stats.miss;
  if (!total) return null;
  const rate = Math.round((stats.hit / total) * 100);
  const circum = 2 * Math.PI * 8;
  const dashLen = (rate / 100) * circum;
  return (
    <div className="cache-ring" id="cache-ring" title={`命中 ${stats.hit} / 未命中 ${stats.miss} tokens`}>
      <svg width="20" height="20" viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="8" fill="none" stroke="var(--border)" strokeWidth="3" />
        <circle
          id="cache-hit-arc"
          cx="10"
          cy="10"
          r="8"
          fill="none"
          stroke="#5cb878"
          strokeWidth="3"
          strokeDasharray={`${dashLen} ${circum}`}
          strokeLinecap="butt"
          transform="rotate(-90 10 10)"
        />
      </svg>
      <span className="cache-ring-label" id="cache-pct">{rate}</span>
    </div>
  );
});

const ArticleModal = memo(function ArticleModal({ articleId, onClose }: { articleId: string; onClose: () => void }) {
  const [article, setArticle] = useState<DynamicItem | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setArticle(null);
    setError("");
    api.get<DynamicItem>(`/api/dynamics/${encodeURIComponent(articleId)}`)
      .then(data => {
        if (data) setArticle(data);
      })
      .catch(() => setError("文章加载失败"));
  }, [articleId]);

  const content = useMemo(() =>
    article?.content.replace(
      /!\[img:(\d+)\]/g,
      (_, idx) => `![图片](${API_BASE}/api/img/${article.dynamic_id}_${idx})`
    ) || "",
    [article]);

  const html = useMemo(() => renderMarkdown(content), [content]);

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box">
        {!article && <div className="modal-body">{error || "加载中..."}</div>}
        {article && (
          <>
            <div className="modal-header">
              <div>
                <h3>{article.title || "(无标题)"}</h3>
                <div className="modal-meta">{article.date} · {article.type}</div>
                {(article.stocks || article.sectors || article.sentiment || article.methods) && <div className="modal-tags">
                    {article.stocks && <span className="tag tag-stocks">{article.stocks}</span>}
                    {article.sectors && <span className="tag tag-sectors">{article.sectors}</span>}
                    {article.sentiment && <span className="tag tag-sentiment">{article.sentiment}</span>}
                    {article.methods && <span className="tag tag-methods">{article.methods}</span>}
                  </div>}
              </div>
              <button className="modal-close" onClick={onClose}>&times;</button>
            </div>
            <div className="modal-body" dangerouslySetInnerHTML={{ __html: html }} />
          </>
        )}
      </div>
    </div>
  );
});

const DebugModal = memo(function DebugModal({ messages, debugLog, onClose }: {
  messages: ChatMessage[];
  debugLog: DebugLogEntry[];
  onClose: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box debug-modal">
        <div className="modal-header">
          <h3>调试：上下文 ({messages.length} 条消息)</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          {debugLog.length ? (
            <>
              <h4 style={{ margin: "1rem 0 0.5rem", fontSize: "0.8rem" }}>HTTP 请求/响应 ({debugLog.length} 轮)</h4>
              {debugLog.map(entry => (
                <details className="msg-think" style={{ marginBottom: "0.5rem" }} key={entry.round}>
                  <summary>第 {entry.round} 轮 — 请求</summary>
                  <pre className="debug-msg-body">{JSON.stringify(entry.request, null, 2)}</pre>
                  {entry.response && (
                    <>
                      <div style={{ marginTop: "0.5rem", fontSize: "0.65rem", color: "var(--muted)" }}>响应:</div>
                      <pre className="debug-msg-body">{entry.response}</pre>
                    </>
                  )}
                </details>
              ))}
            </>
          ) : null}
          {messages.map((message, i) => <DebugMessage message={message} index={i} key={i} />)}
        </div>
      </div>
    </div>
  );
});

const DebugMessage = memo(function DebugMessage({ message, index }: { message: ChatMessage; index: number }) {
  let roleIcon = "";
  let roleClass = "";
  switch (message.role) {
    case "system":
      roleIcon = "system";
      roleClass = "debug-role-system";
      break;
    case "user":
      roleIcon = "user";
      roleClass = "debug-role-user";
      break;
    case "assistant":
      roleIcon = message.tool_calls ? "assistant+tool" : "assistant";
      roleClass = "debug-role-assistant";
      break;
    case "tool":
      roleIcon = "tool";
      roleClass = "debug-role-tool";
      break;
  }

  const body = useMemo(() => {
    let b = message.content || "";
    if (message.tool_calls) {
      b += `\n\n${message.tool_calls.map(t => `[调用: ${t.function.name}(${t.function.arguments})]`).join("\n")}`;
    }
    if (message.reasoning_content) {
      b += `\n\n[思考: ${message.reasoning_content.slice(0, 500)}${message.reasoning_content.length > 500 ? "..." : ""}]`;
    }
    return b;
  }, [message.content, message.tool_calls, message.reasoning_content]);

  return (
    <div className="debug-msg">
      <div className="debug-msg-head">
        <span className="debug-idx">#{index}</span>
        <span className={`debug-role ${roleClass}`}>{roleIcon}</span>
      </div>
      <pre className="debug-msg-body">{body}</pre>
    </div>
  );
});
