import { useEffect, useState } from "react";
import type { CurrentUser } from "../types";
import { api } from "../api";
import { formatBeijingDate, formatBeijingDateTime } from "../lib/time";

interface ProfilePageProps {
  user: CurrentUser;
  onLogout: () => void;
  onRefresh: () => void;
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

function AlipaySection() {
  const [plans, setPlans] = useState<Array<{plan: string; label: string; unit_price_fen: number; unit_price_label: string}>>([]);
  const [selectedPlan, setSelectedPlan] = useState("plus");
  const [months, setMonths] = useState(1);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const showMsg = (text: string, ok: boolean) => {
    setMsg({ text, ok });
    setTimeout(() => setMsg(null), 4000);
  };

  useEffect(() => {
    api.get<{ plans: typeof plans }>("/api/pay/plans").then(res => {
      if (res?.plans) setPlans(res.plans);
    }).catch(() => {});
  }, []);

  const plan = plans.find(p => p.plan === selectedPlan);
  const totalFen = (plan?.unit_price_fen ?? 0) * months;
  const totalLabel = totalFen % 100 === 0 ? `¥${totalFen / 100}` : `¥${(totalFen / 100).toFixed(2)}`;

  const handlePay = async () => {
    setLoading(true);
    try {
      const res = await api.post<{ order_id: string; pay_url: string }>("/api/pay/create", { plan: selectedPlan, months });
      if (res?.pay_url) window.location.href = res.pay_url;
      else showMsg("创建订单失败", false);
    } catch (e: any) {
      showMsg(e?.message || "创建订单失败", false);
    } finally {
      setLoading(false);
    }
  };

  const cardStyle: React.CSSProperties = {
    background: "var(--card-bg)",
    borderRadius: "var(--radius)",
    border: "1px solid var(--border)",
    padding: "1rem 1.25rem",
    marginBottom: "1rem",
  };

  return (
    <div style={cardStyle}>
      <h3 style={{ fontSize: "0.95rem", fontWeight: 600, margin: "0 0 0.8rem" }}>支付宝支付</h3>

      {/* 方案选择 */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.8rem" }}>
        {plans.map(p => (
          <button
            key={p.plan}
            className="email-btn"
            style={{
              flex: 1,
              background: selectedPlan === p.plan ? (p.plan === "pro" ? "#8b5cf6" : "#1677ff") : "var(--border)",
              color: selectedPlan === p.plan ? "#fff" : "var(--text)",
              border: "none",
              padding: "0.5rem",
            }}
            onClick={() => setSelectedPlan(p.plan)}
          >
            {p.label} ({p.unit_price_label}/月)
          </button>
        ))}
      </div>

      {/* 月数选择 */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.8rem" }}>
        {[1, 3, 6].map(m => (
          <button
            key={m}
            className="email-btn"
            style={{
              flex: 1,
              background: months === m ? "var(--accent)" : "var(--border)",
              color: months === m ? "#fff" : "var(--text)",
              border: "none",
              padding: "0.4rem",
            }}
            onClick={() => setMonths(m)}
          >
            {m}个月
          </button>
        ))}
      </div>

      {/* 总价 + 支付按钮 */}
      <button
        className="email-btn"
        style={{ width: "100%", background: "#1677ff", color: "#fff", border: "none", padding: "0.6rem" }}
        onClick={handlePay}
        disabled={loading}
      >
        {loading ? "创建订单中..." : `支付宝支付 ${totalLabel}`}
      </button>

      {msg && (
        <div style={{
          marginTop: "0.6rem", padding: "0.3rem 0.6rem", borderRadius: 4, fontSize: "0.8rem",
          background: msg.ok ? "#dcfce7" : "#fee2e2", color: msg.ok ? "#166534" : "#991b1b",
        }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}

function AfdianSection({ user }: { user: CurrentUser }) {
  const [afdianUid, setAfdianUid] = useState("");
  const [editing, setEditing] = useState(false);
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
    if (!afdianUid.trim()) return showMsg("请输入爱发电订单号", false);
    setBinding(true);
    try {
      const res = await api.post<{ ok: boolean; error?: string; rebind?: boolean }>("/api/afdian/bind", {
        order_no: afdianUid.trim(),
      });
      if (res?.ok) {
        showMsg(res.rebind ? "已更新绑定" : "绑定成功", true);
        setEditing(false);
        setAfdianUid("");
        setTimeout(() => window.location.reload(), 1000);
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


      {/* 升级按钮 */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.8rem", flexWrap: "wrap" }}>
        <button
          className="email-btn"
          style={{ flex: 1, background: "#f59e0b", color: "#fff", border: "none", padding: "0.45rem 1.25rem" }}
          onClick={() => handleUpgrade("plus")}
        >
          开通 Plus
        </button>
        <button
          className="email-btn"
          style={{ flex: 1, background: "#8b5cf6", color: "#fff", border: "none", padding: "0.45rem 1.25rem" }}
          onClick={() => handleUpgrade("pro")}
        >
          开通 Pro
        </button>
      </div>

      {/* 绑定 + 同步 */}
      {isBound && !editing ? (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
            <span style={{ fontSize: "0.8rem", color: "var(--muted)", flex: 1 }}>
              ID: {user.afdian_user_id}
            </span>
            <button
              className="email-link"
              style={{ color: "#ef4444", whiteSpace: "nowrap" }}
              onClick={() => { setEditing(true); setAfdianUid(user.afdian_user_id || ""); }}
            >
              修改
            </button>
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
          <p style={{ fontSize: "0.8rem", color: "var(--muted)", lineHeight: 1.6, margin: "0 0 0.7rem" }}>
            通过本页按钮赞助后自动绑定，无需手动输入。<br />
            付完款未自动激活？在爱发电找到订单号，输入下方即可绑定并同步。
          </p>
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "stretch" }}>
            <input
              className="email-input"
              placeholder="输入爱发电订单号"
              value={afdianUid}
              onChange={(e) => setAfdianUid(e.target.value)}
              style={{ flex: 1, height: 40, fontSize: "0.85rem" }}
            />
            <button
              className="email-btn"
              style={{ height: 40, background: "var(--accent)", color: "#fff", border: "none", whiteSpace: "nowrap" }}
              onClick={handleBind}
              disabled={binding}
            >
              {binding ? "..." : "绑定"}
            </button>
            {editing && (
              <button
                className="email-btn"
                style={{ height: 40, background: "transparent", color: "var(--muted)", border: "1px solid var(--border)", whiteSpace: "nowrap" }}
                onClick={() => setEditing(false)}
              >
                取消
              </button>
            )}
          </div>
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

function MeowSection({ user }: { user: CurrentUser }) {
  const [meow, setMeow] = useState(user.meow || "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const showMsg = (text: string, ok: boolean) => {
    setMsg({ text, ok });
    setTimeout(() => setMsg(null), 3000);
  };

  const [testing, setTesting] = useState(false);

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await api.post<{ ok: boolean; error?: string }>("/api/user/meow/test");
      showMsg(res?.ok ? "测试推送已发送" : (res?.error || "发送失败"), !!res?.ok);
    } catch {
      showMsg("发送失败", false);
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.post<{ ok: boolean; error?: string }>("/api/user/meow", { meow: meow.trim() });
      if (res?.ok) {
        showMsg("已保存", true);
      } else {
        showMsg(res?.error || "保存失败", false);
      }
    } catch {
      showMsg("保存失败", false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      background: "var(--card-bg)", borderRadius: "var(--radius)",
      border: "1px solid var(--border)", padding: "1rem 1.25rem", marginBottom: "1rem",
    }}>
      <h3 style={{ fontSize: "0.95rem", fontWeight: 600, margin: "0 0 0.6rem" }}>推送通知</h3>
      <div style={{ display: "flex", gap: "0.4rem", alignItems: "stretch" }}>
        <input
          className="email-input"
          placeholder="Meow ID（用于手机推送）"
          value={meow}
          onChange={(e) => setMeow(e.target.value)}
          style={{ flex: 1, height: 40, fontSize: "0.85rem" }}
        />
        <button
          className="email-btn"
          style={{ height: 40, background: "var(--accent)", color: "#fff", border: "none", whiteSpace: "nowrap" }}
          onClick={handleSave} disabled={saving}
        >
          {saving ? "..." : "保存"}
        </button>
        {user.meow && (
          <button
            className="email-btn"
            style={{ height: 40, background: "transparent", color: "var(--accent)", border: "1px solid var(--accent)", whiteSpace: "nowrap" }}
            onClick={handleTest} disabled={testing}
          >
            {testing ? "..." : "测试"}
          </button>
        )}
      </div>
      {msg && (
        <div style={{
          marginTop: "0.5rem", padding: "0.3rem 0.6rem", borderRadius: 4, fontSize: "0.8rem",
          background: msg.ok ? "#dcfce7" : "#fee2e2", color: msg.ok ? "#166534" : "#991b1b",
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
      <div style={{ display: "flex", gap: "0.4rem", alignItems: "stretch" }}>
        <input
          className="email-input"
          placeholder="输入兑换码"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          style={{ flex: 1, height: 40, fontSize: "0.85rem" }}
        />
        <button
          className="email-btn"
          style={{ height: 40, background: "var(--accent)", color: "#fff", border: "none", whiteSpace: "nowrap" }}
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

export default function ProfilePage({ user, onLogout, onRefresh }: ProfilePageProps) {
  const roleLabel = getRoleLabel(user.role);
  const roleBadgeStyle = getRoleBadgeStyle(user.role);

  const isVerified = !!user.is_verified;
  const verifyUntilStr = user.verify_until;
  const verifyUntil = verifyUntilStr ? new Date(verifyUntilStr) : null;
  const now = new Date();
  const isVerifyValid = verifyUntil !== null && verifyUntil > now;
  const isVerifyExpired = isVerified && verifyUntil !== null && verifyUntil <= now;

  const isAdmin = user.role === "admin" || user.is_admin === true;
  const isPro = isAdmin || user.role === "pro";
  const showQuota = !isAdmin;
  const balance = user.quota_balance ?? 0;
  const cap = user.quota_cap ?? 0;
  const quotaPercent = showQuota && cap > 0
    ? Math.min(100, (balance / cap) * 100)
    : 0;

  const expireDate = user.role_expire_at ? formatBeijingDate(user.role_expire_at) : null;

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

      {/* Alipay — 仅管理员可见（支付产品接入中） */}
      {isAdmin && <AlipaySection />}

      {/* Redeem Code */}
      {!isAdmin && <RedeemSection />}
      {isPro && isVerified && <MeowSection user={user} />}

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
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ ...badgeBase, background: "#22c55e", color: "#fff" }}>
              已验证至 {formatBeijingDate(verifyUntilStr)}
            </span>
            <button
              className="email-link"
              onClick={() => { window.location.hash = "#/verify"; }}
              style={{ textDecoration: "none", whiteSpace: "nowrap" }}
            >
              重新验证 →
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ ...badgeBase, background: "#eab308", color: "#fff" }}>
              验证已过期 (至 {formatBeijingDate(verifyUntilStr)})
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
            alignItems: "center",
            marginBottom: "0.5rem",
            fontSize: "0.9rem",
          }}>
            <span>Token 配额</span>
            <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ color: "var(--muted)" }}>
                {formatQuota(balance)} / {formatQuota(cap)}
              </span>
              <button
                className="email-btn"
                style={{ background: "transparent", color: "var(--accent)", border: "1px solid var(--accent)", padding: "0.2rem 0.5rem", fontSize: "0.75rem" }}
                onClick={onRefresh}
                title="刷新余额"
              >刷新</button>
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
          {user.quota_updated_at && (
            <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.3rem" }}>
              上次更新: {formatBeijingDateTime(user.quota_updated_at)}
            </div>
          )}
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
