import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { Eye, EyeOff, Lock, Mail, Moon, ShieldCheck, Sun } from "lucide-react";
import { marked } from "marked";
import { api, setToken } from "../api";

type Tab = "google" | "email";
type EmailStep = "login" | "register" | "verify" | "resetRequest" | "resetConfirm";
type Theme = "light" | "dark";

type LoginPageProps = {
  onLogin: () => void;
  theme: Theme;
  onToggleTheme: () => void;
};

export default function LoginPage({ onLogin, theme, onToggleTheme }: LoginPageProps) {
  const [tab] = useState<Tab>("email");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [hasGoogle, setHasGoogle] = useState(Boolean(window.google?.accounts));
  const [loading, setLoading] = useState(false);

  // email form
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
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
      const message = e instanceof Error ? e.message : "邮箱或密码错误";
      setError(message.includes("忘记密码") ? message : `登录失败：${message}`);
    }
    setLoading(false);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) { setError("两次输入的密码不一致"); return; }
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
      setNotice("验证码已重新发送");
    } catch (e) {
      setError(`重发失败：${e instanceof Error ? e.message : "未知错误"}`);
    }
  };

  const handleResetRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");
    setLoading(true);
    try {
      await api.post("/api/auth/password-reset/request", { email });
      setCode("");
      setPassword("");
      setConfirmPassword("");
      setStep("resetConfirm");
      setNotice("如果该邮箱已注册，验证码将发送至该邮箱");
    } catch (e) {
      setError(`发送失败：${e instanceof Error ? e.message : "未知错误"}`);
    }
    setLoading(false);
  };

  const handleResetConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) { setError("两次输入的密码不一致"); return; }
    setError("");
    setNotice("");
    setLoading(true);
    try {
      const data = await api.post<{ token?: string }>("/api/auth/password-reset/confirm", { email, code, password });
      if (data?.token) {
        setToken(data.token);
        window.location.hash = "#/dynamics";
        onLogin();
      } else {
        setError("重置失败：验证码错误");
      }
    } catch (e) {
      setError(`重置失败：${e instanceof Error ? e.message : "验证码错误"}`);
    }
    setLoading(false);
  };

  const handleResetResend = async () => {
    setError("");
    setNotice("");
    try {
      await api.post("/api/auth/password-reset/request", { email });
      setNotice("验证码已重新发送");
    } catch (e) {
      setError(`重发失败：${e instanceof Error ? e.message : "未知错误"}`);
    }
  };

  const switchStep = (next: EmailStep) => {
    setStep(next);
    setError("");
    setNotice("");
    setConfirmPassword("");
    setShowPwd(false);
  };

  const needsConfirmPassword = step === "register" || step === "resetConfirm";
  const pwdMismatch = needsConfirmPassword && confirmPassword.length > 0 && password !== confirmPassword;
  const subtitle = step === "register" ? "创建你的清风 AI 账号"
    : step === "verify" ? "验证你的邮箱"
    : step === "resetRequest" ? "找回你的账号密码"
    : step === "resetConfirm" ? "设置新的登录密码"
    : "欢迎回来，请登录账号";

  return (
    <div className="login-box">
      <button
        type="button"
        className="theme-toggle"
        onClick={onToggleTheme}
        aria-label="切换日间 / 夜间模式"
        title="切换日间 / 夜间模式"
      >
        {theme === "dark" ? <Sun size={18} strokeWidth={1.8} /> : <Moon size={18} strokeWidth={1.8} />}
      </button>

      <div className="login-brand">
        <h1>清风 AI</h1>
        <p className="login-subtitle">{subtitle}</p>
      </div>

      <div className={`error-msg${notice && !error ? " is-notice" : ""}`}>{error || notice || " "}</div>

      {tab === "google" ? (
        hasGoogle ? (
          <div id="g_id_signin"></div>
        ) : (
          <p style={{ color: "var(--muted)", fontSize: "0.8rem" }}>Google 登录组件加载中...</p>
        )
      ) : step === "verify" ? (
        <form className="email-form" onSubmit={handleVerify}>
          <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0 0 0.25rem" }}>
            验证码已发送至 <strong>{email}</strong>
          </p>
          <div className="login-field">
            <ShieldCheck className="field-icon" size={18} strokeWidth={1.8} />
            <input
              type="text" className="login-input" placeholder="6 位验证码" required
              value={code} onChange={e => setCode(e.target.value)}
              maxLength={6} inputMode="numeric" autoFocus
            />
          </div>
          <button type="submit" className="email-btn" disabled={loading}>
            {loading ? "验证中..." : "验证"}
          </button>
          <button type="button" className="email-link" onClick={handleResendCode}>
            重发验证码
          </button>
          <button type="button" className="email-link" onClick={() => switchStep("register")}>
            返回
          </button>
        </form>
      ) : step === "resetRequest" ? (
        <form className="email-form" onSubmit={handleResetRequest}>
          <p className="form-note">输入注册邮箱，验证码会发送到该邮箱。</p>
          <div className="login-field">
            <Mail className="field-icon" size={18} strokeWidth={1.8} />
            <input
              type="email" className="login-input" placeholder="邮箱" required
              value={email} onChange={e => setEmail(e.target.value)}
              autoComplete="email" autoFocus
            />
          </div>
          <button type="submit" className="email-btn" disabled={loading}>
            {loading ? "发送中..." : "发送验证码"}
          </button>
          <button type="button" className="email-link" onClick={() => switchStep("login")}>
            返回登录
          </button>
        </form>
      ) : step === "resetConfirm" ? (
        <form className="email-form" onSubmit={handleResetConfirm}>
          <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0 0 0.25rem" }}>
            验证码已发送至 <strong>{email}</strong>
          </p>
          <div className="login-field">
            <ShieldCheck className="field-icon" size={18} strokeWidth={1.8} />
            <input
              type="text" className="login-input" placeholder="6 位验证码" required
              value={code} onChange={e => setCode(e.target.value)}
              maxLength={6} inputMode="numeric" autoFocus
            />
          </div>
          <div className="login-field has-eye">
            <Lock className="field-icon" size={18} strokeWidth={1.8} />
            <input
              type={showPwd ? "text" : "password"} className="login-input" placeholder="新密码（至少 6 位）" required
              value={password} onChange={e => setPassword(e.target.value)}
              autoComplete="new-password" minLength={6}
            />
            <button
              type="button" className="field-eye"
              onClick={() => setShowPwd(s => !s)}
              aria-label={showPwd ? "隐藏密码" : "显示密码"}
              tabIndex={-1}
            >
              {showPwd ? <EyeOff size={18} strokeWidth={1.8} /> : <Eye size={18} strokeWidth={1.8} />}
            </button>
          </div>
          <div className={`login-field has-eye${pwdMismatch ? " is-invalid" : ""}`}>
            <Lock className="field-icon" size={18} strokeWidth={1.8} />
            <input
              type={showPwd ? "text" : "password"}
              className={`login-input${pwdMismatch ? " is-invalid" : ""}`}
              placeholder="再次输入新密码" required
              value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
              autoComplete="new-password" minLength={6}
            />
          </div>
          {pwdMismatch && <div className="field-hint error">两次输入的密码不一致</div>}
          <button type="submit" className="email-btn" disabled={loading || pwdMismatch}>
            {loading ? "重置中..." : "重置密码并登录"}
          </button>
          <button type="button" className="email-link" onClick={handleResetResend}>
            重发验证码
          </button>
          <button type="button" className="email-link" onClick={() => switchStep("login")}>
            返回登录
          </button>
        </form>
      ) : (
        <form className="email-form" onSubmit={step === "login" ? handleEmailLogin : handleRegister}>
          <div className="login-field">
            <Mail className="field-icon" size={18} strokeWidth={1.8} />
            <input
              type="email" className="login-input" placeholder="邮箱" required
              value={email} onChange={e => setEmail(e.target.value)}
              autoComplete="email" autoFocus
            />
          </div>

          <div className="login-field has-eye">
            <Lock className="field-icon" size={18} strokeWidth={1.8} />
            <input
              type={showPwd ? "text" : "password"} className="login-input" placeholder="密码（至少 6 位）" required
              value={password} onChange={e => setPassword(e.target.value)}
              autoComplete={step === "login" ? "current-password" : "new-password"}
              minLength={6}
            />
            <button
              type="button" className="field-eye"
              onClick={() => setShowPwd(s => !s)}
              aria-label={showPwd ? "隐藏密码" : "显示密码"}
              tabIndex={-1}
            >
              {showPwd ? <EyeOff size={18} strokeWidth={1.8} /> : <Eye size={18} strokeWidth={1.8} />}
            </button>
          </div>

          {step === "register" && (
            <>
              <div className={`login-field has-eye${pwdMismatch ? " is-invalid" : ""}`}>
                <Lock className="field-icon" size={18} strokeWidth={1.8} />
                <input
                  type={showPwd ? "text" : "password"}
                  className={`login-input${pwdMismatch ? " is-invalid" : ""}`}
                  placeholder="再次输入密码" required
                  value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                  autoComplete="new-password" minLength={6}
                />
              </div>
              {pwdMismatch && <div className="field-hint error">两次输入的密码不一致</div>}
            </>
          )}

          {step === "register" && captchaImg && (
            <div className="captcha-row">
              <img src={captchaImg} alt="验证码" className="captcha-img" onClick={fetchCaptcha} title="点击刷新" />
              <input
                type="text" className="login-input captcha-input" placeholder="验证码" required
                value={captchaAnswer} onChange={e => setCaptchaAnswer(e.target.value)}
                maxLength={2}
              />
            </div>
          )}

          {step === "register" && (
            <label className="agree-row">
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
              已阅读并同意
              <span
                className="email-link"
                style={{ padding: 0, fontSize: "inherit" }}
                onClick={(e) => { e.preventDefault(); loadAgreement(); setShowAgreement(true); }}
              >
                用户协议
              </span>
            </label>
          )}

          <button
            type="submit" className="email-btn"
            disabled={loading || pwdMismatch || (step === "register" && !agreed)}
          >
            {loading ? "请稍候..." : step === "login" ? "登录" : "注册"}
          </button>
          <button
            type="button" className="email-link"
            onClick={() => switchStep(step === "login" ? "register" : "login")}
          >
            {step === "login" ? "没有账号？注册" : "已有账号？登录"}
          </button>
          {step === "login" && (
            <button
              type="button" className="email-link"
              onClick={() => switchStep("resetRequest")}
            >
              忘记密码？
            </button>
          )}
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
                style={{ width: "auto", padding: "0 1.5rem", height: 40 }}
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
