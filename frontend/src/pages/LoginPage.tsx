import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { marked } from "marked";
import { API_BASE, api, setToken } from "../api";

type Tab = "google" | "email";
type EmailStep = "login" | "register" | "verify";

export default function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [tab, setTab] = useState<Tab>("google");
  const [error, setError] = useState("");
  const [hasGoogle, setHasGoogle] = useState(Boolean(window.google?.accounts));
  const [loading, setLoading] = useState(false);

  // email form
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<EmailStep>("login");

  // agreement
  const [agreed, setAgreed] = useState(false);
  const [showAgreement, setShowAgreement] = useState(false);
  const [agreementContent, setAgreementContent] = useState("");
  const agreementLoaded = useRef(false);

  const agreementHtml = useMemo(
    () => marked.parse(agreementContent || "加载中...", { gfm: true, breaks: false }) as string,
    [agreementContent]
  );

  const loadAgreement = useCallback(async () => {
    if (agreementLoaded.current) return;
    agreementLoaded.current = true;
    try {
      const data = await api.get<{ content: string }>("/api/dynamics/00002");
      setAgreementContent(data?.content || "");
    } catch {
      setAgreementContent("# 加载失败\n\n请稍后重试。");
    }
  }, []);

  // captcha
  const [captchaId, setCaptchaId] = useState("");
  const [captchaImg, setCaptchaImg] = useState("");
  const [captchaAnswer, setCaptchaAnswer] = useState("");

  const fetchCaptcha = useCallback(async () => {
    try {
      const data = await api.get<{ id: string; image: string }>("/api/auth/captcha");
      if (data) {
        setCaptchaId(data.id);
        setCaptchaImg(data.image);
        setCaptchaAnswer("");
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchCaptcha();
  }, [step, fetchCaptcha]);

  useEffect(() => {
    if (hasGoogle) return;
    const timer = window.setInterval(() => {
      if (window.google?.accounts) {
        setHasGoogle(true);
        window.clearInterval(timer);
      }
    }, 200);
    return () => window.clearInterval(timer);
  }, [hasGoogle]);

  const handleGoogleCallback = useCallback(async (resp: { credential: string }) => {
    try {
      const data = await api.post<{ token?: string }>("/api/auth/login", { credential: resp.credential });
      if (data?.token) {
        setToken(data.token);
        window.location.hash = "#/dynamics";
        onLogin();
      } else {
        setError("登录失败：未授权");
      }
    } catch (e) {
      setError(`登录失败：${e instanceof Error ? e.message : "未知错误"}`);
    }
  }, [onLogin]);

  useEffect(() => {
    if (tab !== "google" || !hasGoogle || !window.google?.accounts) return;

    let mounted = true;
    async function initGoogle() {
      const clientId = sessionStorage.getItem("google_client_id")
        || await api.get<{ client_id?: string }>("/api/config/google-client-id")
          .then(d => d?.client_id || "")
          .catch(() => "");
      if (!mounted || !window.google?.accounts) return;
      if (clientId) sessionStorage.setItem("google_client_id", clientId);

      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: handleGoogleCallback,
        auto_select: true,
      });

      const button = document.getElementById("g_id_signin");
      if (button) {
        window.google.accounts.id.renderButton(button, {
          theme: "outline",
          size: "large",
          text: "signin_with",
          shape: "rectangular",
        });
      }
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (!isMobile) window.google.accounts.id.prompt();
    }

    initGoogle();
    return () => { mounted = false; };
  }, [tab, hasGoogle, handleGoogleCallback]);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await api.post<{ token?: string }>("/api/auth/login", { email, password });
      if (data?.token) {
        setToken(data.token);
        window.location.hash = "#/dynamics";
        onLogin();
      } else {
        setError("登录失败：邮箱或密码错误");
      }
    } catch (e) {
      setError(`登录失败：${e instanceof Error ? e.message : "邮箱或密码错误"}`);
    }
    setLoading(false);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreed) { setError("请阅读并同意用户协议"); return; }
    setError("");
    setLoading(true);
    try {
      await api.post("/api/auth/register", { email, password, captcha_id: captchaId, captcha_answer: captchaAnswer });
      setStep("verify");
    } catch (e) {
      fetchCaptcha();
      setError(`注册失败：${e instanceof Error ? e.message : "未知错误"}`);
    }
    setLoading(false);
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await api.post<{ token?: string }>("/api/auth/verify", { email, code });
      if (data?.token) {
        setToken(data.token);
        window.location.hash = "#/dynamics";
        onLogin();
      } else {
        setError("验证码错误");
      }
    } catch (e) {
      setError(`验证失败：${e instanceof Error ? e.message : "验证码错误"}`);
    }
    setLoading(false);
  };

  const handleResendCode = async () => {
    try {
      await api.post("/api/auth/resend", { email });
      setError("验证码已重新发送");
    } catch (e) {
      setError(`重发失败：${e instanceof Error ? e.message : "未知错误"}`);
    }
  };

  return (
    <div className="login-box">
      <h1>清风 AI</h1>

      <div className="login-tabs">
        <button
          className={`login-tab${tab === "google" ? " active" : ""}`}
          onClick={() => { setTab("google"); setError(""); }}
        >Google 登录</button>
        <button
          className={`login-tab${tab === "email" ? " active" : ""}`}
          onClick={() => { setTab("email"); setError(""); setStep("login"); }}
        >邮箱登录</button>
      </div>

      <div className={`error-msg`}>{error || " "}</div>

      {tab === "google" ? (
        hasGoogle ? (
          <div id="g_id_signin"></div>
        ) : (
          <p style={{ color: "var(--muted)", fontSize: "0.8rem" }}>Google 登录组件加载中...</p>
        )
      ) : step === "verify" ? (
        <form className="email-form" onSubmit={handleVerify}>
          <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.5rem" }}>
            验证码已发送至 <strong>{email}</strong>
          </p>
          <input
            type="text" className="email-input" placeholder="6 位验证码" required
            value={code} onChange={e => setCode(e.target.value)}
            maxLength={6} autoFocus
          />
          <button type="submit" className="email-btn" disabled={loading}>
            {loading ? "验证中..." : "验证"}
          </button>
          <button type="button" className="email-link" onClick={handleResendCode}>
            重发验证码
          </button>
          <button type="button" className="email-link" onClick={() => setStep("register")}>
            返回
          </button>
        </form>
      ) : (
        <form className="email-form" onSubmit={step === "login" ? handleEmailLogin : handleRegister}>
          <input
            type="email" className="email-input" placeholder="邮箱" required
            value={email} onChange={e => setEmail(e.target.value)}
            autoComplete="email" autoFocus
          />
          <input
            type="password" className="email-input" placeholder="密码（至少 6 位）" required
            value={password} onChange={e => setPassword(e.target.value)}
            autoComplete={step === "login" ? "current-password" : "new-password"}
            minLength={6}
          />
          {step === "register" && captchaImg && (
            <div className="captcha-row">
              <img src={captchaImg} alt="验证码" className="captcha-img" onClick={fetchCaptcha} title="点击刷新" />
              <input
                type="text" className="email-input captcha-input" placeholder="验证码" required
                value={captchaAnswer} onChange={e => setCaptchaAnswer(e.target.value)}
                maxLength={2}
              />
            </div>
          )}
          {step === "register" && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.82rem", color: "var(--muted)", cursor: "pointer" }}>
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} style={{ cursor: "pointer" }} />
              已阅读并同意
              <span
                className="email-link"
                style={{ textDecoration: "underline", cursor: "pointer" }}
                onClick={(e) => { e.preventDefault(); loadAgreement(); setShowAgreement(true); }}
              >
                用户协议
              </span>
            </label>
          )}
          <button type="submit" className="email-btn" disabled={loading || (step === "register" && !agreed)}>
            {loading ? "请稍候..." : step === "login" ? "登录" : "注册"}
          </button>
          <button
            type="button" className="email-link"
            onClick={() => { setStep(step === "login" ? "register" : "login"); setError(""); }}
          >
            {step === "login" ? "没有账号？注册" : "已有账号？登录"}
          </button>
        </form>
      )}

      {showAgreement && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "rgba(0,0,0,0.5)", display: "flex",
            alignItems: "center", justifyContent: "center", padding: "1rem",
          }}
          onClick={() => setShowAgreement(false)}
        >
          <div
            style={{
              background: "var(--card-bg)", borderRadius: "var(--radius)",
              border: "1px solid var(--border)", width: "min(92vw, 720px)",
              maxHeight: "min(88vh, 800px)", display: "flex", flexDirection: "column",
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem clamp(0.75rem, 3vw, 1.5rem)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
              <h3 style={{ margin: 0, fontSize: "1.05rem" }}>用户协议</h3>
              <button
                onClick={() => setShowAgreement(false)}
                style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: "1.2rem", padding: "0.25rem" }}
              >
                ✕
              </button>
            </div>
            <div className="card" style={{ flex: 1, overflow: "auto", border: "none", borderRadius: 0, margin: 0 }}>
              <div
                className="content"
                style={{ textAlign: "left" }}
                dangerouslySetInnerHTML={{ __html: agreementHtml }}
              />
            </div>
            <div style={{ padding: "0.75rem clamp(0.75rem, 3vw, 1.5rem)", borderTop: "1px solid var(--border)", textAlign: "right", flexShrink: 0 }}>
              <button
                className="email-btn"
                style={{ background: "var(--accent)", color: "#fff", border: "none" }}
                onClick={() => { setAgreed(true); setShowAgreement(false); }}
              >
                同意
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
