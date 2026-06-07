import type { CurrentUser } from "../types";

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
      maxWidth: 480,
      margin: "2rem auto",
      padding: "0 1.5rem",
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
            maxWidth: 480,
          }}
        >
          退出登录
        </button>
      </div>
    </div>
  );
}
