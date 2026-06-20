import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  BarChart3,
  BookOpen,
  Menu,
  MessageSquare,
  MessageSquarePlus,
  Moon,
  MoreHorizontal,
  PanelLeft,
  RefreshCw,
  Search,
  Sparkles,
  Sun,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import { api, clearToken, getToken } from "./api";
import ChatPage from "./pages/ChatPage";
import DynamicsPage from "./pages/DynamicsPage";
import LoginPage from "./pages/LoginPage";
import StocksPage from "./pages/StocksPage";
import ProfilePage from "./pages/ProfilePage";
import VerifyPage from "./pages/VerifyPage";
import {
  deleteRemoteChatSession,
  fetchChatSessions,
  getStoredActiveId,
  importLocalChatSessions,
  loadChatSessions,
  mergeChatSessions,
  saveChatSessions,
  setStoredActiveId,
} from "./chatStorage";
import type { ChatSession, CurrentUser } from "./types";

const THEME_KEY = "qf_theme";
const HELP_DYNAMIC_ID = "00001";

type ThemeMode = "light" | "dark";
type SessionMenuState = { id: string; top: number; left: number };

function getRoute() {
  const hash = window.location.hash.replace(/^#/, "");
  return hash || "/chat";
}

function setRoute(path: string) {
  window.location.hash = path;
}

function getInitialTheme(): ThemeMode {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function App() {
  const [route, setCurrentRoute] = useState(getRoute);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [crawlText, setCrawlText] = useState("刷新爬虫");
  const [crawlDisabled, setCrawlDisabled] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [openSessionMenu, setOpenSessionMenu] = useState<SessionMenuState | null>(null);
  const crawlCooldown = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const checkAuth = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setSessions([]);
      setActiveSessionId(null);
      setLoading(false);
      return null;
    }
    setLoading(true);
    const currentUser = await api.get<CurrentUser>("/api/auth/me").catch(() => null);
    setUser(currentUser);
    if (!currentUser) {
      setSessions([]);
      setActiveSessionId(null);
    }
    setLoading(false);
    return currentUser;
  }, []);

  const refreshSessions = useCallback(async (email?: string | null) => {
    if (!email || !getToken()) {
      setSessions([]);
      setActiveSessionId(null);
      return;
    }
    try {
      const localSessions = loadChatSessions(email);
      setSessions(localSessions);
      setActiveSessionId(getStoredActiveId(email));

      const remoteSessions = localSessions.length
        ? await importLocalChatSessions(localSessions)
        : await fetchChatSessions();
      const merged = mergeChatSessions(remoteSessions, localSessions);
      saveChatSessions(merged, email);
      setSessions(merged);
      setActiveSessionId(getStoredActiveId(email));
    } catch {
      try {
        setSessions(loadChatSessions(email));
        setActiveSessionId(getStoredActiveId(email));
      } catch {
        saveChatSessions([], email);
        setSessions([]);
        setActiveSessionId(null);
      }
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      const currentUser = await checkAuth();
      if (!cancelled) refreshSessions(currentUser?.email);
    };
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [checkAuth, refreshSessions]);

  useEffect(() => {
    const onHashChange = () => {
      setCurrentRoute(getRoute());
      setSidebarOpen(false);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    const onSessionsChanged = () => {
      refreshSessions(user?.email);
      setActiveSessionId(getStoredActiveId(user?.email));
    };
    window.addEventListener("chat-sessions-changed", onSessionsChanged);
    window.addEventListener("storage", onSessionsChanged);
    return () => {
      window.removeEventListener("chat-sessions-changed", onSessionsChanged);
      window.removeEventListener("storage", onSessionsChanged);
    };
  }, [refreshSessions, user?.email]);

  useEffect(() => {
    if (!searchOpen) return;
    const timer = window.setTimeout(() => searchInputRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [searchOpen]);

  useEffect(() => {
    if (!openSessionMenu) return;
    const closeMenu = () => setOpenSessionMenu(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, [openSessionMenu]);

  const triggerCrawl = useCallback(async () => {
    const now = Date.now();
    if (now - crawlCooldown.current < 60000) {
      setCrawlText(`冷却 ${Math.ceil((60000 - (now - crawlCooldown.current)) / 1000)}s`);
      return;
    }
    setCrawlText("爬取中...");
    setCrawlDisabled(true);
    try {
      await api.get("/api/crawl");
      setCrawlText("已触发");
      crawlCooldown.current = Date.now();
      window.location.reload();
    } catch (e) {
      setCrawlText(e instanceof Error && e.message === "未付费" ? "仅管理员" : "失败");
    }
    window.setTimeout(() => {
      setCrawlText("刷新爬虫");
      setCrawlDisabled(false);
    }, 3000);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
    setSessions([]);
    setActiveSessionId(null);
    setRoute("/login");
  }, []);

  const onLogin = useCallback(async () => {
    const currentUser = await checkAuth();
    await refreshSessions(currentUser?.email);
    setRoute("/chat");
  }, [checkAuth, refreshSessions]);

  const navigate = useCallback((path: string) => {
    setCurrentRoute(path);
    if (getRoute() !== path) setRoute(path);
    setSidebarOpen(false);
  }, []);

  const startNewChat = useCallback(() => {
    setStoredActiveId(null, user?.email);
    setActiveSessionId(null);
    if (route !== "/chat") navigate("/chat");
    window.dispatchEvent(new CustomEvent("chat-new-session"));
    setSidebarOpen(false);
    setSearchOpen(false);
  }, [navigate, route, user?.email]);

  const loadSession = useCallback((id: string) => {
    setStoredActiveId(id, user?.email);
    setActiveSessionId(id);
    if (route !== "/chat") navigate("/chat");
    window.dispatchEvent(new CustomEvent("chat-load-session", { detail: { id } }));
    setSidebarOpen(false);
    setSearchOpen(false);
    setOpenSessionMenu(null);
  }, [navigate, route, user?.email]);

  const deleteSession = useCallback((id: string) => {
    const activeId = getStoredActiveId(user?.email);
    const nextSessions = loadChatSessions(user?.email).filter(session => session.id !== id);
    saveChatSessions(nextSessions, user?.email);
    setSessions(nextSessions);
    setOpenSessionMenu(null);
    if (activeId === id) {
      setStoredActiveId(null, user?.email);
      setActiveSessionId(null);
      window.dispatchEvent(new CustomEvent("chat-session-deleted", { detail: { id } }));
    }
    deleteRemoteChatSession(id)
      .then(() => refreshSessions(user?.email))
      .catch(() => undefined);
  }, [refreshSessions, user?.email]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === "dark" ? "light" : "dark");
  }, []);

  const recentSessions = useMemo(
    () => [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12),
    [sessions],
  );

  const searchableSessions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!query) return sorted;
    return sorted.filter(session => session.title.toLowerCase().includes(query));
  }, [searchQuery, sessions]);

  if (loading) return <main className="auth-screen"><div className="loading">加载中...</div></main>;
  if (!user) return <main className="auth-screen"><LoginPage onLogin={onLogin} theme={theme} onToggleTheme={toggleTheme} /></main>;

  return (
    <div className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}${sidebarOpen ? " sidebar-open" : ""}`}>
      <button className="mobile-menu-btn" type="button" title="打开侧边栏" onClick={() => setSidebarOpen(true)}>
        <Menu size={20} />
      </button>
      <aside className={`app-sidebar${sidebarOpen ? " open" : ""}`}>
        <div className="sidebar-top">
          <button className="brand-row" type="button" onClick={() => navigate("/chat")}>
            <Sparkles size={20} />
            <span>清风 AI</span>
          </button>
          <div className="sidebar-tools">
            <button className="icon-btn" type="button" title="切换主题" onClick={toggleTheme}>
              {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <button
              className="icon-btn desktop-only"
              type="button"
              title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
              onClick={() => setSidebarCollapsed(value => !value)}
            >
              <PanelLeft size={17} />
            </button>
            <button className="icon-btn mobile-only" type="button" title="关闭侧边栏" onClick={() => setSidebarOpen(false)}>
              <X size={17} />
            </button>
          </div>
        </div>

        <button className="sidebar-primary" type="button" onClick={startNewChat}>
          <MessageSquarePlus size={19} />
          <span>新聊天</span>
        </button>

        <nav className="sidebar-nav" aria-label="主功能">
          <button
            className="sidebar-nav-item"
            type="button"
            onClick={() => {
              setSearchOpen(true);
              setSidebarOpen(false);
            }}
          >
            <Search size={19} />
            <span>搜索聊天</span>
          </button>
          <button className={`sidebar-nav-item${route === "/dynamics" ? " active" : ""}`} type="button" onClick={() => navigate("/dynamics")}>
            <TrendingUp size={19} />
            <span>动态</span>
          </button>
          <button className={`sidebar-nav-item${route === "/help" ? " active" : ""}`} type="button" onClick={() => navigate("/help")}>
            <BookOpen size={19} />
            <span>帮助文档</span>
          </button>
          <button className={`sidebar-nav-item${route === "/stocks" ? " active" : ""}`} type="button" onClick={() => navigate("/stocks")}>
            <BarChart3 size={19} />
            <span>股票</span>
          </button>
        </nav>

        <div className="sidebar-section">
          <div className="sidebar-section-title">最近</div>
          <div className="recent-list">
            {recentSessions.length ? recentSessions.map(session => (
              <div
                className={`recent-row${route === "/chat" && activeSessionId === session.id ? " active" : ""}${openSessionMenu?.id === session.id ? " menu-open" : ""}`}
                key={session.id}
              >
                <button
                  className="recent-item"
                  type="button"
                  title={session.title}
                  onClick={() => loadSession(session.id)}
                >
                  <span>{session.title}</span>
                </button>
                <button
                  className="recent-more"
                  type="button"
                  title="更多"
                  aria-haspopup="menu"
                  aria-expanded={openSessionMenu?.id === session.id}
                  onClick={event => {
                    event.stopPropagation();
                    const rect = event.currentTarget.getBoundingClientRect();
                    const menuWidth = 128;
                    const menuHeight = 48;
                    const topBelow = rect.bottom + 4;
                    const top = topBelow + menuHeight > window.innerHeight - 8 ? rect.top - menuHeight - 4 : topBelow;
                    const left = Math.min(Math.max(8, rect.right - menuWidth), window.innerWidth - menuWidth - 8);
                    setOpenSessionMenu(value => value?.id === session.id ? null : { id: session.id, top, left });
                  }}
                >
                  <MoreHorizontal size={18} />
                </button>
                {openSessionMenu?.id === session.id && (
                  <div
                    className="recent-menu"
                    role="menu"
                    style={{ top: openSessionMenu.top, left: openSessionMenu.left }}
                    onClick={event => event.stopPropagation()}
                  >
                    <button className="recent-menu-item danger" type="button" role="menuitem" onClick={() => deleteSession(session.id)}>
                      <Trash2 size={17} />
                      <span>删除</span>
                    </button>
                  </div>
                )}
              </div>
            )) : <div className="sidebar-empty">暂无对话</div>}
          </div>
        </div>

        <div className="sidebar-footer">
          {user.is_admin && (
            <button className="sidebar-nav-item" type="button" onClick={triggerCrawl} disabled={crawlDisabled}>
              <RefreshCw size={18} />
              <span>{crawlText}</span>
            </button>
          )}
          <button className="account-row" type="button" onClick={() => navigate("/profile")}>
            <span className="avatar">{user.email.slice(0, 1).toUpperCase()}</span>
            <span className="account-main">
              <span>{user.email}</span>
              <small>{user.is_admin ? "Admin" : user.role === "pro" ? "Pro" : user.role === "plus" ? "Plus" : user.is_verified ? "未付费" : "未验证"}</small>
            </span>
          </button>
        </div>
      </aside>
      {sidebarOpen && <button className="sidebar-scrim" type="button" aria-label="关闭侧边栏" onClick={() => setSidebarOpen(false)} />}
      <main className="app-main" id="app">
        {route === "/profile" ? (
          <ProfilePage user={user} onLogout={logout} onRefresh={checkAuth} />
        ) : route === "/verify" ? (
          <VerifyPage onVerified={() => { checkAuth(); setRoute("/dynamics"); }} />
        ) : route === "/stocks" ? (
          <StocksPage userRole={user.role} />
        ) : route === "/dynamics" ? (
          <DynamicsPage />
        ) : route === "/help" ? (
          <DynamicsPage dynamicId={HELP_DYNAMIC_ID} title="帮助文档" description="清风 AI 使用说明" />
        ) : (
          <ChatPage key={user.email} user={user} />
        )}
      </main>
      {searchOpen && (
        <SearchDialog
          query={searchQuery}
          inputRef={searchInputRef}
          sessions={searchableSessions}
          onQueryChange={setSearchQuery}
          onClose={() => setSearchOpen(false)}
          onNewChat={startNewChat}
          onLoadSession={loadSession}
        />
      )}
    </div>
  );
}

function SearchDialog({
  query,
  inputRef,
  sessions,
  onQueryChange,
  onClose,
  onNewChat,
  onLoadSession,
}: {
  query: string;
  inputRef: RefObject<HTMLInputElement | null>;
  sessions: ChatSession[];
  onQueryChange: (value: string) => void;
  onClose: () => void;
  onNewChat: () => void;
  onLoadSession: (id: string) => void;
}) {
  return (
    <div className="search-dialog-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="search-dialog" role="dialog" aria-modal="true" aria-label="搜索聊天">
        <div className="search-dialog-head">
          <Search size={20} />
          <input
            ref={inputRef}
            value={query}
            placeholder="搜索聊天..."
            onChange={event => onQueryChange(event.target.value)}
          />
          <button className="search-dialog-close" type="button" title="关闭" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="search-dialog-body">
          <button className="search-dialog-primary" type="button" onClick={onNewChat}>
            <MessageSquarePlus size={19} />
            <span>新聊天</span>
          </button>
          <div className="search-dialog-section">最近</div>
          {sessions.length ? sessions.map(session => (
            <button
              className="search-dialog-item"
              type="button"
              key={session.id}
              title={session.title}
              onClick={() => onLoadSession(session.id)}
            >
              <MessageSquare size={19} />
              <span>{session.title}</span>
            </button>
          )) : <div className="search-dialog-empty">没有匹配的聊天</div>}
        </div>
      </section>
    </div>
  );
}
