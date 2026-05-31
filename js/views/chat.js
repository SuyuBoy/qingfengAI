import { api, getToken } from "../api.js";
import { getUser } from "../app.js";
import { escapeHtml, renderMarkdown } from "../markdown.js";

const API_BASE = window.__API_BASE__ || "";
window.__debugLog = [];

let msgContainer, chatView, sidebar, textarea, sendBtn;
const CHAT_KEY = "chat_messages";
let streaming = false;
let currentAssistantMsg = null;
let currentCard = null;
let pastedImages = [];

let messages = [];

function loadMessages() {
  try {
    const raw = localStorage.getItem(CHAT_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (Array.isArray(saved) && saved.length > 0 && saved[0].role === "system") {
        return saved;
      }
    }
  } catch {}
  return null;
}

function saveMessages() {
  try {
    localStorage.setItem(CHAT_KEY, JSON.stringify(messages));
  } catch {}
}

function newSession() {
  const now = new Date().toISOString();
  const maxRounds = document.getElementById("chat-max-rounds")?.value || "10";
  messages = [{
    role: "system",
    content: `你是清风研习社的AI助手，基于清风录制的复盘文章回答用户问题。回答时注明引用来源（日期+标题）。找不到相关文章就如实告知，不要编造。

策略：用 search_articles 语义搜索或 search_by_date 按日期查。看完元信息后，选最相关的 2-3 篇用 read_article 一次性批量读取，不要逐篇单独读。最多 ${maxRounds} 轮调用（含搜索），快速判断直接回答。当前时间：${now}`
  }];
  saveMessages();
}

export async function init(container) {
  const saved = loadMessages();
  if (saved) {
    messages = saved;
  } else {
    newSession();
  }

  container.innerHTML = `
    <div id="chat-view" class="collapsed">

      <div class="chat-main">
        <div class="chat-messages">
          <div class="chat-empty">向 AI 助手提问，基于清风文章库检索回答</div>
        </div>
        <div class="chat-input-wrap">
          <div class="chat-controls">
            <select id="chat-model">
              <option value="deepseek-v4-flash">v4 Flash</option>
              <option value="deepseek-v4-pro">v4 Pro</option>
            </select>
            <select id="chat-effort">
              <option value="high">高思考</option>
              <option value="max">最强思考</option>
            </select>
            <label class="rounds-label">工具调用轮数
              <input type="number" id="chat-max-rounds" value="10" min="1" max="50">
            </label>
            <button class="model-btn" id="chat-debug-btn" style="display:none">调试</button>
            <button class="model-btn" id="chat-clear">新对话</button>
          </div>
          <div class="chat-send-row">
            <textarea id="chat-input" rows="1" placeholder="输入问题...（可直接粘贴图片）"></textarea>
            <button id="chat-send-btn" disabled>发送</button>
          </div>
          <div class="chat-paste-preview" id="paste-preview"></div>
        </div>
      </div>
      <aside class="tool-sidebar" id="tool-sidebar">
        <div class="tool-sidebar-title">
          <span>工具调用</span>
          <button class="tool-sidebar-toggle" id="sidebar-toggle" title="收起侧边栏">&larr;</button>
        </div>
        <div class="tool-sidebar-empty">等待工具调用...</div>
      </aside>
    </div>
    <button class="sidebar-expand-btn" id="sidebar-expand" title="展开侧边栏">工具调用 &rarr;</button>
  `;

  chatView = container.querySelector("#chat-view");
  msgContainer = container.querySelector(".chat-messages");
  sidebar = container.querySelector("#tool-sidebar");
  textarea = container.querySelector("#chat-input");
  sendBtn = container.querySelector("#chat-send-btn");

  if (sendBtn) sendBtn.addEventListener("click", sendMessage);
  if (textarea) {
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    textarea.addEventListener("input", () => {
      if (sendBtn) sendBtn.disabled = !textarea.value.trim() && !pastedImages.length;
    });
    textarea.addEventListener("paste", onPaste);
  }
  const clearBtn = container.querySelector("#chat-clear");
  if (clearBtn) clearBtn.addEventListener("click", () => {
    if (streaming) return;
    newSession();
    msgContainer.innerHTML = '<div class="chat-empty">新对话已开始</div>';
    clearSidebar();
  });

  // 侧边栏收起/展开
  const toggleBtn = container.querySelector("#sidebar-toggle");
  const expandBtn = container.querySelector("#sidebar-expand");
  if (toggleBtn) toggleBtn.addEventListener("click", () => collapseSidebar(chatView));
  if (expandBtn) expandBtn.addEventListener("click", () => expandSidebar(chatView));

  // 调试按钮 — 仅管理员可见
  const debugBtn = container.querySelector("#chat-debug-btn");
  if (debugBtn && getUser()?.is_admin) {
    debugBtn.style.display = "";
    debugBtn.addEventListener("click", showDebugModal);
  }

  // 渲染历史对话
  if (saved) {
    for (const m of messages) {
      if (m.role === "user") addMessage("user", m.content);
      else if (m.role === "assistant" && m.content) addMessage("assistant", m.content);
    }
  }
}

function onPaste(e) {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (!item.type.startsWith("image/")) continue;
    e.preventDefault();
    const blob = item.getAsFile();
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = reader.result.split(",")[1];
      pastedImages.push(b64);
      if (sendBtn) sendBtn.disabled = false;
      renderPastePreview();
    };
    reader.readAsDataURL(blob);
    break;
  }
}

function renderPastePreview() {
  const preview = document.getElementById("paste-preview");
  if (!preview) return;
  preview.innerHTML = pastedImages.map((b64, i) =>
    `<div class="paste-thumb-wrap">
      <img src="data:image/png;base64,${b64}" class="paste-thumb">
      <button class="paste-remove" data-idx="${i}">&times;</button>
    </div>`
  ).join("");
  preview.querySelectorAll(".paste-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      pastedImages.splice(Number(btn.dataset.idx), 1);
      if (!pastedImages.length && !textarea.value.trim()) {
        if (sendBtn) sendBtn.disabled = true;
      }
      renderPastePreview();
    });
  });
}

function clearPastedImages() {
  pastedImages = [];
  const preview = document.getElementById("paste-preview");
  if (preview) preview.innerHTML = "";
}

function addMessage(role, content) {
  const empty = msgContainer.querySelector(".chat-empty");
  if (empty) empty.remove();
  const el = document.createElement("div");
  el.className = `chat-msg ${role}`;
  const label = role === "user" ? "你" : role === "tool" ? "工具" : "AI";
  el.innerHTML = `<div class="role-label">${label}</div><div class="msg-body">${renderMarkdown(content || "")}</div>`;
  msgContainer.appendChild(el);
  window.scrollTo(0, document.body.scrollHeight);
  return el;
}

// ---- 侧边栏 ----

function collapseSidebar(chatView) {
  if (!chatView) return;
  chatView.classList.add("collapsed");
}

function expandSidebar(chatView) {
  if (!chatView) return;
  chatView.classList.remove("collapsed");
}

function clearSidebar() {
  currentCard = null;
  if (!sidebar) return;
  sidebar.querySelectorAll(".tool-card").forEach(c => c.remove());
  let empty = sidebar.querySelector(".tool-sidebar-empty");
  if (!empty) {
    empty = document.createElement("div");
    empty.className = "tool-sidebar-empty";
    empty.textContent = "等待工具调用...";
    sidebar.appendChild(empty);
  }
  updateExpandBadge();
}

function updateExpandBadge() {
  const btn = document.getElementById("sidebar-expand");
  if (!btn) return;
  const count = sidebar ? sidebar.querySelectorAll(".tool-card").length : 0;
  btn.textContent = count ? `工具调用 (${count}) →` : "工具调用 →";
}

function addToolCard(toolName, searchQuery) {
  if (!sidebar) return;
  const empty = sidebar.querySelector(".tool-sidebar-empty");
  if (empty) empty.remove();

  const card = document.createElement("div");
  card.className = "tool-card";
  card.innerHTML = `
    <div class="tool-card-head">
      <span class="tool-card-name">${escapeHtml(toolName)}</span>
    </div>
    <div class="tool-card-query">搜索："${escapeHtml(searchQuery)}"</div>
    <div class="tool-card-articles"></div>
  `;
  const after = sidebar.querySelector(".tool-sidebar-title");
  if (after) {
    sidebar.insertBefore(card, after.nextSibling);
  } else {
    sidebar.insertBefore(card, sidebar.firstChild);
  }
  currentCard = card;
  updateExpandBadge();
  return card;
}

function promoteCardIfEmpty(cardEl) {
  if (!cardEl) return;
  const articles = cardEl.querySelector(".tool-card-articles");
  if (articles && !articles.children.length) {
    articles.innerHTML = '<div style="font-size:0.65rem;color:var(--muted)">缓存命中</div>';
  }
}

function populateCard(cardEl, articles) {
  if (!cardEl) return;
  const container = cardEl.querySelector(".tool-card-articles");
  if (!container) return;
  container.innerHTML = articles.map(a => renderArticleItem(a)).join("");
}

function cleanSnippet(s) {
  return (s || "").replace(/!\[img:\d+\]/g, "[图]");
}

function renderArticleItem(a) {
  return `
    <div class="article-item">
      <div class="article-item-date">${escapeHtml(a.date)}</div>
      <div class="article-item-title">${escapeHtml(a.title || "(无标题)")}</div>
      ${a.snippet ? `<div class="article-item-snippet">${escapeHtml(cleanSnippet(a.snippet))}</div>` : ""}
      <div class="article-item-more" data-id="${escapeHtml(a.id)}" onclick="window.__showArticleModal('${escapeHtml(a.id)}')">阅读全文 →</div>
    </div>`;
}

// ---- 模态窗口 ----

async function showArticleModal(articleId) {
  const existing = document.querySelector(".modal-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = '<div class="modal-box"><div class="modal-body">加载中...</div></div>';
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  document.body.appendChild(overlay);

  try {
    const res = await fetch(API_BASE + "/api/dynamics/" + encodeURIComponent(articleId), {
      headers: { "Authorization": "Bearer " + getToken() },
    });
    if (!res.ok) {
      overlay.querySelector(".modal-body").textContent = "文章加载失败";
      return;
    }
    const article = await res.json();
    renderModal(overlay, article);
  } catch {
    overlay.querySelector(".modal-body").textContent = "文章加载失败";
  }
}

function renderModal(overlay, a) {
  const content = (a.content || "").replace(
    /!\[img:(\d+)\]/g,
    (_, idx) => `![图片](${API_BASE}/api/img/${a.dynamic_id}_${idx})`
  );
  overlay.querySelector(".modal-box").innerHTML = `
    <div class="modal-header">
      <div>
        <h3>${escapeHtml(a.title || "(无标题)")}</h3>
        <div class="modal-meta">${escapeHtml(a.date)} · ${escapeHtml(a.type)}</div>
        ${a.tags ? `<div class="modal-tags">标签：${escapeHtml(a.tags)}</div>` : ""}
      </div>
      <button class="modal-close" onclick="window.__closeArticleModal()">&times;</button>
    </div>
    <div class="modal-body">${renderMarkdown(content)}</div>
  `;
}

function closeModal() {
  const overlay = document.querySelector(".modal-overlay");
  if (overlay) overlay.remove();
}

function showDebugModal() {
  const msgs = window.__debugMessages || messages;
  const debugLog = window.__debugLog || [];
  const msgRows = msgs.map((m, i) => {
    let roleIcon = "";
    let roleClass = "";
    switch (m.role) {
      case "system": roleIcon = "system"; roleClass = "debug-role-system"; break;
      case "user": roleIcon = "user"; roleClass = "debug-role-user"; break;
      case "assistant":
        roleIcon = m.tool_calls ? "assistant+tool" : "assistant";
        roleClass = "debug-role-assistant";
        break;
      case "tool": roleIcon = "tool"; roleClass = "debug-role-tool"; break;
    }
    let body = "";
    if (m.content) {
      body += escapeHtml(m.content);
    }
    if (m.tool_calls) {
      body += "\n\n" + m.tool_calls.map(t =>
        `[调用: ${t.function.name}(${t.function.arguments})]`
      ).join("\n");
    }
    if (m.reasoning_content) {
      body += `\n\n[思考: ${escapeHtml(m.reasoning_content.slice(0, 500))}${m.reasoning_content.length > 500 ? "..." : ""}]`;
    }
    return `<div class="debug-msg">
      <div class="debug-msg-head">
        <span class="debug-idx">#${i}</span>
        <span class="debug-role ${roleClass}">${roleIcon}</span>
      </div>
      <pre class="debug-msg-body">${body}</pre>
    </div>`;
  }).join("");

  let debugHttpHtml = "";
  if (debugLog.length) {
    debugHttpHtml = `<h4 style="margin:1rem 0 0.5rem;font-size:0.8rem;">HTTP 请求/响应 (${debugLog.length} 轮)</h4>`;
    for (const entry of debugLog) {
      debugHttpHtml += `<details class="msg-think" style="margin-bottom:0.5rem;">
        <summary>第 ${entry.round} 轮 — 请求</summary>
        <pre class="debug-msg-body">${escapeHtml(JSON.stringify(entry.request, null, 2))}</pre>
        ${entry.response ? `<div style="margin-top:0.5rem;font-size:0.65rem;color:var(--muted);">响应:</div><pre class="debug-msg-body">${escapeHtml(entry.response)}</pre>` : ""}
      </details>`;
    }
  }

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-box debug-modal">
      <div class="modal-header">
        <h3>调试：上下文 (${msgs.length} 条消息)</h3>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
      </div>
      <div class="modal-body">${debugHttpHtml}${msgRows}</div>
    </div>`;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
}

window.__showArticleModal = showArticleModal;
window.__closeArticleModal = closeModal;

function renderReasoning(reasoning, collapsed = false) {
  const tag = collapsed ? "details" : "details open";
  const label = collapsed ? "💭 思考过程" : "💭 思考中...";
  return `<${tag}><summary>${label}</summary><p style="color:var(--muted);font-size:0.85em;white-space:pre-wrap;">${(reasoning || "").replace(/</g, "&lt;")}</p></${tag}>`;
}

function parseToolKey(raw) {
  const idx = raw.indexOf(":");
  if (idx === -1) return { name: raw, query: raw };
  return { name: raw.slice(0, idx), query: raw.slice(idx + 1) };
}

async function sendMessage() {
  if (streaming) return;
  const text = textarea.value.trim();
  if (!text) return;

  const model = document.getElementById("chat-model").value;
  const effort = document.getElementById("chat-effort").value;
  const maxRounds = parseInt(document.getElementById("chat-max-rounds").value) || 10;
  const images = pastedImages.length ? [...pastedImages] : null;

  textarea.value = "";
  clearPastedImages();

  // 前端追加 user 消息
  messages.push({ role: "user", content: text });
  saveMessages();
  addMessage("user", text);
  currentAssistantMsg = addMessage("assistant", "思考中...");
  currentAssistantMsg.classList.add("typing");

  streaming = true;
  sendBtn.disabled = true;

  try {
    const res = await fetch(API_BASE + "/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + getToken(),
      },
      body: JSON.stringify({ messages, model, effort, max_rounds: maxRounds, images }),
    });

    if (res.status === 401) { throw new Error("未登录"); }
    if (res.status === 403) { throw new Error("未付费"); }
    if (!res.ok) throw new Error(res.statusText);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let reasoning = "";
    let content = "";
    let steps = [];  // [{type:"think"|"tool", text:...}，按时间顺序]
    const newMsgs = [];

    function flushReasoning() {
      if (reasoning) {
        steps.push({ type: "think", text: reasoning.replace(/</g, "&lt;") });
        reasoning = "";
      }
    }

    function renderAssistantBlock() {
      if (!currentAssistantMsg) return;
      let html = "";
      if (steps.length || reasoning) {
        html += '<details class="msg-think" open><summary>思考过程</summary><div class="think-steps">';
        for (const s of steps) {
          if (s.type === "tool") {
            html += `<div class="think-tool">${s.text}</div>`;
          } else {
            html += `<div class="think-step">${s.text}</div>`;
          }
        }
        if (reasoning) {
          html += `<div class="think-step">${reasoning.replace(/</g, "&lt;")}</div>`;
        }
        html += '</div></details>';
      }
      html += renderMarkdown(content);
      currentAssistantMsg.querySelector(".msg-body").innerHTML = html || "思考中...";
      currentAssistantMsg.classList.toggle("typing", !content);
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const dataStr = line.slice(6);
        if (dataStr === "[DONE]") continue;
        try {
          const obj = JSON.parse(dataStr);
          if (obj.debug) {
            window.__debugLog = window.__debugLog || [];
            window.__debugLog.push(obj.debug);
          } else if (obj.debug_response) {
            if (window.__debugLog?.length) {
              const last = window.__debugLog[window.__debugLog.length - 1];
              last.response = obj.debug_response;
            }
          } else if (obj.tool || obj.cached) {
            flushReasoning();
            const raw = obj.tool || obj.cached;
            const { name, query } = parseToolKey(raw);
            steps.push({ type: "tool", text: `${obj.tool ? "🔧" : "📋"} ${escapeHtml(name)}: ${escapeHtml(query)}` });
            const card = addToolCard(name, query);
            if (obj.cached) promoteCardIfEmpty(card);
          } else if (obj.articles) {
            populateCard(currentCard, obj.articles || []);
          } else if (obj.reasoning) {
            reasoning += obj.reasoning;
          } else if (obj.delta) {
            flushReasoning();
            content += obj.delta;
          } else if (obj.done && obj.messages) {
            for (const m of obj.messages) messages.push(m);
          }
          renderAssistantBlock();
        } catch {}
      }
      window.scrollTo(0, document.body.scrollHeight);
    }

    // finalize
    flushReasoning();
    renderAssistantBlock();
    currentAssistantMsg.classList.remove("typing");
    saveMessages();
    if (!content) {
      currentAssistantMsg.querySelector(".msg-body").textContent = "（无响应）";
    }
    window.__debugMessages = [...messages];

    for (const m of newMsgs) {
      messages.push(m);
    }
  } catch (e) {
    currentAssistantMsg.classList.remove("typing");
    currentAssistantMsg.querySelector(".msg-body").textContent = "请求失败: " + e.message;
    messages.pop();
  } finally {
    streaming = false;
    sendBtn.disabled = false;
    textarea.focus();
  }
}
