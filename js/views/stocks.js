import { api } from "../api.js";

let stocks = [];
let selectedCode = null;
let priceData = [];

export async function init(container) {
  const data = await api.get("/api/stocks/active");
  stocks = (data && data.stocks) || [];
  container.innerHTML = `
    <div class="stocks-layout">
      <div class="stock-list-panel">
        <h2>活跃股票 <span style="color:var(--muted);font-size:.9rem">${stocks.length} 只</span></h2>
        <div class="stock-list" id="stock-list"></div>
      </div>
      <div class="stock-chart-panel" id="chart-panel">
        <div class="chart-placeholder">选择一只股票查看K线</div>
      </div>
    </div>
  `;

  renderList();
}

function renderList() {
  const el = document.getElementById("stock-list");
  el.innerHTML = stocks.map(s => `
    <div class="stock-row ${selectedCode === s.order_book_id ? 'selected' : ''}"
         data-code="${s.order_book_id}"
         onclick="window._selectStock('${s.order_book_id}')">
      <span class="stock-symbol">${s.symbol}</span>
      <span class="stock-code">${s.order_book_id}</span>
      <span class="stock-meta">
        活跃${s.active_mentions}次 / 共${s.mention_count}次
      </span>
    </div>
  `).join("");
}

window._selectStock = async function (code) {
  selectedCode = code;
  const s = stocks.find(x => x.order_book_id === code);
  if (!s) return;

  // 高亮选中行
  document.querySelectorAll(".stock-row").forEach(r => {
    r.classList.toggle("selected", r.dataset.code === code);
  });

  const panel = document.getElementById("chart-panel");
  panel.innerHTML = `<div class="chart-loading">加载中...</div>`;

  try {
    const pricesResp = await api.get(`/api/stocks/prices/${code}?limit=200`);
    priceData = (pricesResp && pricesResp.prices) || [];
    renderChart(panel, s);
  } catch (e) {
    panel.innerHTML = `<div class="chart-placeholder">加载失败: ${e.message}</div>`;
  }
};

function renderChart(panel, s) {
  if (!priceData.length) {
    panel.innerHTML = `<div class="chart-placeholder">暂无K线数据</div>`;
    return;
  }

  const latest = priceData[priceData.length - 1];
  const first = priceData[0];

  panel.innerHTML = `
    <div class="chart-header">
      <h3>${s.symbol} <span class="stock-code">${s.order_book_id}</span></h3>
      <span>${s.industry_name} | ${first.datetime} ~ ${latest.datetime} | ${priceData.length}根</span>
    </div>
    <canvas id="kline-canvas" width="720" height="360"></canvas>
  `;

  drawKline();
}

function drawKline() {
  const canvas = document.getElementById("kline-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const padding = { top: 20, right: 60, bottom: 30, left: 60 };
  const pw = W - padding.left - padding.right;
  const ph = H - padding.top - padding.bottom;

  // 计算范围
  const highs = priceData.map(d => d.high);
  const lows = priceData.map(d => d.low);
  let maxH = Math.max(...highs);
  let minL = Math.min(...lows);
  const pad = (maxH - minL) * 0.05 || maxH * 0.01;
  maxH += pad; minL -= pad;

  const n = priceData.length;
  const barW = Math.max(1, pw / n * 0.7);
  const gap = pw / n;

  function x(i) { return padding.left + gap * i + gap / 2; }
  function y(v) { return padding.top + ph * (1 - (v - minL) / (maxH - minL)); }

  // 网格
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 0.5;
  for (let i = 0; i < 5; i++) {
    const yy = padding.top + ph * i / 4;
    ctx.beginPath(); ctx.moveTo(padding.left, yy); ctx.lineTo(W - padding.right, yy); ctx.stroke();
    ctx.fillStyle = "var(--muted)";
    ctx.font = "10px monospace";
    ctx.fillText((maxH - (maxH - minL) * i / 4).toFixed(2), W - padding.right + 4, yy + 4);
  }

  // K线
  for (let i = 0; i < n; i++) {
    const d = priceData[i];
    const isUp = d.close >= d.open;
    ctx.strokeStyle = isUp ? "#ef4444" : "#22c55e";
    ctx.fillStyle = isUp ? "#ef4444" : "#22c55e";

    // 影线
    ctx.beginPath();
    ctx.moveTo(x(i), y(d.high));
    ctx.lineTo(x(i), y(d.low));
    ctx.lineWidth = 1;
    ctx.stroke();

    // 实体
    const bodyH = Math.max(1, Math.abs(y(d.open) - y(d.close)));
    const bodyY = Math.min(y(d.open), y(d.close));
    ctx.fillRect(x(i) - barW / 2, bodyY, barW, bodyH);
  }

  // 成交量
  const volMax = Math.max(...priceData.map(d => d.volume));
  for (let i = 0; i < n; i++) {
    const d = priceData[i];
    const volH = Math.max(1, d.volume / volMax * ph * 0.3);
    ctx.fillStyle = d.close >= d.open ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)";
    ctx.fillRect(x(i) - barW / 2, H - padding.bottom - volH, barW, volH);
  }
}
