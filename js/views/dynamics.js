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
    <div class="top-row">
      <div class="search-bar">
        <input type="text" id="search-kw" placeholder="搜索标题关键词...">
        <button id="search-btn">搜索</button>
        <button id="search-clear-btn" class="clear-btn" style="display:none">清空</button>
      </div>
      <div class="cal-group">
        <button id="cal-btn" class="cal-btn" title="按日期筛选">📅</button>
        <span id="cal-label" class="cal-label"></span>
        <button id="cal-reset" class="clear-btn" style="display:none">重置</button>
        <input type="date" id="date-pick" style="display:none">
      </div>
    </div>
    <div id="card-list"></div>
    <button id="more-btn" style="display:none">加载更多</button>
  `;

  const listEl = document.getElementById("card-list");
  const moreBtn = document.getElementById("more-btn");
  const refreshBtn = document.getElementById("refresh-btn");
  const searchKw = document.getElementById("search-kw");
  const searchBtn = document.getElementById("search-btn");
  const searchClear = document.getElementById("search-clear-btn");
  const calBtn = document.getElementById("cal-btn");
  const calLabel = document.getElementById("cal-label");
  const calReset = document.getElementById("cal-reset");
  const datePick = document.getElementById("date-pick");
  let cursor = "";
  let hasMore = false;
  let allItems = [];
  let searchMode = false;
  let currentDate = "";

  function filtered() {
    if (!currentDate) return allItems;
    return allItems.filter(it => it.date.slice(0, 10) === currentDate);
  }

  function render() {
    const items = filtered();
    if (!items.length) { listEl.innerHTML = '<div class="empty">暂无数据</div>'; return; }

    const groups = {};
    for (const item of items) {
      const d = item.date.slice(0, 10);
      if (!groups[d]) groups[d] = [];
      groups[d].push(item);
    }
    let html = "";
    for (const [d, dItems] of Object.entries(groups).sort().reverse()) {
      html += `<div class="month-group"><div class="month-label">${d}</div>`;
      for (const item of dItems) {
        const dateStr = new Date(item.date).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
        const preview = item.content.length > 300 ? item.content.slice(0, 300) : "";
        const isLong = item.content.length > 300;
        html += `<div class="card" data-id="${item.dynamic_id}">
          <div class="meta"><span>${dateStr}</span></div>
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

  async function loadMore() {
    moreBtn.textContent = "加载中...";
    moreBtn.disabled = true;
    try {
      const data = await api.get("/api/dynamics", { limit: 20, cursor, type: "" });
      allItems = allItems.concat(data.items);
      hasMore = data.has_more;
      cursor = data.next_cursor;
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
    } catch (e) {
      listEl.innerHTML = `<div class="error">加载失败：${e.message}<br><button onclick="location.reload()">重试</button></div>`;
      return;
    }
    render();
  }

  async function doSearch() {
    const keyword = searchKw.value.trim();
    if (!keyword) return;
    searchMode = true;
    allItems = [];
    cursor = "";
    hasMore = false;
    searchClear.style.display = "";
    listEl.innerHTML = '<div class="loading">搜索中...</div>';
    try {
      const data = await api.get("/api/search", { keyword, limit: 50 });
      allItems = data.items;
      render();
    } catch (e) {
      listEl.innerHTML = `<div class="error">搜索失败：${e.message}</div>`;
    }
  }

  function clearSearch() {
    searchMode = false;
    searchKw.value = "";
    searchClear.style.display = "none";
    initialLoad();
  }

  function setDate(d) {
    currentDate = d;
    if (d) {
      calLabel.textContent = d;
      calReset.style.display = "";
    } else {
      calLabel.textContent = "";
      calReset.style.display = "none";
    }
    render();
  }

  container.addEventListener("click", (e) => {
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

  searchBtn.addEventListener("click", doSearch);
  searchKw.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });
  searchClear.addEventListener("click", clearSearch);
  calBtn.addEventListener("click", () => datePick.showPicker ? datePick.showPicker() : datePick.click());
  datePick.addEventListener("change", () => setDate(datePick.value));
  calReset.addEventListener("click", () => { datePick.value = ""; setDate(""); });
  moreBtn.addEventListener("click", searchMode ? null : loadMore);
  refreshBtn.addEventListener("click", searchMode ? clearSearch : initialLoad);

  initialLoad();
}
