import { api, getToken } from "../api.js";

const API_BASE = window.__API_BASE__ || "";

let msgContainer, textarea, sendBtn;
const CHAT_KEY = "chat_messages";
let streaming = false;
let currentAssistantMsg = null;

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

export async function init(container) {
  const saved = loadMessages();
  if (saved) {
    messages = saved;
  } else {
    newSession();
  }

  container.innerHTML = `
    <div id="chat-view">
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
          <label class="think-toggle"><input type="checkbox" id="chat-debug"> 调试</label>
          <button class="model-btn" id="chat-clear">新对话</button>
        </div>
        <div class="chat-send-row">
          <textarea id="chat-input" rows="1" placeholder="输入问题..."></textarea>
          <button id="chat-send">发送</button>
        </div>
      </div>
    </div>
  `;

  msgContainer = container.querySelector(".chat-messages");
  textarea = container.querySelector("#chat-input");
  sendBtn = container.querySelector("#chat-send");

  sendBtn.addEventListener("click", sendMessage);
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  container.querySelector("#chat-clear").addEventListener("click", () => {
    if (streaming) return;
    newSession();
    msgContainer.innerHTML = '<div class="chat-empty">新对话已开始</div>';
  });

  // 渲染历史对话
  if (saved) {
    for (const m of messages) {
      if (m.role === "user") addMessage("user", m.content);
      else if (m.role === "assistant" && m.content) addMessage("assistant", m.content);
    }
  }
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

async function sendMessage() {
  if (streaming) return;
  const text = textarea.value.trim();
  if (!text) return;

  const model = document.getElementById("chat-model").value;
  const effort = document.getElementById("chat-effort").value;

  textarea.value = "";

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
      body: JSON.stringify({ messages, model, effort }),
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
          if (obj.tool) {
            addMessage("tool", "🔧 " + obj.tool);
          } else if (obj.reasoning) {
            reasoning += obj.reasoning;
            currentAssistantMsg.querySelector(".msg-body").innerHTML =
              `<details open><summary>💭 思考中...</summary><p style="color:var(--muted);font-size:0.85em;">${reasoning.replace(/</g,"&lt;")}</p></details>` + simpleMarkdown(content);
          } else if (obj.delta) {
            content += obj.delta;
            let html = "";
            if (reasoning) html += `<details><summary>💭 思考过程</summary><p style="color:var(--muted);font-size:0.85em;white-space:pre-wrap;">${reasoning.replace(/</g,"&lt;")}</p></details>`;
            html += simpleMarkdown(content);
            currentAssistantMsg.querySelector(".msg-body").innerHTML = html;
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
    // 调试模式：显示完整请求上下文
    if (document.getElementById("chat-debug")?.checked) {
      const allMsgs = JSON.stringify(messages, null, 2);
      addMessage("assistant", `<details><summary>🔧 调试：请求上下文 (${messages.length} 条消息)</summary><pre style="font-size:0.75em;max-height:400px;overflow:auto;">${allMsgs.replace(/</g,"&lt;")}</pre></details>`);
    }

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
