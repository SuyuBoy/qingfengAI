import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AssistantRuntimeProvider,
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  getExternalStoreMessages,
  useAuiState,
  useComposerRuntime,
  useExternalStoreRuntime,
  useMessagePartText,
  type AppendMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import {
  ArrowDown,
  Bug,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  PanelLeftClose,
  PanelRightClose,
  Plus,
  SendHorizontal,
  Square,
  Trash2,
  X,
} from "lucide-react";
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

type UiChatMessage = ChatMessage & {
  id: string;
  stream?: AssistantDraft;
};

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

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function normalizeMessages(messages: ChatMessage[]): UiChatMessage[] {
  return messages.map(message => ({ ...message, id: message.id || makeId() }));
}

function stripRuntimeFields(messages: UiChatMessage[]): ChatMessage[] {
  return messages.map(({ stream, ...message }) => message);
}

function titleFromMessages(messages: ChatMessage[]) {
  const title = messages.find(m => m.role === "user")?.content?.slice(0, 30) || "新对话";
  return title.length >= 30 ? `${title}...` : title;
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
    messages: normalizeMessages(activeSession?.messages || []),
  };
}

function toThreadMessage(message: UiChatMessage): ThreadMessageLike {
  const content = message.stream?.content || message.content || (message.stream?.typing ? "思考中..." : "");
  return {
    id: message.id,
    role: message.role === "system" ? "system" : message.role === "user" ? "user" : "assistant",
    content: [{ type: "text", text: content }],
    status: message.stream?.typing ? { type: "running" } : message.stream?.error
      ? { type: "incomplete", reason: "error", error: message.stream.error }
      : { type: "complete", reason: "stop" },
  };
}

function extractAppendText(message: AppendMessage) {
  return message.content
    .map(part => part.type === "text" ? part.text : "")
    .join("\n")
    .trim();
}

export default function ChatPage({ user }: { user: CurrentUser }) {
  const initial = useMemo(getInitialState, []);
  const [sessions, setSessions] = useState<ChatSession[]>(initial.sessions);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(initial.activeSessionId);
  const [messages, setMessages] = useState<UiChatMessage[]>(initial.messages);
  const [streaming, setStreaming] = useState(false);
  const [cards, setCards] = useState<ToolCardData[]>([]);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
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

  const messagesRef = useRef(messages);
  const activeSessionIdRef = useRef(activeSessionId);
  const sessionsRef = useRef(sessions);
  const streamingRef = useRef(streaming);
  const draftAccRef = useRef<AssistantDraft | null>(null);
  const streamMessageIdRef = useRef<string | null>(null);
  const rafRef = useRef<number>(0);
  const localCardsRef = useRef<ToolCardData[]>([]);
  const localDebugLogRef = useRef<DebugLogEntry[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
    window.__debugMessages = stripRuntimeFields(messages);
  }, [messages]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    streamingRef.current = streaming;
  }, [streaming]);

  useEffect(() => {
    window.__debugLog = debugLog;
  }, [debugLog]);

  const flushStreamState = useCallback(() => {
    const draft = draftAccRef.current;
    const streamId = streamMessageIdRef.current;
    if (draft && streamId) {
      setMessages(prev => prev.map(message =>
        message.id === streamId
          ? { ...message, content: draft.content || (draft.typing ? "思考中..." : ""), stream: { ...draft } }
          : message,
      ));
    }
    if (localCardsRef.current.length) setCards([...localCardsRef.current]);
    if (localDebugLogRef.current.length) setDebugLog([...localDebugLogRef.current]);
    rafRef.current = 0;
  }, []);

  const scheduleFlush = useCallback(() => {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(flushStreamState);
  }, [flushStreamState]);

  const persistSessions = useCallback((nextSessions: ChatSession[]) => {
    setSessions(nextSessions);
    saveSessions(nextSessions);
  }, []);

  const persistActiveSession = useCallback((sessionId: string | null, nextMessages: UiChatMessage[], currentSessions?: ChatSession[]) => {
    const storedMessages = stripRuntimeFields(nextMessages);
    if (!sessionId || !storedMessages.length) return;
    const base = currentSessions || sessionsRef.current;
    const idx = base.findIndex(s => s.id === sessionId);
    const entry: ChatSession = {
      id: sessionId,
      title: titleFromMessages(storedMessages),
      messages: storedMessages,
      updatedAt: Date.now(),
      createdAt: idx >= 0 ? base[idx].createdAt : Date.now(),
    };
    const nextSessions = idx >= 0
      ? base.map((s, i) => i === idx ? entry : s)
      : [entry, ...base];
    persistSessions(nextSessions);
  }, [persistSessions]);

  const beginNewSession = useCallback(() => {
    if (streamingRef.current) return;
    setMessages([]);
    setActiveSessionId(null);
    setStoredActiveId(null);
    setCards([]);
    localCardsRef.current = [];
    setCacheStats({ hit: 0, miss: 0 });
    setDebugLog([]);
    localDebugLogRef.current = [];
    setPastedImages([]);
  }, []);

  const loadSession = useCallback((id: string) => {
    if (streamingRef.current || id === activeSessionIdRef.current) return;
    const session = sessionsRef.current.find(s => s.id === id);
    if (!session) return;
    setMessages(normalizeMessages(session.messages));
    setActiveSessionId(id);
    setStoredActiveId(id);
    setCards([]);
    localCardsRef.current = [];
  }, []);

  const deleteSession = useCallback((id: string) => {
    const nextSessions = sessionsRef.current.filter(s => s.id !== id);
    persistSessions(nextSessions);
    if (id === activeSessionIdRef.current) beginNewSession();
  }, [beginNewSession, persistSessions]);

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

  const removePastedImage = useCallback((idx: number) => {
    setPastedImages(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const collapseHistory = useCallback(() => setHistoryCollapsed(true), []);
  const expandHistory = useCallback(() => setHistoryCollapsed(false), []);
  const collapseSidebar = useCallback(() => setSidebarCollapsed(true), []);
  const expandSidebar = useCallback(() => setSidebarCollapsed(false), []);
  const openArticle = useCallback((id: string) => setArticleId(id), []);
  const closeArticle = useCallback(() => setArticleId(null), []);
  const openDebug = useCallback(() => setDebugOpen(true), []);
  const closeDebug = useCallback(() => setDebugOpen(false), []);

  const sendMessage = useCallback(async (appendMessage: AppendMessage) => {
    const text = extractAppendText(appendMessage);
    if (streamingRef.current || (!text && !pastedImages.length)) return;

    const images = pastedImages.length ? [...pastedImages] : null;
    const previousMessages = messagesRef.current;
    const sessionId = activeSessionIdRef.current || makeId();
    const userMessage: UiChatMessage = { id: makeId(), role: "user", content: text || "[图片]" };
    const outboundMessages = [...previousMessages, userMessage];
    const assistantId = makeId();
    const assistantMessage: UiChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "思考中...",
      stream: { content: "", reasoning: "", steps: [], typing: true },
    };

    setPastedImages([]);
    setMessages([...outboundMessages, assistantMessage]);
    setActiveSessionId(sessionId);
    setStoredActiveId(sessionId);
    persistActiveSession(sessionId, outboundMessages);

    streamMessageIdRef.current = assistantId;
    draftAccRef.current = assistantMessage.stream || null;
    localCardsRef.current = [];
    localDebugLogRef.current = [];
    setCards([]);
    setDebugLog([]);
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
        body: JSON.stringify({
          messages: stripRuntimeFields(outboundMessages),
          model,
          effort,
          max_rounds: maxRounds,
          images,
          debug,
        }),
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
                accumulatedDebugLog[accumulatedDebugLog.length - 1].response = obj.debug_response;
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
              const id = makeId();
              currentCardId = id;
              steps = [...steps, { type: "tool", text: `${obj.tool ? "工具" : "缓存"} ${escapeHtml(name)}: ${escapeHtml(query)}` }];
              accumulatedCards.unshift({ id, name, query, cached: Boolean(obj.cached), articles: [] });
            } else if (obj.articles) {
              const articles = (obj.articles || []) as ArticleSummary[];
              const cardIdx = accumulatedCards.findIndex(c => c.id === currentCardId);
              if (cardIdx >= 0) accumulatedCards[cardIdx] = { ...accumulatedCards[cardIdx], articles };
            } else if (obj.reasoning) {
              reasoning += obj.reasoning;
            } else if (obj.delta) {
              flushReasoning();
              content += obj.delta;
            } else if (obj.done && obj.messages) {
              receivedDoneMessages = true;
              finalMessages = normalizeMessages([...finalMessages, ...(obj.messages as ChatMessage[])]);
            }
            syncDraftAcc();
          } catch {
            // Ignore one malformed SSE line and keep consuming the stream.
          }
        }
      }

      flushReasoning();
      draftAccRef.current = { content, reasoning: "", steps, typing: false };
      localCardsRef.current = accumulatedCards;
      localDebugLogRef.current = accumulatedDebugLog;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      flushStreamState();

      if (!receivedDoneMessages && content) {
        finalMessages = [...finalMessages, { id: makeId(), role: "assistant", content }];
      }
      const cleanFinalMessages = normalizeMessages(stripRuntimeFields(finalMessages));
      setMessages(cleanFinalMessages);
      setCards(accumulatedCards);
      setDebugLog(accumulatedDebugLog);
      persistActiveSession(sessionId, cleanFinalMessages);
    } catch (e) {
      const failed: UiChatMessage = {
        id: assistantId,
        role: "assistant",
        content: `请求失败: ${e instanceof Error ? e.message : "未知错误"}`,
        stream: {
          content: `请求失败: ${e instanceof Error ? e.message : "未知错误"}`,
          reasoning: "",
          steps: [],
          typing: false,
          error: "1",
        },
      };
      setMessages([...previousMessages, failed]);
      persistActiveSession(sessionId, previousMessages);
      draftAccRef.current = null;
    } finally {
      streamMessageIdRef.current = null;
      setStreaming(false);
    }
  }, [debug, effort, flushStreamState, maxRounds, model, pastedImages, persistActiveSession, scheduleFlush]);

  const visibleMessages = useMemo(
    () => messages.filter(message => message.role === "user" || message.role === "assistant"),
    [messages],
  );

  const runtime = useExternalStoreRuntime<UiChatMessage>({
    isRunning: streaming,
    messages: visibleMessages,
    convertMessage: toThreadMessage,
    onNew: sendMessage,
  });

  const chatViewClass = useMemo(() =>
    [sidebarCollapsed ? "collapsed" : "", historyCollapsed ? "history-collapsed" : ""]
      .filter(Boolean).join(" "),
    [sidebarCollapsed, historyCollapsed]);

  const sortedSessions = useMemo(() =>
    [...sessions].sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
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
          <div className="chat-topbar">
            <ChatControls
              model={model}
              effort={effort}
              maxRounds={maxRounds}
              cacheStats={cacheStats}
              debug={debug}
              isAdmin={Boolean(user.is_admin)}
              onModelChange={setModel}
              onEffortChange={setEffort}
              onMaxRoundsChange={setMaxRounds}
              onDebugChange={setDebug}
              onDebugOpen={openDebug}
              onNew={beginNewSession}
            />
          </div>
          <AssistantThread
            pastedImages={pastedImages}
            streaming={streaming}
            onPaste={onPaste}
            onRemoveImage={removePastedImage}
          />
        </div>
        <ToolSidebar cards={cards} onCollapse={collapseSidebar} onReadArticle={openArticle} />
      </div>
      {historyCollapsed && (
        <button className="chat-sidebar-expand history-expand-btn" title="展开历史" onClick={expandHistory}>
          <ChevronRight size={15} /> 历史
        </button>
      )}
      {sidebarCollapsed && (
        <button className="chat-sidebar-expand sidebar-expand-btn" title="展开工具调用" onClick={expandSidebar}>
          <ChevronLeft size={15} /> 工具{cards.length ? ` (${cards.length})` : ""}
        </button>
      )}
      {articleId && <ArticleModal articleId={articleId} onClose={closeArticle} />}
      {debugOpen && <DebugModal messages={window.__debugMessages || stripRuntimeFields(messages)} debugLog={debugLog} onClose={closeDebug} />}
    </AssistantRuntimeProvider>
  );
}

const ChatControls = memo(function ChatControls({
  model,
  effort,
  maxRounds,
  cacheStats,
  debug,
  isAdmin,
  onModelChange,
  onEffortChange,
  onMaxRoundsChange,
  onDebugChange,
  onDebugOpen,
  onNew,
}: {
  model: string;
  effort: string;
  maxRounds: number;
  cacheStats: DsCacheStats;
  debug: boolean;
  isAdmin: boolean;
  onModelChange: (value: string) => void;
  onEffortChange: (value: string) => void;
  onMaxRoundsChange: (value: number) => void;
  onDebugChange: (value: boolean) => void;
  onDebugOpen: () => void;
  onNew: () => void;
}) {
  return (
    <div className="chat-controls">
      <select value={model} onChange={e => onModelChange(e.target.value)} aria-label="模型">
        <option value="deepseek-v4-flash">v4 Flash</option>
        <option value="deepseek-v4-pro">v4 Pro</option>
      </select>
      <select value={effort} onChange={e => onEffortChange(e.target.value)} aria-label="思考强度">
        <option value="high">高思考</option>
        <option value="max">最强思考</option>
      </select>
      <label className="rounds-label">
        工具轮数
        <input
          type="number"
          value={maxRounds}
          min="1"
          max="50"
          onChange={e => onMaxRoundsChange(Number(e.target.value) || 10)}
        />
      </label>
      <CacheRing stats={cacheStats} />
      {isAdmin && (
        <>
          <label className="debug-toggle">
            <input type="checkbox" checked={debug} onChange={e => onDebugChange(e.target.checked)} />
            调试
          </label>
          <button className="icon-text-btn" title="查看调试" onClick={onDebugOpen}>
            <Bug size={15} /> 调试
          </button>
        </>
      )}
      <button className="icon-text-btn" title="新对话" onClick={onNew}>
        <Plus size={15} /> 新对话
      </button>
    </div>
  );
});

const AssistantThread = memo(function AssistantThread({
  pastedImages,
  streaming,
  onPaste,
  onRemoveImage,
}: {
  pastedImages: string[];
  streaming: boolean;
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onRemoveImage: (idx: number) => void;
}) {
  return (
    <ThreadPrimitive.Root className="aui-thread-root">
      <ThreadPrimitive.Viewport className="aui-thread-viewport" turnAnchor="top">
        <div className="aui-thread-inner">
          <AuiIf condition={(state) => state.thread.isEmpty}>
            <div className="chat-empty">向 AI 助手提问，基于清风文章库检索回答</div>
          </AuiIf>
          <div className="aui-message-list">
            <ThreadPrimitive.Messages>{() => <ThreadMessage />}</ThreadPrimitive.Messages>
          </div>
          <ThreadPrimitive.ViewportFooter className="aui-thread-footer">
            <ThreadPrimitive.ScrollToBottom asChild>
              <button className="scroll-bottom-btn" title="滚动到底部" type="button">
                <ArrowDown size={16} />
              </button>
            </ThreadPrimitive.ScrollToBottom>
            <Composer pastedImages={pastedImages} streaming={streaming} onPaste={onPaste} onRemoveImage={onRemoveImage} />
          </ThreadPrimitive.ViewportFooter>
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
});

const Composer = memo(function Composer({
  pastedImages,
  streaming,
  onPaste,
  onRemoveImage,
}: {
  pastedImages: string[];
  streaming: boolean;
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onRemoveImage: (idx: number) => void;
}) {
  const composerRuntime = useComposerRuntime();
  const canSend = useAuiState(state => state.composer.canSend);
  const send = useCallback(() => {
    if (pastedImages.length && !composerRuntime.getState().text.trim()) {
      composerRuntime.setText("[图片]");
    }
    composerRuntime.send();
  }, [composerRuntime, pastedImages.length]);

  return (
    <ComposerPrimitive.Root className="aui-composer-root">
      <div className="aui-composer-shell">
        {pastedImages.length > 0 && (
          <div className="chat-paste-preview">
            {pastedImages.map((b64, i) => (
              <div className="paste-thumb-wrap" key={`${i}-${b64.slice(0, 12)}`}>
                <img src={`data:image/png;base64,${b64}`} className="paste-thumb" alt="" />
                <button type="button" className="paste-remove" title="移除图片" onClick={() => onRemoveImage(i)}>
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <ComposerPrimitive.Input
          rows={1}
          autoFocus
          className="aui-composer-input"
          placeholder="输入问题...（可直接粘贴图片）"
          submitMode="enter"
          addAttachmentOnPaste={false}
          onPaste={onPaste}
          aria-label="输入问题"
        />
        <div className="aui-composer-actions">
          <div className="paste-hint" title="支持粘贴图片">
            <ImageIcon size={15} />
            {pastedImages.length > 0 && <span>{pastedImages.length}</span>}
          </div>
          <AuiIf condition={(state) => !state.thread.isRunning}>
            <button
              type="button"
              className="send-btn"
              title="发送"
              disabled={streaming || (!canSend && !pastedImages.length)}
              onClick={send}
            >
              <SendHorizontal size={17} />
            </button>
          </AuiIf>
          <AuiIf condition={(state) => state.thread.isRunning}>
            <ComposerPrimitive.Cancel asChild>
              <button type="button" className="send-btn" title={streaming ? "停止生成" : "取消"}>
                <Square size={14} />
              </button>
            </ComposerPrimitive.Cancel>
          </AuiIf>
        </div>
      </div>
    </ComposerPrimitive.Root>
  );
});

const ThreadMessage = memo(function ThreadMessage() {
  const role = useAuiState(state => state.message.role);
  return role === "user" ? <UserMessage /> : <AssistantMessage />;
});

const UserMessage = memo(function UserMessage() {
  return (
    <MessagePrimitive.Root className="aui-message user">
      <div className="aui-message-role">你</div>
      <div className="aui-message-body">
        <MessagePrimitive.Parts components={{ Text: PlainTextPart }} />
      </div>
    </MessagePrimitive.Root>
  );
});

const AssistantMessage = memo(function AssistantMessage() {
  const original = useAuiState(state => getExternalStoreMessages<UiChatMessage>(state.message)[0]);
  return (
    <MessagePrimitive.Root className={`aui-message assistant${original?.stream?.typing ? " typing" : ""}${original?.stream?.error ? " error" : ""}`}>
      <div className="aui-message-role">AI</div>
      <div className="aui-message-body">
        {original?.stream && <StreamThoughts draft={original.stream} />}
        <MessagePrimitive.Parts>
          {({ part }) => part.type === "text" ? <MarkdownTextPart /> : null}
        </MessagePrimitive.Parts>
      </div>
    </MessagePrimitive.Root>
  );
});

const PlainTextPart = memo(function PlainTextPart() {
  const part = useMessagePartText();
  return <span>{part.text}</span>;
});

const MarkdownTextPart = memo(function MarkdownTextPart() {
  const part = useMessagePartText();
  const html = useMemo(() => renderMarkdown(part.text || ""), [part.text]);
  return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />;
});

const StreamThoughts = memo(function StreamThoughts({ draft }: { draft: AssistantDraft }) {
  if (!draft.steps.length && !draft.reasoning) return null;
  return (
    <details className="msg-think" open>
      <summary>思考过程</summary>
      <div className="think-steps">
        {draft.steps.map((step, index) => (
          <div
            className={step.type === "tool" ? "think-tool" : "think-step"}
            key={`${step.type}-${index}`}
            dangerouslySetInnerHTML={{ __html: step.text }}
          />
        ))}
        {draft.reasoning && <div className="think-step">{draft.reasoning}</div>}
      </div>
    </details>
  );
});

const HistorySidebar = memo(function HistorySidebar({ sessions, activeSessionId, onNew, onLoad, onDelete, onCollapse }: {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onNew: () => void;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onCollapse: () => void;
}) {
  return (
    <aside className="chat-sidebar history-sidebar">
      <div className="tool-sidebar-title">
        <span>历史对话</span>
        <div className="chat-sidebar-actions">
          <button className="icon-btn" title="新对话" onClick={onNew}><Plus size={15} /></button>
          <button className="icon-btn" title="收起历史" onClick={onCollapse}><PanelLeftClose size={15} /></button>
        </div>
      </div>
      {!sessions.length && <div className="tool-sidebar-empty">暂无历史对话</div>}
      <div className="history-list">
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
    <button className={`history-card${isActive ? " active" : ""}`} onClick={() => onLoad(session.id)}>
      <span className="history-card-title">{session.title}</span>
      <span className="history-card-meta">{date} · {count} 轮</span>
      <span
        className="history-card-del"
        title="删除"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(session.id);
        }}
      >
        <Trash2 size={13} />
      </span>
    </button>
  );
});

const ToolSidebar = memo(function ToolSidebar({ cards, onCollapse, onReadArticle }: {
  cards: ToolCardData[];
  onCollapse: () => void;
  onReadArticle: (id: string) => void;
}) {
  return (
    <aside className="chat-sidebar tool-sidebar">
      <div className="tool-sidebar-title">
        <span>工具调用</span>
        <button className="icon-btn" title="收起工具调用" onClick={onCollapse}><PanelRightClose size={15} /></button>
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
              <div className="tool-sidebar-empty compact">缓存命中</div>
            ) : card.articles.map(article => (
              <div className="article-item" key={article.id}>
                <div className="article-item-date">{article.date}</div>
                <div className="article-item-title">{article.title || "(无标题)"}</div>
                {article.snippet && <div className="article-item-snippet">{cleanSnippet(article.snippet)}</div>}
                <button className="article-item-more" onClick={() => onReadArticle(article.id)}>阅读全文</button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </aside>
  );
});

const CacheRing = memo(function CacheRing({ stats }: { stats: DsCacheStats }) {
  const total = stats.hit + stats.miss;
  if (!total) return null;
  const rate = Math.round((stats.hit / total) * 100);
  const circum = 2 * Math.PI * 8;
  const dashLen = (rate / 100) * circum;
  return (
    <div className="cache-ring" title={`命中 ${stats.hit} / 未命中 ${stats.miss} tokens`}>
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="8" fill="none" stroke="var(--border)" strokeWidth="3" />
        <circle
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
      <span className="cache-ring-label">{rate}%</span>
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
              <button className="modal-close" onClick={onClose}><X size={18} /></button>
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
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          {debugLog.length ? (
            <>
              <h4>HTTP 请求/响应 ({debugLog.length} 轮)</h4>
              {debugLog.map(entry => (
                <details className="msg-think" key={entry.round}>
                  <summary>第 {entry.round} 轮 - 请求</summary>
                  <pre className="debug-msg-body">{JSON.stringify(entry.request, null, 2)}</pre>
                  {entry.response && (
                    <>
                      <div className="debug-response-label">响应:</div>
                      <pre className="debug-msg-body">{entry.response}</pre>
                    </>
                  )}
                </details>
              ))}
            </>
          ) : null}
          {messages.map((message, i) => <DebugMessage message={message} index={i} key={`${message.id || i}-${i}`} />)}
        </div>
      </div>
    </div>
  );
});

const DebugMessage = memo(function DebugMessage({ message, index }: { message: ChatMessage; index: number }) {
  const roleClass = `debug-role-${message.role}`;
  const body = useMemo(() => {
    let b = message.content || "";
    if (message.tool_calls) b += `\n\n${message.tool_calls.map(t => `[调用: ${t.function.name}(${t.function.arguments})]`).join("\n")}`;
    if (message.reasoning_content) {
      b += `\n\n[思考: ${message.reasoning_content.slice(0, 500)}${message.reasoning_content.length > 500 ? "..." : ""}]`;
    }
    return b;
  }, [message.content, message.tool_calls, message.reasoning_content]);

  return (
    <div className="debug-msg">
      <div className="debug-msg-head">
        <span className="debug-idx">#{index}</span>
        <span className={`debug-role ${roleClass}`}>{message.role}</span>
      </div>
      <pre className="debug-msg-body">{body}</pre>
    </div>
  );
});
