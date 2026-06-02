import { api } from "../api.js";

let stocks = [];
let sortBy = "active_mentions";
let sortDir = -1;
let selectedCode = null;
let selectedStock = null;
let chart = null;
let allPriceCache = {};  // code → prices[]

// 清风指数参数
const idxParams = {
  mentionPower: 1.0,      // 提及次数幂
  decayDays: 10,           // 衰减半衰期（天）
  baseDate: "2026-06-01",  // 基准日期
};
let idxSeries = null;  // [{timestamp, value}, ...]

// ---- 初始化 ----

export async function init(container) {
  const data = await api.get("/api/stocks/active");
  stocks = (data && data.stocks) || [];
  sort();
  render(container);
  // 预热：拉取指数成分股价格
  preloadIndexPrices();
}

function render(container) {
  container.innerHTML = `
    <div class="stocks-layout">
      <div class="stock-list-panel">
        <h2>清风指数</h2>
        <div class="index-card" id="index-card">
          <div class="index-value" id="index-value">--</div>
          <div class="index-change" id="index-change"></div>
          <div class="index-meta" id="index-meta"></div>
          <button class="param-btn" onclick="window._toggleParams()">参数</button>
          <div class="param-panel" id="param-panel" style="display:none">
            <label>提及幂 <input id="param-power" type="number" value="${idxParams.mentionPower}" step="0.1" min="0"></label>
            <label>衰减半衰期(天) <input id="param-decay" type="number" value="${idxParams.decayDays}" step="1" min="1"></label>
            <label>基准日 <input id="param-date" type="date" value="${idxParams.baseDate}"></label>
            <button onclick="window._applyParams()">应用</button>
          </div>
        </div>

        <h2 style="margin-top:1rem">活跃股票 <span style="color:var(--muted);font-size:.9rem">${stocks.length} 只</span></h2>
        <div class="sort-bar">
          ${sortBtn("活跃次数", "active_mentions")}
          ${sortBtn("总提及", "mention_count")}
          ${sortBtn("最新", "last_mentioned")}
        </div>
        <div class="stock-list" id="stock-list"></div>
      </div>
      <div class="stock-chart-panel" id="chart-panel">
        <div class="chart-placeholder">选择一只股票 或 点击「清风指数」查看K线</div>
      </div>
    </div>
  `;
  renderList();
  updateIndexDisplay();
}

// ---- 排序 ----

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
    if (sortBy === "last_mentioned") return (a[sortBy] || "").localeCompare(b[sortBy] || "") * sortDir;
    return ((a[sortBy] || 0) - (b[sortBy] || 0)) * sortDir;
  });
}

// ---- 列表渲染 ----

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

// ---- 选中股票 ----

window._selectStock = async function (code) {
  selectedCode = code;
  selectedStock = stocks.find(s => s.order_book_id === code);
  document.querySelectorAll(".stock-row").forEach(r => r.classList.toggle("selected", r.dataset.code === code));
  document.getElementById("index-card")?.classList.remove("selected");

  if (!selectedStock) return;
  const panel = document.getElementById("chart-panel");
  panel.innerHTML = `<div class="chart-loading">加载中...</div>`;

  try {
    const resp = await api.get(`/api/stocks/prices/${code}?limit=200`);
    const prices = (resp && resp.prices) || [];
    allPriceCache[code] = prices;
    showChart(panel, prices, selectedStock);
  } catch (e) {
    panel.innerHTML = `<div class="chart-placeholder">加载失败: ${e.message}</div>`;
  }
};

// ---- 清风指数 ----

function computeWeights() {
  const now = new Date(idxParams.baseDate + "T00:00:00+08:00");
  const decay = idxParams.decayDays;
  const power = idxParams.mentionPower;

  const weights = {};
  let totalW = 0;
  for (const s of stocks) {
    if (!s.last_mentioned) continue;
    const days = Math.max(0, (now - new Date(s.last_mentioned + "T00:00:00+08:00")) / 86400000);
    const w = Math.pow(s.mention_count || 1, power) * Math.pow(0.5, days / decay);
    weights[s.order_book_id] = w;
    totalW += w;
  }
  // 归一化
  if (totalW > 0) {
    for (const k in weights) weights[k] /= totalW;
  }
  return weights;
}

async function preloadIndexPrices() {
  // 拉取加权 top 10 的股票价格
  const weights = computeWeights();
  const top = Object.entries(weights).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const seen = new Set();
  for (const [code] of top) {
    if (seen.has(code)) continue;
    seen.add(code);
    try {
      const resp = await api.get(`/api/stocks/prices/${code}?limit=200`);
      if (resp && resp.prices) allPriceCache[code] = resp.prices;
    } catch (e) { /* skip */ }
  }
  computeIndex();
  updateIndexDisplay();
}

function computeIndex() {
  const weights = computeWeights();
  const timeMap = {};  // datetime → {weightedSum, totalWeight}

  for (const code in allPriceCache) {
    const w = weights[code];
    if (!w || w <= 0) continue;
    const prices = allPriceCache[code];
    if (!prices || !prices.length) continue;

    // 归一化基价：用第一天收盘价
    const base = prices[0].close || 1;
    for (const p of prices) {
      const dt = p.datetime;
      if (!timeMap[dt]) timeMap[dt] = { ws: 0, tw: 0 };
      timeMap[dt].ws += (p.close / base) * w * 1000;
      timeMap[dt].tw += w;
    }
  }

  idxSeries = Object.entries(timeMap)
    .map(([dt, v]) => ({ timestamp: datetimeToTs(dt), value: v.tw > 0 ? v.ws / v.tw : 0 }))
    .sort((a, b) => a.timestamp - b.timestamp);

  // 去除异常跳变
  for (let i = 1; i < idxSeries.length; i++) {
    const prev = idxSeries[i - 1].value;
    const cur = idxSeries[i].value;
    if (prev > 0 && Math.abs(cur / prev - 1) > 0.3) {
      idxSeries[i].value = prev; // 平滑处理
    }
  }
}

function updateIndexDisplay() {
  const el = document.getElementById("index-value");
  const chg = document.getElementById("index-change");
  const meta = document.getElementById("index-meta");
  if (!el) return;
  if (!idxSeries || idxSeries.length < 2) {
    el.textContent = "加载中...";
    return;
  }
  const last = idxSeries[idxSeries.length - 1].value;
  const prev = idxSeries[idxSeries.length - 2].value;
  const change = last - prev;
  const pct = prev > 0 ? ((change / prev) * 100) : 0;

  el.textContent = last.toFixed(2);
  chg.innerHTML = `<span style="color:${change >= 0 ? '#ef4444' : '#22c55e'}">${change >= 0 ? '+' : ''}${change.toFixed(2)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)</span>`;
  meta.textContent = `${idxSeries.length} 个时间点 | 加权${Object.keys(computeWeights()).length}只成分股`;

  // 点击指数卡片查看K线
  document.getElementById("index-card").onclick = () => {
    selectedCode = null; selectedStock = null;
    document.querySelectorAll(".stock-row").forEach(r => r.classList.remove("selected"));
    document.getElementById("index-card").classList.add("selected");
    showIndexChart();
  };
}

function showIndexChart() {
  const panel = document.getElementById("chart-panel");
  if (!idxSeries || !idxSeries.length) {
    panel.innerHTML = `<div class="chart-placeholder">指数计算中...</div>`;
    return;
  }
  panel.innerHTML = `
    <div class="chart-header">
      <h3>清风指数</h3>
      <span>加权综合指数 | ${idxSeries.length}点</span>
    </div>
    <div id="kline-container" style="width:100%;height:calc(100vh - 160px)"></div>
  `;
  if (chart) { chart.dispose(); chart = null; }
  chart = klinecharts.init("kline-container", {
    styles: {
      grid: { horizontal: { color: "rgba(255,255,255,0.06)" }, vertical: { color: "rgba(255,255,255,0.06)" } },
      candle: { bar: { upColor: "#ef4444", downColor: "#22c55e", upBorderColor: "#ef4444", downBorderColor: "#22c55e" } },
    },
  });
  chart.setSymbol({ ticker: "清风指数" });
  chart.setPeriod({ span: 1, type: "min" });
  chart.setDataLoader({ getBars: ({ callback }) => { callback(idxSeries); } });
}

// ---- 个股K线 ----

function showChart(panel, prices, s) {
  if (!prices.length) {
    panel.innerHTML = `<div class="chart-placeholder">暂无K线数据</div>`;
    return;
  }
  const first = prices[0], latest = prices[prices.length - 1];
  panel.innerHTML = `
    <div class="chart-header">
      <h3>${esc(s.symbol)} <span class="stock-code">${esc(s.order_book_id)}</span></h3>
      <span>${esc(s.industry_name || "")} | ${first.datetime} ~ ${latest.datetime} | ${prices.length}根</span>
    </div>
    <div id="kline-container" style="width:100%;height:calc(100vh - 160px)"></div>
  `;

  const klineData = prices.map(d => ({
    timestamp: datetimeToTs(d.datetime),
    open: d.open, high: d.high, low: d.low, close: d.close,
    volume: d.volume, turnover: d.amount || 0,
  }));

  if (chart) { chart.dispose(); chart = null; }
  chart = klinecharts.init("kline-container", {
    styles: {
      grid: { horizontal: { color: "rgba(255,255,255,0.06)" }, vertical: { color: "rgba(255,255,255,0.06)" } },
      candle: { bar: { upColor: "#ef4444", downColor: "#22c55e", upBorderColor: "#ef4444", downBorderColor: "#22c55e" } },
    },
  });
  chart.setSymbol({ ticker: s.symbol });
  chart.setPeriod({ span: 1, type: "min" });
  chart.setDataLoader({ getBars: ({ callback }) => { callback(klineData); } });
}

// ---- 参数面板 ----

window._toggleParams = function (e) {
  e.stopPropagation();
  const p = document.getElementById("param-panel");
  p.style.display = p.style.display === "none" ? "block" : "none";
};

window._applyParams = function () {
  idxParams.mentionPower = parseFloat(document.getElementById("param-power").value) || 1.0;
  idxParams.decayDays = parseInt(document.getElementById("param-decay").value) || 10;
  idxParams.baseDate = document.getElementById("param-date").value || "2026-06-01";
  document.getElementById("param-panel").style.display = "none";
  preloadIndexPrices();
};

// ---- 工具函数 ----

function datetimeToTs(dt) {
  const [d, t] = dt.split("-").reduce((a, v, i) => {
    if (i < 3) { a[0] = (a[0] || "") + (a[0] ? "-" : "") + v; }
    else { a[1] = (a[1] || "") + (a[1] ? ":" : "") + v; }
    return a;
  }, ["", ""]);
  return new Date(d + "T" + t + ":00+08:00").getTime();
}

function esc(s) { return (s || "").replace(/</g, "&lt;"); }
