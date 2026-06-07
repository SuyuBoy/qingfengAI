import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";

interface VerifyPageProps {
  onVerified: () => void;
}

interface Challenge {
  dynamic_id: string;
  blank_context: string;
  expires_at: string;
  attempt: number;
}

function formatCountdown(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function VerifyPage({ onVerified }: VerifyPageProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [dynamicIdInput, setDynamicIdInput] = useState("");
  const [textInput, setTextInput] = useState("");
  const [countdown, setCountdown] = useState(0);
  const timerRef = useRef<number | undefined>(undefined);

  const startTimer = useCallback((expiresAt: string) => {
    clearInterval(timerRef.current);
    const tick = () => {
      const remaining = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000);
      if (remaining <= 0) {
        setCountdown(0);
        clearInterval(timerRef.current);
      } else {
        setCountdown(remaining);
      }
    };
    tick();
    timerRef.current = setInterval(tick, 1000);
  }, []);

  const fetchChallenge = useCallback(async () => {
    setLoading(true);
    setError("");
    setDynamicIdInput("");
    setTextInput("");
    try {
      const data = await api.get<Challenge>("/api/user/verify-challenge");
      if (data) {
        setChallenge(data);
        startTimer(data.expires_at);
      } else {
        setError("获取验证内容失败");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("503") || msg.includes("无可用于验证")) {
        setError("今日无动态，暂不可验证");
      } else if (msg.includes("次数已用完")) {
        setError("今日尝试次数已用完，请明天再试");
      } else {
        setError(msg || "获取验证内容失败");
      }
    }
    setLoading(false);
  }, [startTimer]);

  useEffect(() => {
    fetchChallenge();
    return () => clearInterval(timerRef.current);
  }, [fetchChallenge]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dynamicIdInput.trim() || !textInput.trim()) return;
    setError("");
    setLoading(true);
    try {
      const result = await api.post<{ verify_until: string }>("/api/user/verify-content", {
        dynamic_id: dynamicIdInput.trim(),
        text: textInput.trim(),
      });
      if (result) {
        setSuccess(true);
        clearInterval(timerRef.current);
        setTimeout(() => onVerified(), 1500);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "验证失败";
      if (msg.includes("超时")) {
        setError("答题已超时，请点击下方按钮刷新题目");
        setChallenge(null);
        clearInterval(timerRef.current);
      } else {
        setError(msg);
      }
    }
    setLoading(false);
  };

  if (loading && !challenge) {
    return (
      <div className="login-box">
        <h1>内容验证</h1>
        <div className="error-msg">加载中...</div>
      </div>
    );
  }

  return (
    <div className="login-box">
      <h1>内容验证</h1>

      {success ? (
        <div className="error-msg" style={{ color: "var(--success, #22c55e)" }}>
          验证成功
        </div>
      ) : (
        <>
          {error && <div className="error-msg">{error}</div>}

          {challenge && (
            <form className="email-form" onSubmit={handleSubmit}>
              <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.5rem", lineHeight: 1.6 }}>
                请在 B站最新动态中找到对应内容，完成填空验证。
              </p>

              <div style={{
                fontSize: "0.8rem", color: countdown <= 60 ? "var(--danger, #ef4444)" : "var(--muted)",
                marginBottom: "0.8rem", fontWeight: 500,
              }}>
                {countdown > 0
                  ? `⏱ 剩余 ${formatCountdown(countdown)}`
                  : "⏱ 已超时"}
                {" · "}第 {challenge.attempt}/5 次
              </div>

              <label style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.3rem", display: "block" }}>
                动态 ID
              </label>
              <input
                type="text" className="email-input" placeholder="动态 ID" required
                value={dynamicIdInput} onChange={e => setDynamicIdInput(e.target.value)}
                autoFocus
              />

              <label style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.3rem", display: "block", marginTop: "0.8rem" }}>
                填空
              </label>
              <input
                type="text" className="email-input" placeholder="填空内容" required
                value={textInput} onChange={e => setTextInput(e.target.value)}
              />

              {challenge.blank_context && (
                <p style={{
                  fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.5rem",
                  padding: "0.5rem", background: "var(--bg-secondary, #f5f5f5)", borderRadius: "4px", lineHeight: 1.5,
                }}>
                  {challenge.blank_context}
                </p>
              )}

              <button type="submit" className="email-btn" disabled={loading} style={{ marginTop: "1rem" }}>
                {loading ? "验证中..." : "提交验证"}
              </button>

              <button
                type="button"
                className="email-link"
                onClick={fetchChallenge}
                disabled={loading}
              >
                刷新题目（重新出题，消耗一次机会）
              </button>
            </form>
          )}

          {!challenge && !error && (
            <button type="button" className="email-btn" onClick={fetchChallenge}>
              获取题目
            </button>
          )}

          {!challenge && error && (
            <button type="button" className="email-btn" onClick={fetchChallenge}>
              重试
            </button>
          )}
        </>
      )}
    </div>
  );
}
