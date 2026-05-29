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
  // 先处理表格
  let lines = text.split("\n");
  let out = [];
  let inTable = false;
  let tableRows = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("|") && line.endsWith("|")) {
      if (!inTable) { inTable = true; tableRows = []; }
      if (/^\|[\s\-:]+\|$/.test(line) && !line.match(/[^|\s\-:]/)) continue; // 分隔行跳过
      tableRows.push(line);
    } else {
      if (inTable) { out.push(_renderTable(tableRows)); tableRows = []; inTable = false; }
      out.push(line);
    }
  }
  if (inTable) out.push(_renderTable(tableRows));
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
    .replace(/\n(?!<)/g, "<br>")
    .replace(/(<li>.*?<\/li>(<br>)?)+/g, "<ul>$&</ul>")
  return h;
}

function _renderTable(rows) {
  if (!rows.length) return "";
  let html = "<table>";
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].split("|").filter(c => c.trim()).map(c => c.trim());
    const tag = i === 0 ? "th" : "td";
    html += "<tr>" + cells.map(c => `<${tag}>${c}</${tag}>`).join("") + "</tr>";
  }
  html += "</table>";
  return html;
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
            <option value="deepseek-v4-pro">v4 Pro</option>
            <option value="deepseek-v4-flash">v4 Flash</option>
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
  msgContainer.scrollTop = msgContainer.scrollHeight;
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
          if (obj.reasoning) {
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
      msgContainer.scrollTop = msgContainer.scrollHeight;
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
