import { useState, useEffect } from "react";
import type { CurrentUser } from "../types";
import { api } from "../api";

interface ProfilePageProps {
  user: CurrentUser;
  onLogout: () => void;
}

function formatQuota(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function getRoleLabel(role: string): string {
  switch (role) {
    case "admin": return "Admin";
    case "pro": return "Pro";
    case "plus": return "Plus";
    default: return "未付费";
  }
}

function getRoleBadgeStyle(role: string): React.CSSProperties {
  switch (role) {
    case "admin": return { background: "#ef4444", color: "#fff" };
    case "pro": return { background: "#8b5cf6", color: "#fff" };
    case "plus": return { background: "#f59e0b", color: "#fff" };
    default: return { background: "#6b7280", color: "#fff" };
  }
}

function AfdianSection({ user }: { user: CurrentUser }) {
  const [afdianUid, setAfdianUid] = useState("");
  const [binding, setBinding] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const showMsg = (text: string, ok: boolean) => {
    setMsg({ text, ok });
    setTimeout(() => setMsg(null), 4000);
  };

  const handleUpgrade = async (plan: "plus" | "pro") => {
    try {
      const res = await api.get<{ pay_url: string }>(`/api/afdian/link?plan=${plan}`);
      if (res?.pay_url) window.location.href = res.pay_url;
    } catch {
      showMsg("获取支付链接失败", false);
    }
  };

  const handleBind = async () => {
    if (!afdianUid.trim()) return showMsg("请输入爱发电用户 ID", false);
    setBinding(true);
    try {
      const res = await api.post<{ ok: boolean; error?: string }>("/api/afdian/bind", {
        afdian_user_id: afdianUid.trim(),
      });
      if (res?.ok) {
        showMsg("绑定成功，请点击同步", true);
        setAfdianUid("");
      } else {
        showMsg(res?.error || "绑定失败", false);
      }
    } catch {
      showMsg("绑定失败", false);
    } finally {
      setBinding(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await api.post<{ ok: boolean; error?: string; role?: string }>("/api/afdian/sync");
      if (res?.ok) {
        showMsg(`同步成功，已激活 ${res.role || ""} 会员`, true);
        // 刷新用户信息
        setTimeout(() => window.location.reload(), 1500);
      } else {
        showMsg(res?.error || "未找到有效赞助记录", false);
      }
    } catch {
      showMsg("同步失败", false);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    const el = document.getElementById("afdian_leaflet_qingfengAIstock");
    if (el) el.setAttribute("width", document.body.clientWidth < 700 ? "100%" : "640");
  }, []);

  const isBound = !!user.afdian_user_id;
  const cardStyle: React.CSSProperties = {
    background: "var(--card-bg)",
    borderRadius: "var(--radius)",
    border: "1px solid var(--border)",
    padding: "1rem 1.25rem",
    marginBottom: "1rem",
  };

  return (
    <div style={cardStyle}>
      <h3 style={{ fontSize: "0.95rem", fontWeight: 600, margin: "0 0 0.8rem" }}>
        爱发电赞助
      </h3>

      {/* Afdian 官方嵌入 */}
      <div style={{ marginBottom: "0.8rem" }}>
        <iframe
          id="afdian_leaflet_qingfengAIstock"
          src="https://ifdian.net/leaflet?slug=qingfengAIstock"
          width="100%"
          scrolling="no"
          height="200"
          frameBorder="0"
          style={{ border: "none", borderRadius: 6 }}
        />
      </div>

      {/* 升级按钮 */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.8rem", flexWrap: "wrap" }}>
        <button
          className="email-btn"
          style={{ flex: "1 1 120px", background: "#f59e0b", color: "#fff", border: "none" }}
          onClick={() => handleUpgrade("plus")}
        >
          开通 Plus
        </button>
        <button
          className="email-btn"
          style={{ flex: "1 1 120px", background: "#8b5cf6", color: "#fff", border: "none" }}
          onClick={() => handleUpgrade("pro")}
        >
          开通 Pro
        </button>
      </div>

      {/* 绑定 + 同步 */}
      {isBound ? (
        <div>
          <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.5rem" }}>
            已绑定: {user.afdian_user_id}
          </div>
          <button
            className="email-btn"
            style={{ width: "100%", background: "var(--accent)", color: "#fff", border: "none" }}
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? "同步中..." : "同步赞助状态"}
          </button>
        </div>
      ) : (
        <div>
          <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.4rem" }}>
            赞助后自动绑定。也可手动输入：
          </div>
          <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.5rem" }}>
            <input
              placeholder="爱发电用户 ID"
              value={afdianUid}
              onChange={(e) => setAfdianUid(e.target.value)}
              style={{
                flex: 1,
                padding: "0.4rem 0.6rem",
                borderRadius: 4,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--text)",
                fontSize: "0.85rem",
              }}
            />
            <button
              className="email-btn"
              style={{ background: "var(--accent)", color: "#fff", border: "none", whiteSpace: "nowrap" }}
              onClick={handleBind}
              disabled={binding}
            >
              {binding ? "..." : "绑定"}
            </button>
          </div>
          <button
            className="email-btn"
            style={{ width: "100%", background: "transparent", color: "var(--accent)", border: "1px solid var(--accent)" }}
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? "同步中..." : "我已赞助，同步状态"}
          </button>
        </div>
      )}

      {msg && (
        <div style={{
          marginTop: "0.6rem",
          padding: "0.3rem 0.6rem",
          borderRadius: 4,
          fontSize: "0.8rem",
          background: msg.ok ? "#dcfce7" : "#fee2e2",
          color: msg.ok ? "#166534" : "#991b1b",
        }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}

function RedeemSection() {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const showMsg = (text: string, ok: boolean) => {
    setMsg({ text, ok });
    setTimeout(() => setMsg(null), 4000);
  };

  const handleRedeem = async () => {
    if (!code.trim()) return showMsg("请输入兑换码", false);
    setLoading(true);
    try {
      const res = await api.post<{ ok: boolean; error?: string; tokens_added?: number; new_balance?: number }>(
        "/api/user/redeem",
        { code: code.trim() }
      );
      if (res?.ok) {
        showMsg(`兑换成功 +${res.tokens_added?.toLocaleString() || ""} tokens`, true);
        setCode("");
        setTimeout(() => window.location.reload(), 1500);
      } else {
        showMsg(res?.error || "兑换失败", false);
      }
    } catch {
      showMsg("兑换失败", false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      background: "var(--card-bg)",
      borderRadius: "var(--radius)",
      border: "1px solid var(--border)",
      padding: "1rem 1.25rem",
      marginBottom: "1rem",
    }}>
      <h3 style={{ fontSize: "0.95rem", fontWeight: 600, margin: "0 0 0.6rem" }}>
        兑换码
      </h3>
      <div style={{ display: "flex", gap: "0.4rem" }}>
        <input
          placeholder="输入兑换码"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          style={{
            flex: 1,
            padding: "0.4rem 0.6rem",
            borderRadius: 4,
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text)",
            fontSize: "0.85rem",
          }}
        />
        <button
          className="email-btn"
          style={{ background: "var(--accent)", color: "#fff", border: "none", whiteSpace: "nowrap" }}
          onClick={handleRedeem}
          disabled={loading}
        >
          {loading ? "..." : "兑换"}
        </button>
      </div>
      {msg && (
        <div style={{
          marginTop: "0.5rem",
          padding: "0.3rem 0.6rem",
          borderRadius: 4,
          fontSize: "0.8rem",
          background: msg.ok ? "#dcfce7" : "#fee2e2",
          color: msg.ok ? "#166534" : "#991b1b",
        }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}

export default function ProfilePage({ user, onLogout }: ProfilePageProps) {
  const roleLabel = getRoleLabel(user.role);
  const roleBadgeStyle = getRoleBadgeStyle(user.role);

  const isVerified = !!user.is_verified;
  const verifyUntilStr = user.verify_until;
  const verifyUntil = verifyUntilStr ? new Date(verifyUntilStr) : null;
  const now = new Date();
  const isVerifyValid = verifyUntil !== null && verifyUntil > now;
  const isVerifyExpired = isVerified && verifyUntil !== null && verifyUntil <= now;

  const isAdmin = user.role === "admin" || user.is_admin === true;
  const showQuota = !isAdmin;
  const balance = user.quota_balance ?? 0;
  const cap = user.quota_cap ?? 0;
  const quotaPercent = showQuota && cap > 0
    ? Math.min(100, (balance / cap) * 100)
    : 0;

  const formatDate = (dateStr: string) => dateStr.slice(0, 10);
  const expireDate = user.role_expire_at ? formatDate(user.role_expire_at) : null;

  const cardStyle: React.CSSProperties = {
    background: "var(--card-bg)",
    borderRadius: "var(--radius)",
    border: "1px solid var(--border)",
    padding: "1rem 1.25rem",
    marginBottom: "1rem",
  };

  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  };

  const badgeBase: React.CSSProperties = {
    display: "inline-block",
    padding: "0.2rem 0.6rem",
    borderRadius: 999,
    fontSize: "0.8rem",
    fontWeight: 500,
  };

  return (
    <div style={{
      maxWidth: 640,
      width: "100%",
      boxSizing: "border-box",
      margin: "2rem auto",
      padding: "0 1rem",
    }}>
      {/* Avatar + Email */}
      <div style={{ textAlign: "center", marginBottom: "2rem" }}>
        <div style={{
          width: 72,
          height: 72,
          borderRadius: "50%",
          background: "var(--accent)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "1.8rem",
          fontWeight: 600,
          margin: "0 auto 1rem",
        }}>
          {user.email.slice(0, 1).toUpperCase()}
        </div>
        <div style={{ fontSize: "1.1rem", fontWeight: 500 }}>{user.email}</div>
      </div>

      {/* Role Badge */}
      <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
        <span style={{
          display: "inline-block",
          padding: "0.25rem 0.75rem",
          borderRadius: 999,
          fontSize: "0.85rem",
          fontWeight: 500,
          ...roleBadgeStyle,
        }}>
          {roleLabel}
        </span>
        {expireDate && (
          <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: 8 }}>
            有效期至 {expireDate}
          </div>
        )}
      </div>

      {/* Afdian — 开通 & 绑定 */}
      {!isAdmin && <AfdianSection user={user} />}

      {/* Redeem Code */}
      {!isAdmin && <RedeemSection />}

      {/* Verification Status */}
      <div style={{ ...cardStyle, ...rowStyle }}>
        <span style={{ fontSize: "0.9rem" }}>B站验证</span>
        {!isVerified ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ ...badgeBase, background: "#ef4444", color: "#fff" }}>
              未验证
            </span>
            <button
              className="email-link"
              onClick={() => { window.location.hash = "#/verify"; }}
              style={{ textDecoration: "none", whiteSpace: "nowrap" }}
            >
              去验证 →
            </button>
          </div>
        ) : isVerifyValid ? (
          <span style={{ ...badgeBase, background: "#22c55e", color: "#fff" }}>
            已验证至 {formatDate(verifyUntilStr!)}
          </span>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ ...badgeBase, background: "#eab308", color: "#fff" }}>
              验证已过期 (至 {formatDate(verifyUntilStr!)})
            </span>
            <button
              className="email-link"
              onClick={() => { window.location.hash = "#/verify"; }}
              style={{ textDecoration: "none", whiteSpace: "nowrap" }}
            >
              重新验证 →
            </button>
          </div>
        )}
      </div>

      {/* Token Quota */}
      {showQuota && (
        <div style={cardStyle}>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: "0.5rem",
            fontSize: "0.9rem",
          }}>
            <span>Token 配额</span>
            <span style={{ color: "var(--muted)" }}>
              {formatQuota(balance)} / {formatQuota(cap)}
            </span>
          </div>
          <div style={{
            width: "100%",
            height: 8,
            borderRadius: 4,
            background: "var(--border)",
            overflow: "hidden",
          }}>
            <div style={{
              height: "100%",
              borderRadius: 4,
              background: "var(--accent)",
              width: `${quotaPercent}%`,
              transition: "width 0.3s ease",
            }} />
          </div>
        </div>
      )}

      {/* Logout */}
      <div style={{ textAlign: "center", marginTop: "2rem" }}>
        <button
          className="email-btn"
          onClick={onLogout}
          style={{
            background: "transparent",
            color: "var(--danger)",
            border: "1px solid var(--danger)",
            width: "100%",
            maxWidth: 640,
          }}
        >
          退出登录
        </button>
      </div>
    </div>
  );
}
