import { api, setToken } from "../api.js";

export async function init(container) {
  const hasGoogle = typeof google !== "undefined" && google.accounts;
  container.innerHTML = `
    <div class="login-box">
      <h1>B站动态存档</h1>
      <p>请使用 Google 账号登录</p>
      <div class="error-msg" id="login-error"></div>
      ${hasGoogle ? '<div id="g_id_signin"></div>' : '<p style="color:var(--muted);font-size:0.8rem;">Google 登录组件加载中...</p>'}
    </div>
  `;

  if (!hasGoogle) return;

  const clientId = sessionStorage.getItem("google_client_id") || await api.get("/api/config/google-client-id").then(d => d?.client_id || "").catch(() => "");
  if (clientId) sessionStorage.setItem("google_client_id", clientId);

  google.accounts.id.initialize({
    client_id: clientId,
    callback: async (resp) => {
      const errEl = document.getElementById("login-error");
      try {
        const data = await api.post("/api/auth/login", { credential: resp.credential });
        if (data && data.token) {
          setToken(data.token);
          location.reload();
        } else {
          errEl.textContent = "登录失败：未授权";
          errEl.classList.add("show");
        }
      } catch (e) {
        errEl.textContent = "登录失败：" + e.message;
        errEl.classList.add("show");
      }
    },
    auto_select: true,
  });
  google.accounts.id.renderButton(document.getElementById("g_id_signin"), {
    theme: "outline", size: "large", text: "signin_with", shape: "rectangular",
  });
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (!isMobile) google.accounts.id.prompt();
}
