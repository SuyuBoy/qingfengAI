import { api, getToken } from "../api.js";

const API_BASE = window.__API_BASE__ || "";

let msgContainer, textarea, sendBtn, thinkToggle;
let streaming = false;
let currentAssistantMsg = null;

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
    .replace(/<\/ul><br><li>/g, "</ul><ul><li>")
  return h;
}

export async function init(container) {
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
          <label class="think-toggle">
            <input type="checkbox" id="chat-thinking"> 思考模式
          </label>
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
  thinkToggle = container.querySelector("#chat-thinking");

  sendBtn.addEventListener("click", sendMessage);
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
}

function addMessage(role, content) {
  const empty = msgContainer.querySelector(".chat-empty");
  if (empty) empty.remove();
  const el = document.createElement("div");
  el.className = `chat-msg ${role}`;
  el.innerHTML = `<div class="role-label">${role === "user" ? "你" : "AI"}</div><div class="msg-body">${simpleMarkdown(content)}</div>`;
  msgContainer.appendChild(el);
  msgContainer.scrollTop = msgContainer.scrollHeight;
  return el;
}

async function sendMessage() {
  if (streaming) return;
  const text = textarea.value.trim();
  if (!text) return;

  const model = document.getElementById("chat-model").value;
  const thinking = thinkToggle.checked ? "enabled" : "disabled";

  textarea.value = "";
  addMessage("user", text);
  currentAssistantMsg = addMessage("assistant", "");

  streaming = true;
  sendBtn.disabled = true;

  try {
    const res = await fetch(API_BASE + "/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + getToken(),
      },
      body: JSON.stringify({ text, model, thinking }),
    });

    if (res.status === 401) { throw new Error("未登录"); }
    if (res.status === 403) { throw new Error("未付费"); }
    if (!res.ok) throw new Error(res.statusText);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);
        if (data === "[DONE]") continue;
        try {
          const obj = JSON.parse(data);
          if (obj.error) {
            content += `\n\n❌ ${obj.error}`;
          } else if (obj.delta) {
            content += obj.delta;
            currentAssistantMsg.querySelector(".msg-body").innerHTML = simpleMarkdown(content);
            msgContainer.scrollTop = msgContainer.scrollHeight;
          }
        } catch {}
      }
    }

    if (!content.trim()) {
      currentAssistantMsg.querySelector(".msg-body").textContent = "（无响应）";
    }
  } catch (e) {
    const body = currentAssistantMsg.querySelector(".msg-body");
    body.textContent = body.textContent || "请求失败: " + e.message;
  } finally {
    streaming = false;
    sendBtn.disabled = false;
    currentAssistantMsg.classList.remove("typing");
    textarea.focus();
  }
}
