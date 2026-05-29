import { api, getToken } from "./api.js";

let currentUser = null;
export function getUser() { return currentUser; }

async function checkAuth() {
  if (!getToken()) return null;
  try {
    currentUser = await api.get("/api/auth/me");
    return currentUser;
  } catch { return null; }
}

function renderNav() {
  const nav = document.getElementById("nav");
  if (currentUser && currentUser.role !== "unpaid") {
    nav.style.display = "";
    nav.querySelector(".user-email").textContent = currentUser.email;
    const btn = nav.querySelector(".crawl-btn");
    if (btn) btn.style.display = currentUser.is_admin ? "" : "none";
  } else {
    nav.style.display = "none";
  }
}

let crawlCooldown = 0;
async function triggerCrawl() {
  const btn = document.querySelector(".crawl-btn");
  if (!btn) return;
  const now = Date.now();
  if (now - crawlCooldown < 60000) {
    btn.textContent = `冷却 ${Math.ceil((60000 - (now - crawlCooldown)) / 1000)}s`;
    return;
  }
  btn.textContent = "爬取中...";
  btn.disabled = true;
  try {
    await api.get("/api/crawl");
    btn.textContent = "已触发";
    crawlCooldown = Date.now();
    location.reload();
  } catch (e) {
    btn.textContent = e.message === "未付费" ? "仅管理员" : "失败";
  }
  setTimeout(() => { btn.textContent = "刷新爬虫"; btn.disabled = false; }, 3000);
}
window.triggerCrawl = triggerCrawl;

async function showLogin() {
  const app = document.getElementById("app");
  const mod = await import("./views/login.js");
  await mod.init(app);
}

async function showDynamics() {
  const app = document.getElementById("app");
  const mod = await import("./views/dynamics.js");
  await mod.init(app);
}

function showLock() {
  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="login-box">
      <h1>B站动态存档</h1>
      <p style="font-size:1.2rem;margin:1rem 0">🔒</p>
      <p>${currentUser.email}</p>
      <p style="color:var(--muted);margin-top:0.5rem">尚未解锁，请联系管理员</p>
      <button onclick="localStorage.removeItem('bili_jwt');location.reload()" style="margin-top:1.5rem;padding:6px 20px;border:1px solid var(--border);border-radius:var(--radius);background:var(--card-bg);cursor:pointer;font:inherit;color:var(--muted)">切换账号</button>
    </div>
  `;
}

async function start() {
  const user = await checkAuth();
  renderNav();

  if (!user) {
    await showLogin();
  } else if (user.role === "unpaid") {
    showLock();
  } else {
    await showDynamics();
  }
}

window.addEventListener("load", start);
