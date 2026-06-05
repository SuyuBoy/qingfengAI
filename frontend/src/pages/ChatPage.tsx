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
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import {
  ArrowDown,
  Bug,
  Image as ImageIcon,
  PanelRightClose,
  Plus,
  SendHorizontal,
  Square,
  X,
} from "lucide-react";
import remarkGfm from "remark-gfm";
import type { PluggableList } from "unified";
import { API_BASE, api, getToken } from "../api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { escapeHtml, renderMarkdown } from "../markdown";
import type {
  ArticleSummary,
  ChatMessage,
  ChatSession,
  CurrentUser,
  DebugLogEntry,
  DsCacheStats,
  DynamicItem,
  QuotaInfo,
  ToolCardData,
} from "../types";

const SESSIONS_KEY = "chat_sessions";
const ACTIVE_KEY = "chat_active_session";
const markdownRemarkPlugins: PluggableList = [[remarkGfm, { singleTilde: false }]];
const markdownComponents = {
  br: () => null,
};

function normalizeChatMarkdown(text: string) {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .split("\n");
  const normalized: string[] = [];
  let inFence = false;

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      normalized.push(line);
      continue;
    }

    if (inFence) {
      normalized.push(line);
      continue;
    }

    if (!line.trim()) {
      normalized.push("");
      continue;
    }

    normalized.push(line.trimEnd().replace(/\\$/, ""));
  }

  return normalized.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

type ActivityStep = { type: "think" | "tool"; text: string };
type ThoughtPhase = "thinking" | "tool" | "done";

interface AssistantDraft {
  content: string;
  reasoning: string;
  steps: ActivityStep[];
  phase: ThoughtPhase;
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
  const sessions = JSON.parse(raw) as ChatSession[];
  return Array.isArray(sessions) ? sessions : [];
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
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(message => message && (message.role === "user" || message.role === "assistant" || message.role === "system" || message.role === "tool"))
    .map(message => ({ ...message, id: message.id || makeId(), content: typeof message.content === "string" ? message.content : String(message.content || "") }));
}

function stripRuntimeFields(messages: UiChatMessage[]): ChatMessage[] {
  return messages.map(({ stream, ...message }) => message);
}

function isDisplayableAssistant(message: ChatMessage) {
  return message.role === "assistant" && !message.tool_calls?.length && Boolean(message.content?.trim());
}

function isVisibleMessage(message: UiChatMessage) {
  if (message.role === "user") return true;
  if (message.role !== "assistant") return false;
  if (message.stream) return true;
  return isDisplayableAssistant(message);
}

function attachReasoningToLastAssistant(messages: UiChatMessage[], reasoning: string) {
  const reasoningContent = reasoning.trim();
  if (!reasoningContent) return messages;
  let idx = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (isDisplayableAssistant(messages[i])) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return messages;
  return messages.map((message, i) => {
    if (i !== idx || message.reasoning_content) return message;
    return { ...message, reasoning_content: reasoningContent };
  });
}

function pickAssistantContent(stored: string, streamed: string) {
  if (!streamed) return stored;
  if (!stored) return streamed;
  if (stored === streamed) return stored;
  if (streamed.startsWith(stored)) return streamed;
  if (stored.startsWith(streamed)) return stored;
  return streamed.length >= stored.length ? streamed : stored;
}

function mergeStreamedAssistantContent(
  messages: UiChatMessage[],
  streamedContent: string,
  reasoningContent: string,
  fallbackId: string,
) {
  const normalized = normalizeMessages(stripRuntimeFields(messages));
  if (!streamedContent) return normalized;

  let idx = -1;
  for (let i = normalized.length - 1; i >= 0; i -= 1) {
    if (isDisplayableAssistant(normalized[i])) {
      idx = i;
      break;
    }
  }

  if (idx < 0) {
    return [...normalized, {
      id: fallbackId,
      role: "assistant" as const,
      content: streamedContent,
      ...(reasoningContent.trim() ? { reasoning_content: reasoningContent.trim() } : {}),
    }];
  }

  return normalized.map((message, i) => {
    if (i !== idx) return message;
    const content = pickAssistantContent(message.content || "", streamedContent);
    return {
      ...message,
      content,
      ...(message.reasoning_content || !reasoningContent.trim() ? {} : { reasoning_content: reasoningContent.trim() }),
    };
  });
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
  let sessions: ChatSession[] = [];
  try {
    sessions = loadSessions();
  } catch {
    localStorage.removeItem(SESSIONS_KEY);
    localStorage.removeItem(ACTIVE_KEY);
  }
  const activeId = getActiveId();
  const activeSession = activeId ? sessions.find(s => s.id === activeId) : null;
  return {
    sessions,
    activeSessionId: activeSession?.id || null,
    messages: normalizeMessages(activeSession?.messages || []),
  };
}

function toThreadMessage(message: UiChatMessage): ThreadMessageLike {
  const role = message.role === "system" ? "system" : message.role === "user" ? "user" : "assistant";
  const content = message.stream ? message.stream.content : message.content || "";
  const base = {
    id: message.id,
    role,
    content: [{ type: "text", text: content }],
  } satisfies ThreadMessageLike;

  if (role !== "assistant") return base;

  return {
    ...base,
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
  const [activitySteps, setActivitySteps] = useState<ActivityStep[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [pastedImages, setPastedImages] = useState<string[]>([]);
  const [model, setModel] = useState("deepseek-v4-flash");
  const [effort, setEffort] = useState("high");
  const [maxRounds, setMaxRounds] = useState(10);
  const [debug, setDebug] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugLog, setDebugLog] = useState<DebugLogEntry[]>(window.__debugLog || []);
  const [cacheStats, setCacheStats] = useState<DsCacheStats>({ hit: 0, miss: 0 });
  const [quotaInfo, setQuotaInfo] = useState<QuotaInfo>({
    balance: user.quota_balance ?? 0,
    cap: user.quota_cap ?? 0,
    refill_rate: user.quota_refill_rate ?? 0,
  });
  const [articleId, setArticleId] = useState<string | null>(null);

  const messagesRef = useRef(messages);
  const activeSessionIdRef = useRef(activeSessionId);
  const sessionsRef = useRef(sessions);
  const streamingRef = useRef(streaming);
  const draftAccRef = useRef<AssistantDraft | null>(null);
  const streamMessageIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const deletedSessionIdsRef = useRef(new Set<string>());
  const rafRef = useRef<number>(0);
  const localCardsRef = useRef<ToolCardData[]>([]);
  const localActivityStepsRef = useRef<ActivityStep[]>([]);
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
          ? { ...message, content: draft.content, stream: { ...draft } }
          : message,
      ));
    }
    setCards([...localCardsRef.current]);
    setActivitySteps([...localActivityStepsRef.current]);
    if (localDebugLogRef.current.length) setDebugLog([...localDebugLogRef.current]);
    rafRef.current = 0;
  }, []);

  const scheduleFlush = useCallback(() => {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(flushStreamState);
  }, [flushStreamState]);

  const persistSessions = useCallback((nextSessions: ChatSession[]) => {
    setSessions(nextSessions);
    saveSessions(nextSessions);
    window.dispatchEvent(new CustomEvent("chat-sessions-changed"));
  }, []);

  const persistActiveSession = useCallback((sessionId: string | null, nextMessages: UiChatMessage[], currentSessions?: ChatSession[]) => {
    const storedMessages = stripRuntimeFields(nextMessages);
    if (!sessionId || !storedMessages.length) return;
    if (deletedSessionIdsRef.current.has(sessionId)) return;
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

  const resetCurrentSession = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    setMessages([]);
    setActiveSessionId(null);
    setStoredActiveId(null);
    setCards([]);
    setActivitySteps([]);
    localCardsRef.current = [];
    localActivityStepsRef.current = [];
    setCacheStats({ hit: 0, miss: 0 });
    setDebugLog([]);
    localDebugLogRef.current = [];
    setPastedImages([]);
    draftAccRef.current = null;
    streamMessageIdRef.current = null;
  }, []);

  const beginNewSession = useCallback(() => {
    if (streamingRef.current) return;
    resetCurrentSession();
  }, [resetCurrentSession]);

  const loadSession = useCallback((id: string) => {
    if (streamingRef.current || id === activeSessionIdRef.current) return;
    const session = sessionsRef.current.find(s => s.id === id);
    if (!session) return;
    setMessages(normalizeMessages(session.messages));
    setActiveSessionId(id);
    setStoredActiveId(id);
    setCards([]);
    setActivitySteps([]);
    localCardsRef.current = [];
    localActivityStepsRef.current = [];
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

  const addImageFiles = useCallback((files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter(file => file.type.startsWith("image/"));
    for (const file of imageFiles) {
      const reader = new FileReader();
      reader.onload = () => {
        const value = String(reader.result || "");
        const b64 = value.split(",")[1];
        if (b64) setPastedImages(prev => [...prev, b64]);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const removePastedImage = useCallback((idx: number) => {
    setPastedImages(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const collapseSidebar = useCallback(() => setSidebarCollapsed(true), []);
  const expandSidebar = useCallback(() => setSidebarCollapsed(false), []);
  const openArticle = useCallback((id: string) => setArticleId(id), []);
  const closeArticle = useCallback(() => setArticleId(null), []);
  const openDebug = useCallback(() => setDebugOpen(true), []);
  const closeDebug = useCallback(() => setDebugOpen(false), []);

  useEffect(() => {
    const onNewSession = () => beginNewSession();
    const onLoadSession = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (id) loadSession(id);
    };
    const onSessionDeleted = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (!id) return;
      deletedSessionIdsRef.current.add(id);
      if (id === activeSessionIdRef.current) {
        abortControllerRef.current?.abort();
        resetCurrentSession();
      }
    };
    window.addEventListener("chat-new-session", onNewSession);
    window.addEventListener("chat-load-session", onLoadSession);
    window.addEventListener("chat-session-deleted", onSessionDeleted);
    return () => {
      window.removeEventListener("chat-new-session", onNewSession);
      window.removeEventListener("chat-load-session", onLoadSession);
      window.removeEventListener("chat-session-deleted", onSessionDeleted);
    };
  }, [beginNewSession, loadSession, resetCurrentSession]);

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
      content: "",
      stream: { content: "", reasoning: "", steps: [], phase: "thinking", typing: true },
    };

    setPastedImages([]);
    setMessages([...outboundMessages, assistantMessage]);
    setActiveSessionId(sessionId);
    setStoredActiveId(sessionId);
    persistActiveSession(sessionId, outboundMessages);

    streamMessageIdRef.current = assistantId;
    draftAccRef.current = assistantMessage.stream || null;
    localCardsRef.current = [];
    localActivityStepsRef.current = [];
    localDebugLogRef.current = [];
    setCards([]);
    setActivitySteps([]);
    setDebugLog([]);
    setStreaming(true);
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    let finalMessages = outboundMessages;
    let content = "";
    let reasoning = "";
    let reasoningContent = "";
    let steps: ActivityStep[] = [];
    let phase: ThoughtPhase = "thinking";
    let currentCardId: string | null = null;
    const accumulatedCards: ToolCardData[] = [];
    const accumulatedDebugLog: DebugLogEntry[] = [];

    const flushReasoning = () => {
      if (!reasoning) return;
      steps = [...steps, { type: "think", text: reasoning.replace(/</g, "&lt;") }];
      reasoning = "";
    };

    const syncDraftAcc = () => {
      const activeSteps = reasoning ? [...steps, { type: "think" as const, text: escapeHtml(reasoning) }] : steps;
      draftAccRef.current = { content, reasoning, steps: activeSteps, phase, typing: phase !== "done" };
      localCardsRef.current = accumulatedCards;
      localActivityStepsRef.current = activeSteps;
      localDebugLogRef.current = accumulatedDebugLog;
      scheduleFlush();
    };

    const handleSseData = (data: string) => {
      const dataStr = data.trim();
      if (!dataStr || dataStr === "[DONE]") return;

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
        } else if (obj.quota) {
          setQuotaInfo({
            balance: obj.quota.balance,
            cap: obj.quota.cap,
            refill_rate: obj.quota.refill_rate || 0,
          });
        } else if (obj.tool || obj.cached) {
          flushReasoning();
          phase = "tool";
          const raw = obj.tool || obj.cached;
          const { name, query } = parseToolKey(raw);
          const id = makeId();
          currentCardId = id;
          steps = [...steps, { type: "tool", text: `${obj.tool ? "工具" : "缓存"} ${escapeHtml(name)}: ${escapeHtml(query)}` }];
          accumulatedCards.push({ id, name, query, cached: Boolean(obj.cached), articles: [] });
        } else if (obj.articles) {
          const articles = (obj.articles || []) as ArticleSummary[];
          const cardIdx = accumulatedCards.findIndex(c => c.id === currentCardId);
          if (cardIdx >= 0) accumulatedCards[cardIdx] = { ...accumulatedCards[cardIdx], articles };
        } else if (obj.reasoning) {
          phase = "thinking";
          reasoning += obj.reasoning;
          reasoningContent += obj.reasoning;
        } else if (obj.delta) {
          phase = "thinking";
          flushReasoning();
          content += obj.delta;
        } else if (obj.done && obj.messages) {
          finalMessages = normalizeMessages([...finalMessages, ...(obj.messages as ChatMessage[])]);
        }
        syncDraftAcc();
      } catch {
        // Ignore one malformed SSE line and keep consuming the stream.
      }
    };

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        signal: abortController.signal,
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
      let eventData: string[] = [];

      const flushSseEvent = () => {
        if (!eventData.length) return;
        handleSseData(eventData.join("\n"));
        eventData = [];
      };

      const handleSseLine = (rawLine: string) => {
        const line = rawLine.replace(/\r$/, "");
        if (!line) {
          flushSseEvent();
          return;
        }
        if (line.startsWith("data:")) {
          eventData.push(line.slice(5).replace(/^ /, ""));
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          handleSseLine(line);
        }
      }
      buffer += decoder.decode();
      if (buffer) {
        const lines = buffer.split("\n");
        for (const line of lines) {
          handleSseLine(line);
        }
      }
      flushSseEvent();

      flushReasoning();
      phase = "done";
      draftAccRef.current = { content, reasoning: "", steps, phase, typing: false };
      localCardsRef.current = accumulatedCards;
      localActivityStepsRef.current = steps;
      localDebugLogRef.current = accumulatedDebugLog;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      flushStreamState();

      if (deletedSessionIdsRef.current.has(sessionId)) return;
      const cleanFinalMessages = attachReasoningToLastAssistant(
        mergeStreamedAssistantContent(finalMessages, content, reasoningContent, assistantId),
        reasoningContent,
      );
      setMessages(cleanFinalMessages);
      setCards(accumulatedCards);
      setDebugLog(accumulatedDebugLog);
      persistActiveSession(sessionId, cleanFinalMessages);
    } catch (e) {
      if (deletedSessionIdsRef.current.has(sessionId)) {
        draftAccRef.current = null;
        return;
      }
      const failed: UiChatMessage = {
        id: assistantId,
        role: "assistant",
        content: `请求失败: ${e instanceof Error ? e.message : "未知错误"}`,
        stream: {
          content: `请求失败: ${e instanceof Error ? e.message : "未知错误"}`,
          reasoning: "",
          steps: [],
          phase: "done",
          typing: false,
          error: "1",
        },
      };
      setMessages([...previousMessages, failed]);
      persistActiveSession(sessionId, previousMessages);
      draftAccRef.current = null;
    } finally {
      if (abortControllerRef.current === abortController) abortControllerRef.current = null;
      streamMessageIdRef.current = null;
      setStreaming(false);
    }
  }, [debug, effort, flushStreamState, maxRounds, model, pastedImages, persistActiveSession, scheduleFlush]);

  const visibleMessages = useMemo(
    () => messages.filter(isVisibleMessage),
    [messages],
  );

  const runtime = useExternalStoreRuntime<UiChatMessage>({
    isRunning: streaming,
    messages: visibleMessages,
    convertMessage: toThreadMessage,
    onNew: sendMessage,
  });

  const chatViewClass = useMemo(() => sidebarCollapsed ? "collapsed" : "", [sidebarCollapsed]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div id="chat-view" className={chatViewClass}>
        <div className="chat-main">
          <AssistantThread
            isEmpty={visibleMessages.length === 0}
            pastedImages={pastedImages}
            streaming={streaming}
            model={model}
            effort={effort}
            maxRounds={maxRounds}
            debug={debug}
            cacheStats={cacheStats}
            quotaInfo={quotaInfo}
            isAdmin={Boolean(user.is_admin)}
            onModelChange={setModel}
            onEffortChange={setEffort}
            onMaxRoundsChange={setMaxRounds}
            onDebugChange={setDebug}
            onDebugOpen={openDebug}
            onOpenActivity={expandSidebar}
            onAddImages={addImageFiles}
            onPaste={onPaste}
            onRemoveImage={removePastedImage}
          />
        </div>
        <ToolSidebar steps={activitySteps} cards={cards} onCollapse={collapseSidebar} onReadArticle={openArticle} />
      </div>
      {articleId && <ArticleModal articleId={articleId} onClose={closeArticle} />}
      {debugOpen && <DebugModal messages={window.__debugMessages || stripRuntimeFields(messages)} debugLog={debugLog} onClose={closeDebug} />}
    </AssistantRuntimeProvider>
  );
}

const AssistantThread = memo(function AssistantThread({
  isEmpty,
  pastedImages,
  streaming,
  model,
  effort,
  maxRounds,
  debug,
  cacheStats,
  quotaInfo,
  isAdmin,
  onModelChange,
  onEffortChange,
  onMaxRoundsChange,
  onDebugChange,
  onDebugOpen,
  onOpenActivity,
  onAddImages,
  onPaste,
  onRemoveImage,
}: {
  isEmpty: boolean;
  pastedImages: string[];
  streaming: boolean;
  model: string;
  effort: string;
  maxRounds: number;
  debug: boolean;
  cacheStats: DsCacheStats;
  quotaInfo: QuotaInfo;
  isAdmin: boolean;
  onModelChange: (value: string) => void;
  onEffortChange: (value: string) => void;
  onMaxRoundsChange: (value: number) => void;
  onDebugChange: (value: boolean) => void;
  onDebugOpen: () => void;
  onOpenActivity: () => void;
  onAddImages: (files: FileList | File[]) => void;
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onRemoveImage: (idx: number) => void;
}) {
  return (
    <>
    <ThreadPrimitive.Root className={`aui-thread-root${isEmpty ? " is-empty" : ""}`}>
      <ThreadPrimitive.Viewport className="aui-thread-viewport" turnAnchor="top">
        <div className="aui-thread-inner">
          <AuiIf condition={(state) => state.thread.isEmpty}>
            <div className="chat-empty">向 AI 助手提问，基于清风文章库检索回答</div>
          </AuiIf>
          <div className="aui-message-list">
            <ThreadPrimitive.Messages>{() => <ThreadMessage onOpenActivity={onOpenActivity} />}</ThreadPrimitive.Messages>
          </div>
          <ThreadPrimitive.ViewportFooter className="aui-thread-footer">
            <ThreadPrimitive.ScrollToBottom asChild>
              <button className="scroll-bottom-btn" title="滚动到底部" type="button">
                <ArrowDown size={16} />
              </button>
            </ThreadPrimitive.ScrollToBottom>
            <Composer
              pastedImages={pastedImages}
              streaming={streaming}
              model={model}
              effort={effort}
              maxRounds={maxRounds}
              debug={debug}
              cacheStats={cacheStats}
              quotaInfo={quotaInfo}
              isAdmin={isAdmin}
              onModelChange={onModelChange}
              onEffortChange={onEffortChange}
              onMaxRoundsChange={onMaxRoundsChange}
              onDebugChange={onDebugChange}
              onDebugOpen={onDebugOpen}
              onAddImages={onAddImages}
              onPaste={onPaste}
              onRemoveImage={onRemoveImage}
            />
          </ThreadPrimitive.ViewportFooter>
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
    {isEmpty && (
      <div className="chat-disclaimer">
        免责声明：内容来源于互联网公开信息搜集，仅供参考交流，不构成任何投资建议。市场有风险，决策需独立。
      </div>
    )}
  </>
  );
});

const Composer = memo(function Composer({
  pastedImages,
  streaming,
  model,
  effort,
  maxRounds,
  debug,
  cacheStats,
  quotaInfo,
  isAdmin,
  onModelChange,
  onEffortChange,
  onMaxRoundsChange,
  onDebugChange,
  onDebugOpen,
  onAddImages,
  onPaste,
  onRemoveImage,
}: {
  pastedImages: string[];
  streaming: boolean;
  model: string;
  effort: string;
  maxRounds: number;
  debug: boolean;
  cacheStats: DsCacheStats;
  quotaInfo: QuotaInfo;
  isAdmin: boolean;
  onModelChange: (value: string) => void;
  onEffortChange: (value: string) => void;
  onMaxRoundsChange: (value: number) => void;
  onDebugChange: (value: boolean) => void;
  onDebugOpen: () => void;
  onAddImages: (files: FileList | File[]) => void;
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onRemoveImage: (idx: number) => void;
}) {
  const composerRuntime = useComposerRuntime();
  const canSend = useAuiState(state => state.composer.canSend);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMultiline, setIsMultiline] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const plusRef = useRef<HTMLButtonElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const syncInputRows = useCallback((input: HTMLTextAreaElement | null) => {
    if (!input) {
      setIsMultiline(false);
      return;
    }
    const style = window.getComputedStyle(input);
    const fontSize = Number.parseFloat(style.fontSize) || 16;
    const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.45;
    const paddingTop = Number.parseFloat(style.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
    setIsMultiline(input.scrollHeight > lineHeight + paddingTop + paddingBottom + 2);
  }, []);
  const send = useCallback(() => {
    if (pastedImages.length && !composerRuntime.getState().text.trim()) {
      composerRuntime.setText("[图片]");
    }
    setMenuOpen(false);
    setIsMultiline(false);
    composerRuntime.send();
  }, [composerRuntime, pastedImages.length]);

  const openImagePicker = useCallback(() => {
    imageInputRef.current?.click();
  }, []);

  const onImageInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files?.length) onAddImages(files);
    event.target.value = "";
  }, [onAddImages]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target) || plusRef.current?.contains(target)) return;
      if ((target as Element).closest?.("[data-slot='select-content']")) return;
      setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  return (
    <ComposerPrimitive.Root className="aui-composer-root">
      <div className={`aui-composer-shell${isMultiline ? " is-multiline" : ""}`}>
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
        <button
          ref={plusRef}
          type="button"
          className={`composer-plus-btn${menuOpen ? " is-open" : ""}`}
          title="更多选项"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(open => !open)}
        >
          <Plus size={20} />
        </button>
        {menuOpen && (
          <div className="composer-menu" ref={menuRef}>
            <div className="composer-menu-row">
              <span>模型</span>
              <Select value={model} onValueChange={onModelChange}>
                <SelectTrigger aria-label="选择模型" className="composer-select-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="deepseek-v4-flash">DeepSeek v4 Flash</SelectItem>
                  <SelectItem value="deepseek-v4-pro">DeepSeek v4 Pro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="composer-menu-row">
              <span>思考强度</span>
              <Select value={effort} onValueChange={onEffortChange}>
                <SelectTrigger aria-label="选择思考强度" className="composer-select-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">高思考</SelectItem>
                  <SelectItem value="max">最强思考</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="composer-menu-row">
              <span>工具轮数</span>
              <input
                type="number"
                value={maxRounds}
                min="1"
                max="50"
                onChange={e => onMaxRoundsChange(Number(e.target.value) || 10)}
              />
            </label>
            <div className="composer-menu-note">
              图片可点击按钮选择，也可直接粘贴到输入框。
            </div>
            <CacheRing stats={cacheStats} />
            <QuotaRing info={quotaInfo} isAdmin={isAdmin} />
            {isAdmin && (
              <>
                <label className="composer-menu-row switch-row">
                  <span>调试模式</span>
                  <input type="checkbox" checked={debug} onChange={e => onDebugChange(e.target.checked)} />
                </label>
                <button className="composer-menu-action" type="button" onClick={onDebugOpen}>
                  <Bug size={15} /> 查看调试上下文
                </button>
              </>
            )}
          </div>
        )}
        <ComposerPrimitive.Input
          ref={composerInputRef}
          rows={1}
          autoFocus
          className="aui-composer-input"
          placeholder="有问题，尽管问"
          submitMode="enter"
          addAttachmentOnPaste={false}
          onInput={event => syncInputRows(event.currentTarget)}
          onPaste={onPaste}
          aria-label="输入问题"
        />
        <div className="aui-composer-actions">
          <input
            ref={imageInputRef}
            className="image-upload-input"
            type="file"
            accept="image/*"
            multiple
            onChange={onImageInputChange}
          />
          <button
            type="button"
            className="image-upload-btn"
            title="添加图片"
            aria-label="添加图片"
            disabled={streaming}
            onClick={openImagePicker}
          >
            <ImageIcon size={15} />
            {pastedImages.length > 0 && <span>{pastedImages.length}</span>}
          </button>
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

const ThreadMessage = memo(function ThreadMessage({ onOpenActivity }: { onOpenActivity: () => void }) {
  const role = useAuiState(state => state.message.role);
  return role === "user" ? <UserMessage /> : <AssistantMessage onOpenActivity={onOpenActivity} />;
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

const AssistantMessage = memo(function AssistantMessage({ onOpenActivity }: { onOpenActivity: () => void }) {
  const original = useAuiState(state => getExternalStoreMessages<UiChatMessage>(state.message)[0]);
  return (
    <MessagePrimitive.Root className={`aui-message assistant${original?.stream?.typing ? " typing" : ""}${original?.stream?.error ? " error" : ""}`}>
      <div className="aui-message-role">AI</div>
      <div className="aui-message-body">
        {original?.stream && <StreamThoughts draft={original.stream} onOpenActivity={onOpenActivity} />}
        {!original?.stream && original?.reasoning_content && <CompletedThoughts onOpenActivity={onOpenActivity} />}
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
  return (
    <MarkdownTextPrimitive
      remarkPlugins={markdownRemarkPlugins}
      components={markdownComponents}
      preprocess={normalizeChatMarkdown}
      className="markdown-body"
    />
  );
});

function thoughtStatusText(draft: AssistantDraft) {
  if (draft.error) return "思考中断";
  if (!draft.typing) return "思考完成";
  return draft.phase === "tool" ? "调用工具" : "正在思考";
}

const StreamThoughts = memo(function StreamThoughts({ draft, onOpenActivity }: { draft: AssistantDraft; onOpenActivity: () => void }) {
  if (!draft.typing && !draft.steps.length && !draft.reasoning) return null;
  const toolCount = draft.steps.filter(step => step.type === "tool").length;
  const isActive = draft.typing && !draft.error;
  return (
    <div className="msg-think">
      <button className={`thinking-status${isActive ? " is-active" : ""}`} type="button" onClick={onOpenActivity}>
        <span className="thinking-status-label">{thoughtStatusText(draft)}</span>
        {toolCount ? <span> · {toolCount} 次工具调用</span> : null}
      </button>
      {draft.reasoning && <div className="think-preview">{draft.reasoning}</div>}
    </div>
  );
});

const CompletedThoughts = memo(function CompletedThoughts({ onOpenActivity }: { onOpenActivity: () => void }) {
  return (
    <div className="msg-think completed-think">
      <button className="thinking-status" type="button" onClick={onOpenActivity}>
        <span className="thinking-status-label">思考完成</span>
      </button>
    </div>
  );
});

const ToolSidebar = memo(function ToolSidebar({ steps, cards, onCollapse, onReadArticle }: {
  steps: ActivityStep[];
  cards: ToolCardData[];
  onCollapse: () => void;
  onReadArticle: (id: string) => void;
}) {
  let toolIndex = 0;
  return (
    <aside className="chat-sidebar tool-sidebar">
      <div className="tool-sidebar-title">
        <span>活动</span>
        <button className="icon-btn" title="收起工具调用" onClick={onCollapse}><PanelRightClose size={15} /></button>
      </div>
      <div className="tool-activity-section">
        <div className="tool-activity-title">思考</div>
        <div className="tool-activity-subtitle">{steps.length ? "正在记录模型思考与工具调用" : "等待工具调用..."}</div>
      </div>
      {steps.map((step, index) => {
        const card = step.type === "tool" ? cards[toolIndex++] : null;
        return (
          <div className={`activity-step ${step.type === "tool" ? "activity-tool" : "activity-think"}`} key={`${step.type}-${index}`}>
            <div className="activity-step-label">{step.type === "tool" ? "工具调用" : "模型思考"}</div>
            <div className="activity-step-body" dangerouslySetInnerHTML={{ __html: step.text }} />
            {card && (
              <div className="tool-card">
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
            )}
          </div>
        );
      })}
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

const QuotaRing = memo(function QuotaRing({ info, isAdmin }: { info: QuotaInfo; isAdmin: boolean }) {
  if (isAdmin || !info.cap) return null;
  const drained = info.balance <= 0;
  const ratio = drained ? 0 : Math.min(info.balance / info.cap, 1);
  const pct = Math.round(ratio * 100);
  const circum = 2 * Math.PI * 8;
  const dashLen = (pct / 100) * circum;
  const low = ratio < 0.2;
  const color = drained ? "#e04040" : low ? "#f0a030" : "#4a90d9";
  const fmt = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}K`;
  const recoveryMin = drained && info.refill_rate > 0
    ? Math.ceil((Math.abs(info.balance) / info.refill_rate) * 60)
    : 0;
  const recoveryText = recoveryMin > 0
    ? recoveryMin >= 60 ? `${Math.ceil(recoveryMin / 60)}h` : `${recoveryMin}min`
    : "";
  return (
    <div className="cache-ring" title={drained
      ? `限额不足，约 ${recoveryText} 后恢复`
      : `剩余额度 ${fmt(info.balance)} / ${fmt(info.cap)}`}>
      {drained ? (
        <span style={{ color: "#e04040", fontWeight: 500, fontSize: ".75rem" }}>
          限额不足{recoveryText ? ` ${recoveryText}` : ""}
        </span>
      ) : (
        <>
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="10" cy="10" r="8" fill="none" stroke="var(--border)" strokeWidth="3" />
            <circle
              cx="10" cy="10" r="8" fill="none" stroke={color} strokeWidth="3"
              strokeDasharray={`${dashLen} ${circum}`}
              strokeLinecap="butt"
              transform="rotate(-90 10 10)"
            />
          </svg>
          <span className="cache-ring-label">{fmt(info.balance)}</span>
        </>
      )}
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
