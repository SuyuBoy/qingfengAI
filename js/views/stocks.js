import { api } from "../api.js";

let stocks = [];
let sortBy = "active_mentions";
let sortDir = -1;
let selectedCode = null;
let selectedStock = null;
let chart = null;

export async function init(container) {
  const data = await api.get("/api/stocks/active");
  stocks = (data && data.stocks) || [];
  sort();
  container.innerHTML = `
    <div class="stocks-layout">
      <div class="stock-list-panel">
        <h2>活跃股票 <span style="color:var(--muted);font-size:.9rem">${stocks.length} 只</span></h2>
        <div class="sort-bar">
          ${sortBtn("活跃次数", "active_mentions")}
          ${sortBtn("总提及", "mention_count")}
          ${sortBtn("最新", "last_mentioned")}
        </div>
        <div class="stock-list" id="stock-list"></div>
      </div>
      <div class="stock-chart-panel" id="chart-panel">
        <div class="chart-placeholder">选择一只股票查看K线</div>
      </div>
    </div>
  `;
  renderList();
}

function sortBtn(label, key) {
  const active = sortBy === key;
  const arrow = active ? (sortDir > 0 ? "↑" : "↓") : "";
  return `<button class="sort-btn${active ? " active" : ""}" onclick="window._sortStocks('${key}')">${label} ${arrow}</button>`;
}

window._sortStocks = function (key) {
  if (sortBy === key) sortDir = -sortDir;
  else { sortBy = key; sortDir = -1; }
  sort();
  renderList();
};

function sort() {
  stocks.sort((a, b) => {
    if (sortBy === "last_mentioned") {
      return (a[sortBy] || "").localeCompare(b[sortBy] || "") * sortDir;
    }
    return ((a[sortBy] || 0) - (b[sortBy] || 0)) * sortDir;
  });
}

function renderList() {
  const el = document.getElementById("stock-list");
  if (!el) return;
  el.innerHTML = stocks.map(s => `
    <div class="stock-row ${selectedCode === s.order_book_id ? "selected" : ""}"
         data-code="${s.order_book_id}"
         onclick="window._selectStock('${s.order_book_id}')">
      <span class="stock-symbol">${esc(s.symbol)}</span>
      <span class="stock-code">${esc(s.order_book_id)}</span>
      <span class="stock-meta">活跃${s.active_mentions} / 共${s.mention_count} / ${s.last_mentioned}</span>
    </div>
  `).join("");
}

window._selectStock = async function (code) {
  selectedCode = code;
  document.querySelectorAll(".stock-row").forEach(r => {
    r.classList.toggle("selected", r.dataset.code === code);
  });

  selectedStock = stocks.find(s => s.order_book_id === code);
  if (!selectedStock) return;

  const panel = document.getElementById("chart-panel");
  panel.innerHTML = `<div class="chart-loading">加载中...</div>`;

  try {
    const resp = await api.get(`/api/stocks/prices/${code}?limit=200`);
    const priceData = (resp && resp.prices) || [];
    renderChart(panel, priceData);
  } catch (e) {
    panel.innerHTML = `<div class="chart-placeholder">加载失败: ${e.message}</div>`;
  }
};

function renderChart(panel, priceData) {
  if (!priceData.length) {
    panel.innerHTML = `<div class="chart-placeholder">暂无K线数据</div>`;
    return;
  }

  const s = selectedStock;
  const first = priceData[0], latest = priceData[priceData.length - 1];

  panel.innerHTML = `
    <div class="chart-header">
      <h3>${esc(s.symbol)} <span class="stock-code">${esc(s.order_book_id)}</span></h3>
      <span>${esc(s.industry_name || "")} | ${first.datetime} ~ ${latest.datetime} | ${priceData.length}根</span>
    </div>
    <div id="kline-container" style="width:100%;height:calc(100vh - 160px)"></div>
  `;

  // 转换数据格式
  const klineData = priceData.map(d => ({
    timestamp: datetimeToTs(d.datetime),
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
    volume: d.volume,
    turnover: d.amount || 0,
  }));

  // 销毁旧图表
  if (chart) { chart.dispose(); chart = null; }

  chart = klinecharts.init("kline-container", {
    styles: {
      grid: { horizontal: { color: "rgba(255,255,255,0.06)" }, vertical: { color: "rgba(255,255,255,0.06)" } },
      candle: { bar: { upColor: "#ef4444", downColor: "#22c55e", upBorderColor: "#ef4444", downBorderColor: "#22c55e" } },
    },
  });
  chart.applyNewData(klineData);
}

function datetimeToTs(dt) {
  // "2026-05-20-09-31" → timestamp ms
  const [d, t] = dt.split("-").reduce((a, v, i) => {
    if (i < 3) { a[0] = (a[0] || "") + (a[0] ? "-" : "") + v; }
    else { a[1] = (a[1] || "") + (a[1] ? ":" : "") + v; }
    return a;
  }, ["", ""]);
  return new Date(d + "T" + t + ":00+08:00").getTime();
}

function esc(s) { return (s || "").replace(/</g, "&lt;"); }
