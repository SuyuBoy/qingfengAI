import { api, getToken } from "../api.js";

const API_BASE = window.__API_BASE__ || "";

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
  messages = [{
    role: "system",
    content: `你是清风研习社的AI助手，基于清风录制的复盘文章回答用户问题。优先使用 search_articles 工具检索相关文章，再基于文章内容给出有根据的回答。回答时注明引用来源（日期+标题）。如果找不到相关文章，如实告知。当前时间：${now}`
  }];
  saveMessages();
}

function simpleMarkdown(text) {
  if (!text) return "";
  const htmlBlocks = [];
  const stashHtml = (html) => {
    const key = `@@CHAT_HTML_${htmlBlocks.length}@@`;
    htmlBlocks.push(html);
    return key;
  };
  const textWithTables = text.replace(/<table[\s\S]*?<\/table>/gi, (tableHtml) => {
    return "\n" + stashHtml(_renderHtmlTable(tableHtml)) + "\n";
  });

  let lines = textWithTables.split("\n");
  const out = [];
  let inTable = false;
  let tableRows = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("@@CHAT_HTML_")) {
      if (inTable) { out.push(stashHtml(_renderMarkdownTable(tableRows))); tableRows = []; inTable = false; }
      out.push(line);
      continue;
    }
    if (line.startsWith("|") && line.endsWith("|")) {
      if (!inTable) { inTable = true; tableRows = []; }
      tableRows.push(line);
    } else {
      if (inTable) { out.push(stashHtml(_renderMarkdownTable(tableRows))); tableRows = []; inTable = false; }
      if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line)) {
        out.push(stashHtml("<hr>"));
        continue;
      }
      out.push(line);
    }
  }
  if (inTable) out.push(stashHtml(_renderMarkdownTable(tableRows)));
  let h = out.join("\n")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%">')
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/\n{2,}/g, "\n\n")
    .replace(/\n(?!<|@@CHAT_HTML_)/g, "<br>")
    .replace(/(<li>.*?<\/li>(<br>)?)+/g, "<ul>$&</ul>")
    .replace(/@@CHAT_HTML_(\d+)@@/g, (_, idx) => htmlBlocks[Number(idx)] || "")
    .replace(/<br>(<(?:table|hr)\b)/g, "$1")
    .replace(/(<\/table>|<hr>)<br>/g, "$1");
  return h;
}

function _renderMarkdownTable(rows) {
  if (!rows.length) return "";
  const bodyRows = rows.filter(row => !_isMarkdownTableSeparator(row));
  if (!bodyRows.length) return "";
  let html = "<table>";
  for (let i = 0; i < bodyRows.length; i++) {
    const cells = _splitMarkdownTableRow(bodyRows[i]);
    const tag = i === 0 ? "th" : "td";
    html += "<tr>" + cells.map(c => `<${tag}>${_inlineMarkdown(c)}</${tag}>`).join("") + "</tr>";
  }
  html += "</table>";
  return html;
}

function _renderHtmlTable(tableHtml) {
  const rows = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  if (!rows.length) return "";
  let html = "<table>";
  for (const row of rows) {
    const cells = [...row.matchAll(/<(th|td)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)];
    if (!cells.length) continue;
    const normalizedCells = cells.map(([, tag, cell]) => ({
      tag: tag.toLowerCase() === "th" ? "th" : "td",
      text: _htmlToText(cell),
    }));
    if (_isTableSeparatorCells(normalizedCells.map(cell => cell.text))) continue;
    html += "<tr>" + normalizedCells.map(cell => {
      return `<${cell.tag}>${_inlineMarkdown(cell.text)}</${cell.tag}>`;
    }).join("") + "</tr>";
  }
  html += "</table>";
  return html === "<table></table>" ? "" : html;
}

function _splitMarkdownTableRow(row) {
  return row.replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
}

function _isMarkdownTableSeparator(row) {
  const cells = _splitMarkdownTableRow(row);
  return _isTableSeparatorCells(cells);
}

function _isTableSeparatorCells(cells) {
  return cells.length > 0 && cells.every(c => /^:?-{3,}:?$/.test(c.replace(/\s/g, "")));
}

function _inlineMarkdown(text) {
  return _escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function _htmlToText(html) {
  const withoutTags = html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
  if (typeof document !== "undefined") {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = withoutTags;
    return textarea.value.trim();
  }
  return withoutTags.trim();
}

function _escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const escapeHtml = _escapeHtml;

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
            <button class="model-btn" id="chat-debug-btn">调试</button>
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

  // 调试按钮
  const debugBtn = container.querySelector("#chat-debug-btn");
  if (debugBtn) debugBtn.addEventListener("click", showDebugModal);

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
  el.innerHTML = `<div class="role-label">${label}</div><div class="msg-body">${simpleMarkdown(content || "")}</div>`;
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
}

function addToolCard(toolName, searchQuery) {
  if (!sidebar) return;
  expandSidebar(chatView);
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
  sidebar.insertBefore(card, sidebar.firstChild);
  currentCard = card;
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
    <div class="modal-body">${simpleMarkdown(content)}</div>
  `;
}

function closeModal() {
  const overlay = document.querySelector(".modal-overlay");
  if (overlay) overlay.remove();
}

function showDebugModal() {
  const msgs = window.__debugMessages || messages;
  const rows = msgs.map((m, i) => {
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

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-box debug-modal">
      <div class="modal-header">
        <h3>调试：上下文 (${msgs.length} 条消息)</h3>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
      </div>
      <div class="modal-body">${rows}</div>
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
      body: JSON.stringify({ messages, model, effort, images }),
    });

    if (res.status === 401) { throw new Error("未登录"); }
    if (res.status === 403) { throw new Error("未付费"); }
    if (!res.ok) throw new Error(res.statusText);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let reasoning = "";
    let content = "";
    const newMsgs = [];

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
          if (obj.tool || obj.cached) {
            const raw = obj.tool || obj.cached;
            const { name, query } = parseToolKey(raw);
            addMessage("tool", (obj.tool ? "🔧 " : "📋 缓存: ") + raw);
            if (currentAssistantMsg) {
              currentAssistantMsg.classList.remove("typing");
              if (reasoning && !content) {
                currentAssistantMsg.querySelector(".msg-body").innerHTML = renderReasoning(reasoning, true);
              }
            }
            currentAssistantMsg = addMessage("assistant", "思考中...");
            currentAssistantMsg.classList.add("typing");
            reasoning = "";
            content = "";
            const card = addToolCard(name, query);
            if (obj.cached) promoteCardIfEmpty(card);
          } else if (obj.articles) {
            populateCard(currentCard, obj.articles || []);
          } else if (obj.reasoning) {
            reasoning += obj.reasoning;
            if (currentAssistantMsg) {
              currentAssistantMsg.querySelector(".msg-body").innerHTML =
                renderReasoning(reasoning, false) + simpleMarkdown(content);
            }
          } else if (obj.delta) {
            content += obj.delta;
            if (currentAssistantMsg) {
              let html = reasoning ? renderReasoning(reasoning, true) : "";
              html += simpleMarkdown(content);
              currentAssistantMsg.querySelector(".msg-body").innerHTML = html;
            }
          } else if (obj.done && obj.messages) {
            for (const m of obj.messages) messages.push(m);
          }
        } catch {}
      }
      window.scrollTo(0, document.body.scrollHeight);
    }

    currentAssistantMsg.classList.remove("typing");
    saveMessages();
    if (!content) {
      currentAssistantMsg.querySelector(".msg-body").textContent = "（无响应）";
    }
    // 调试模式：始终收集上下文（弹窗使用）
    window.__debugMessages = [...messages];

    for (const m of newMsgs) {
      messages.push(m);
    }

    if (!content.trim()) {
      currentAssistantMsg.querySelector(".msg-body").textContent = "（无响应）";
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
