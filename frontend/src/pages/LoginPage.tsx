import { useCallback, useEffect, useState } from "react";
import { api, setToken } from "../api";

export default function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [error, setError] = useState("");
  const [hasGoogle, setHasGoogle] = useState(Boolean(window.google?.accounts));

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
    if (!hasGoogle || !window.google?.accounts) return;

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
  }, [hasGoogle, handleGoogleCallback]);

  return (
    <div className="login-box">
      <h1>清风 AI</h1>
      <p>请使用 Google 账号登录</p>
      <div className={`error-msg${error ? " show" : ""}`} id="login-error">{error}</div>
      {hasGoogle ? (
        <div id="g_id_signin"></div>
      ) : (
        <p style={{ color: "var(--muted)", fontSize: "0.8rem" }}>Google 登录组件加载中...</p>
      )}
    </div>
  );
}
