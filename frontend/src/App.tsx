import { useCallback, useEffect, useRef, useState } from "react";
import { api, clearToken, getToken } from "./api";
import ChatPage from "./pages/ChatPage";
import DynamicsPage from "./pages/DynamicsPage";
import LoginPage from "./pages/LoginPage";
import type { CurrentUser } from "./types";

function getRoute() {
  const hash = window.location.hash.replace(/^#/, "");
  return hash || "/dynamics";
}

export default function App() {
  const [route, setRoute] = useState(getRoute);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [crawlText, setCrawlText] = useState("刷新爬虫");
  const [crawlDisabled, setCrawlDisabled] = useState(false);
  const crawlCooldown = useRef(0);

  const checkAuth = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const currentUser = await api.get<CurrentUser>("/api/auth/me").catch(() => null);
    setUser(currentUser);
    setLoading(false);
  }, []);

  useEffect(() => {
    checkAuth();
    const onHashChange = () => {
      setRoute(getRoute());
      checkAuth();
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [checkAuth]);

  async function triggerCrawl() {
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
  }

  function logout() {
    clearToken();
    setUser(null);
    window.location.hash = "#/login";
  }

  const showNav = user && user.role !== "unpaid";

  return (
    <>
      {showNav && (
        <nav id="nav">
          <div className="inner">
            <a href="#/dynamics" className={route !== "/chat" ? "active" : ""}>动态</a>
            <a href="#/chat" className={route === "/chat" ? "active" : ""}>对话</a>
            <div className="user">
              <span className="user-email">{user.email}</span>
              {user.is_admin && (
                <button className="crawl-btn" onClick={triggerCrawl} disabled={crawlDisabled}>
                  {crawlText}
                </button>
              )}
              <button id="logout-btn" onClick={logout}>退出</button>
            </div>
          </div>
        </nav>
      )}
      <main className="container" id="app">
        {loading ? (
          <div className="loading">加载中...</div>
        ) : !user ? (
          <LoginPage onLogin={checkAuth} />
        ) : user.role === "unpaid" ? (
          <LockPage user={user} onLogout={logout} />
        ) : route === "/chat" ? (
          <ChatPage user={user} />
        ) : (
          <DynamicsPage />
        )}
      </main>
    </>
  );
}

function LockPage({ user, onLogout }: { user: CurrentUser; onLogout: () => void }) {
  return (
    <div className="login-box">
      <h1>B站动态存档</h1>
      <p style={{ fontSize: "1.2rem", margin: "1rem 0" }}>🔒</p>
      <p>{user.email}</p>
      <p style={{ color: "var(--muted)", marginTop: "0.5rem" }}>尚未解锁，请联系管理员</p>
      <button
        onClick={onLogout}
        style={{
          marginTop: "1.5rem",
          padding: "6px 20px",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          background: "var(--card-bg)",
          cursor: "pointer",
          font: "inherit",
          color: "var(--muted)",
        }}
      >
        切换账号
      </button>
    </div>
  );
}
