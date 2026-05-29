import { api } from "../api.js";
const API_BASE = window.__API_BASE__ || "";
let marked_parser;

function fixImages(content, dynamic_id) {
  return content.replace(/!\[img:(\d+)\]/g, (_, idx) => `![图片](${API_BASE}/api/img/${dynamic_id}_${idx})`);
}

export async function init(container) {
  if (!marked_parser) {
    const { marked } = await import("https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js");
    marked_parser = marked;
  }
  container.innerHTML = `
    <button id="refresh-btn" class="refresh-btn">刷新</button>
    <div class="filter-bar">
      <button class="on" data-type="">全部</button>
      <button data-type="DYNAMIC_TYPE_ARTICLE">文章</button>
      <button data-type="DYNAMIC_TYPE_DRAW">图文</button>
      <button data-type="DYNAMIC_TYPE_WORD">文字</button>
    </div>
    <div class="tag-bar" id="tag-bar">
      <button class="on" data-tag="">全部</button>
    </div>
    <div id="card-list"></div>
    <button id="more-btn" style="display:none">加载更多</button>
  `;

  const listEl = document.getElementById("card-list");
  const moreBtn = document.getElementById("more-btn");
  const refreshBtn = document.getElementById("refresh-btn");
  const tagBar = document.getElementById("tag-bar");
  let currentFilter = "";
  let currentTag = "";
  let cursor = "";
  let hasMore = false;
  let allItems = [];

  const typeLabel = {
    DYNAMIC_TYPE_ARTICLE: "文章",
    DYNAMIC_TYPE_DRAW: "图文",
    DYNAMIC_TYPE_WORD: "文字",
  };

  function filtered() {
    let items = allItems;
    if (currentFilter) items = items.filter(it => it.type === currentFilter);
    if (currentTag) items = items.filter(it => (it.tags || "").split(",").includes(currentTag));
    return items;
  }

  function updateTags() {
    const tags = new Set();
    for (const it of allItems) {
      for (const t of (it.tags || "").split(",")) {
        if (t) tags.add(t);
      }
    }
    let html = '<button class="on" data-tag="">全部</button>';
    for (const t of [...tags].sort()) {
      html += `<button data-tag="${t}">${t}</button>`;
    }
    tagBar.innerHTML = html;
    if (tags.size === 0) tagBar.style.display = "none";
    else tagBar.style.display = "";
  }

  async function loadMore() {
    moreBtn.textContent = "加载中...";
    moreBtn.disabled = true;
    try {
      const data = await api.get("/api/dynamics", { limit: 20, cursor, type: "" });
      allItems = allItems.concat(data.items);
      hasMore = data.has_more;
      cursor = data.next_cursor;
      updateTags();
      render();
    } catch (e) {
      moreBtn.textContent = "加载失败，点此重试";
      moreBtn.disabled = false;
    }
  }

  async function initialLoad() {
    listEl.innerHTML = '<div class="loading">加载中...</div>';
    allItems = [];
    cursor = "";
    try {
      const data = await api.get("/api/dynamics", { limit: 20, type: "" });
      allItems = data.items;
      hasMore = data.has_more;
      cursor = data.next_cursor;
      updateTags();
    } catch (e) {
      listEl.innerHTML = `<div class="error">加载失败：${e.message}<br><button onclick="location.reload()">重试</button></div>`;
      return;
    }
    render();
  }

  function render() {
    const items = filtered();
    if (!items.length) { listEl.innerHTML = '<div class="empty">暂无数据</div>'; return; }

    const groups = {};
    for (const item of items) {
      const month = item.date.slice(0, 7);
      if (!groups[month]) groups[month] = [];
      groups[month].push(item);
    }
    let html = "";
    for (const [month, mItems] of Object.entries(groups).sort().reverse()) {
      html += `<div class="month-group"><div class="month-label">${month}</div>`;
      for (const item of mItems) {
        const label = typeLabel[item.type] || item.type.replace("DYNAMIC_TYPE_", "");
        const cls = item.type === "DYNAMIC_TYPE_ARTICLE" ? "article" : item.type === "DYNAMIC_TYPE_DRAW" ? "draw" : "word";
        const date = new Date(item.date).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
        const preview = item.content.length > 300 ? item.content.slice(0, 300) : "";
        const isLong = item.content.length > 300;
        const tagHtml = (item.tags || "").split(",").filter(Boolean).map(t => `<span class="tag-label">${t}</span>`).join("");
        html += `<div class="card" data-id="${item.dynamic_id}">
          <div class="meta"><span>${date}</span><span class="tag ${cls}">${label}</span>${tagHtml}</div>
          <div class="content${isLong ? " preview" : ""}">${marked_parser.parse(fixImages(isLong ? preview : item.content, item.dynamic_id))}</div>
          ${isLong ? '<button class="expand-btn">展开全文</button>' : ""}
        </div>`;
      }
      html += "</div>";
    }
    listEl.innerHTML = html;
    moreBtn.style.display = hasMore ? "block" : "none";
    moreBtn.textContent = "加载更多";
    moreBtn.disabled = false;
  }

  container.addEventListener("click", (e) => {
    if (e.target.closest(".filter-bar button")) {
      const btn = e.target.closest("button");
      currentFilter = btn.dataset.type;
      container.querySelectorAll(".filter-bar button").forEach(b => b.classList.toggle("on", b === btn));
      render();
      return;
    }
    if (e.target.closest(".tag-bar button")) {
      const btn = e.target.closest("button");
      currentTag = btn.dataset.tag;
      container.querySelectorAll(".tag-bar button").forEach(b => b.classList.toggle("on", b === btn));
      render();
      return;
    }
    if (e.target.closest(".expand-btn")) {
      const card = e.target.closest(".card");
      const id = card.dataset.id;
      const item = allItems.find(it => it.dynamic_id === id);
      if (item) {
        card.querySelector(".content").classList.remove("preview");
        card.querySelector(".content").innerHTML = marked_parser.parse(fixImages(item.content, item.dynamic_id));
        card.querySelector(".expand-btn").remove();
      }
      return;
    }
  });

  moreBtn.addEventListener("click", loadMore);
  refreshBtn.addEventListener("click", initialLoad);

  initialLoad();
}
