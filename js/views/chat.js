import { api, getToken } from "../api.js";

const API_BASE = window.__API_BASE__ || "";

let msgContainer, textarea, sendBtn;
let streaming = false;
let currentAssistantMsg = null;

// 前端维护的完整消息历史（含 system prompt）
let messages = [];

function newSession() {
  const now = new Date().toISOString();
  messages = [{
    role: "system",
    content: `你是清风研习社的AI助手，基于清风录制的复盘文章回答用户问题。优先使用 search_articles 工具检索相关文章，再基于文章内容给出有根据的回答。回答时注明引用来源（日期+标题）。如果找不到相关文章，如实告知。当前时间：${now}`
  }];
}

function simpleMarkdown(text) {
  if (!text) return "";
  let h = text
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

export async function init(container) {
  newSession();

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
    newSession();
    msgContainer.innerHTML = '<div class="chat-empty">新对话已开始</div>';
  });
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

    const text = await res.text();
    let reasoning = "";
    let content = "";
    const newMsgs = [];

    for (const line of text.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const dataStr = line.slice(6);
      if (dataStr === "[DONE]") continue;
      try {
        const obj = JSON.parse(dataStr);
        if (obj.reasoning) {
          reasoning += obj.reasoning;
        } else if (obj.delta) {
          content += obj.delta;
        } else if (obj.done && obj.messages) {
          for (const m of obj.messages) {
            newMsgs.push(m);
          }
        }
      } catch {}
    }

    currentAssistantMsg.classList.remove("typing");
    let html = "";
    if (reasoning) {
      html += `<details><summary>💭 思考过程</summary><p style="color:var(--muted);font-size:0.85em;white-space:pre-wrap;">${reasoning.replace(/</g,"&lt;")}</p></details>`;
    }
    html += simpleMarkdown(content || "（无响应）");
    currentAssistantMsg.querySelector(".msg-body").innerHTML = html;
    msgContainer.scrollTop = msgContainer.scrollHeight;

    for (const m of newMsgs) {
      messages.push(m);
    }

    if (!content.trim()) {
      currentAssistantMsg.querySelector(".msg-body").textContent = "（无响应）";
    }
  } catch (e) {
    currentAssistantMsg.classList.remove("typing");
    currentAssistantMsg.querySelector(".msg-body").textContent = "请求失败: " + e.message;
  } finally {
    streaming = false;
    sendBtn.disabled = false;
    textarea.focus();
  }
}
