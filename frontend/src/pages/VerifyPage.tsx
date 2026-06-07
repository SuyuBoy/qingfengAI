import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

interface VerifyPageProps {
  onVerified: () => void;
}

interface Challenge {
  dynamic_id: string;
  blank_context: string;
}

export default function VerifyPage({ onVerified }: VerifyPageProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [dynamicIdInput, setDynamicIdInput] = useState("");
  const [textInput, setTextInput] = useState("");

  const fetchChallenge = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.get<Challenge>("/api/user/verify-challenge");
      if (data) {
        setChallenge(data);
        setDynamicIdInput(data.dynamic_id || "");
      } else {
        setError("获取验证内容失败");
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("503")) {
        setError("今日无动态，暂不可验证");
      } else {
        setError("获取验证内容失败");
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchChallenge();
  }, [fetchChallenge]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await api.post<{ verify_until: string }>("/api/user/verify-content", {
        dynamic_id: dynamicIdInput,
        text: textInput,
      });
      if (result) {
        setSuccess(true);
        setTimeout(() => {
          onVerified();
        }, 1500);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "验证失败";
      setError(msg);
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

          {challenge && !error && (
            <form className="email-form" onSubmit={handleSubmit}>
              <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "1rem", lineHeight: 1.6 }}>
                请在 B站最新动态中找到对应内容，完成填空验证。
              </p>

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
            </form>
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
