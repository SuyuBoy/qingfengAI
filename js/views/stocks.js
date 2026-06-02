import { api } from "../api.js";

let stocks = [];
let sortBy = "active_mentions";
let sortDir = -1;
let selectedCode = null;
let priceData = [];

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

  const panel = document.getElementById("chart-panel");
  panel.innerHTML = `<div class="chart-loading">加载中...</div>`;

  try {
    const resp = await api.get(`/api/stocks/prices/${code}?limit=200`);
    priceData = (resp && resp.prices) || [];
    renderChart(panel, stocks.find(s => s.order_book_id === code));
  } catch (e) {
    panel.innerHTML = `<div class="chart-placeholder">加载失败: ${e.message}</div>`;
  }
};

function renderChart(panel, s) {
  if (!priceData.length) {
    panel.innerHTML = `<div class="chart-placeholder">暂无K线数据</div>`;
    return;
  }
  if (!s) return;

  const latest = priceData[priceData.length - 1];
  const first = priceData[0];

  panel.innerHTML = `
    <div class="chart-header">
      <h3>${esc(s.symbol)} <span class="stock-code">${esc(s.order_book_id)}</span></h3>
      <span>${esc(s.industry_name || "")} | ${first.datetime} ~ ${latest.datetime} | ${priceData.length}根</span>
    </div>
    <canvas id="kline-canvas"></canvas>
  `;

  // 自适应 canvas 尺寸
  const canvas = document.getElementById("kline-canvas");
  canvas.width = canvas.parentElement.clientWidth - 32;
  canvas.height = Math.min(500, window.innerHeight * 0.6);
  drawKline();
}

function drawKline() {
  const canvas = document.getElementById("kline-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const pad = { top: 20, right: 60, bottom: 40, left: 60 };
  const pw = W - pad.left - pad.right;
  const ph = H - pad.top - pad.bottom;

  const highs = priceData.map(d => d.high);
  const lows = priceData.map(d => d.low);
  let maxH = Math.max(...highs), minL = Math.min(...lows);
  const range = (maxH - minL) * 0.05 || maxH * 0.01;
  maxH += range; minL -= range;

  const n = priceData.length;
  const gap = pw / n;
  const barW = Math.max(1, gap * 0.7);

  const x = i => pad.left + gap * i + gap / 2;
  const y = v => pad.top + ph * (1 - (v - minL) / (maxH - minL));

  // 网格
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const yy = pad.top + ph * i / 4;
    ctx.beginPath(); ctx.moveTo(pad.left, yy); ctx.lineTo(W - pad.right, yy); ctx.stroke();
    ctx.fillStyle = "#888";
    ctx.font = "10px monospace";
    ctx.fillText((maxH - (maxH - minL) * i / 4).toFixed(2), W - pad.right + 4, yy + 4);
  }

  // K线
  for (let i = 0; i < n; i++) {
    const d = priceData[i];
    const up = d.close >= d.open;
    ctx.strokeStyle = up ? "#ef4444" : "#22c55e";
    ctx.fillStyle = up ? "#ef4444" : "#22c55e";
    ctx.beginPath();
    ctx.moveTo(x(i), y(d.high));
    ctx.lineTo(x(i), y(d.low));
    ctx.lineWidth = 1;
    ctx.stroke();
    const bh = Math.max(1, Math.abs(y(d.open) - y(d.close)));
    const by = Math.min(y(d.open), y(d.close));
    ctx.fillRect(x(i) - barW / 2, by, barW, bh);
  }

  // 成交量
  const volMax = Math.max(...priceData.map(d => d.volume));
  for (let i = 0; i < n; i++) {
    const d = priceData[i];
    const vh = Math.max(1, d.volume / volMax * ph * 0.25);
    const up = d.close >= d.open;
    ctx.fillStyle = up ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)";
    ctx.fillRect(x(i) - barW / 2, H - pad.bottom - vh, barW, vh);
  }
}

function esc(s) { return (s || "").replace(/</g, "&lt;"); }
