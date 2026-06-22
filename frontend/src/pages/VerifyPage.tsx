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
  dynamic_date?: string;
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

  const dynamicIdError = dynamicIdInput.trim() && !/^\d+$/.test(dynamicIdInput.trim())
    ? "动态 ID 应为纯数字"
    : "";
  const canSubmit = !loading && countdown > 0 && dynamicIdInput.trim() && textInput.trim() && !dynamicIdError;

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
      if (msg.includes("次数已用完")) {
        setError("今日尝试次数已用完，请明天再试");
      } else if (msg.includes("无可用于验证")) {
        setError("近期无可用于验证的动态，请稍后再试");
      } else {
        setError(msg || "获取验证内容失败");
      }
    }
    setLoading(false);
  }, [startTimer]);

  useEffect(() => {
    return () => clearInterval(timerRef.current);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
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
      const body = (e as any).body;
      if (msg.includes("超时")) {
        setError("答题已超时，请点击下方按钮刷新题目");
        setChallenge(null);
        clearInterval(timerRef.current);
      } else if (body?.dynamic_id) {
        setError("答案错误，已换新题");
        const newChallenge: Challenge = {
          dynamic_id: body.dynamic_id,
          blank_context: body.blank_context,
          expires_at: body.expires_at,
          attempt: body.attempt,
          dynamic_date: body.dynamic_date,
        };
        setChallenge(newChallenge);
        setDynamicIdInput("");
        setTextInput("");
        startTimer(body.expires_at);
      } else if (msg.includes("次数已用完")) {
        setError("今日尝试次数已用完，请明天再试");
        setChallenge(null);
        clearInterval(timerRef.current);
      } else if (msg.includes("不足")) {
        setError("填入内容过短，至少需要 2 个字");
      } else {
        setError(msg);
      }
    }
    setLoading(false);
  };

  if (loading && !challenge) {
    return (
      <div className="verify-page">
        <div className="login-box">
          <h1>内容验证</h1>
          <div className="error-msg">加载中...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="verify-page">
    <div className="login-box verify-box">
      <h1>内容验证</h1>

      {success ? (
        <div className="error-msg" style={{ color: "var(--success, #22c55e)" }}>
          验证成功
        </div>
      ) : (
        <>
          {error && <div className="error-msg">{error}</div>}

          {challenge && (
            <form className="email-form verify-form" onSubmit={handleSubmit}>
              <p className="verify-intro">
                请在 B站最新动态中找到对应内容，完成填空验证。
              </p>

              <div className="verify-meta-row">
                <span className={`verify-countdown${countdown <= 60 ? " is-urgent" : ""}`}>
                  {countdown > 0
                    ? `⏱ 剩余 ${formatCountdown(countdown)}`
                    : "⏱ 已超时"}
                </span>
                <span className="verify-attempt">· 第 {challenge.attempt}/5 次</span>
                {challenge.dynamic_date && (
                  <span className="verify-date">· {challenge.dynamic_date}</span>
                )}
              </div>

              <div className="verify-field">
                <label className="verify-label">动态 ID</label>
                <input
                  type="text" className={`email-input${dynamicIdError ? " is-invalid" : ""}`}
                  placeholder="动态 ID" required
                  value={dynamicIdInput} onChange={e => setDynamicIdInput(e.target.value)}
                  autoFocus
                />
                {dynamicIdError && <span className="verify-field-error">{dynamicIdError}</span>}
              </div>

              <div className="verify-field">
                <label className="verify-label">填空</label>
                <input
                  type="text" className="email-input" placeholder="填空内容" required
                  value={textInput} onChange={e => setTextInput(e.target.value)}
                />
              </div>

              {challenge.blank_context && (
                <p className="verify-context">
                  {challenge.blank_context}
                </p>
              )}

              <button type="submit" className="email-btn" disabled={!canSubmit}>
                {loading ? "验证中..." : "提交验证"}
              </button>

              <button
                type="button"
                className="email-link"
                onClick={fetchChallenge}
              >
                刷新题目（重新出题，消耗一次机会）
              </button>
            </form>
          )}

          {!challenge && !error && (
            <button type="button" className="email-btn" onClick={fetchChallenge} style={{ marginTop: "0.6rem" }}>
              获取题目
            </button>
          )}

          {!challenge && error && (
            <button type="button" className="email-btn" onClick={fetchChallenge} style={{ marginTop: "0.6rem" }}>
              重试
            </button>
          )}
        </>
      )}
    </div>
    </div>
  );
}
