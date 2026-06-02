import { api } from "../api.js";

let stocks = [];
let sortBy = "active_mentions";
let sortDir = -1;
let selectedCode = null;
let selectedStock = null;
let chart = null;

// 清风指数参数
const idxParams = {
  power: 1.0,
  decay: 10,
  baseDate: new Date().toISOString().slice(0, 10),
};
let idxSeries = null;
let idxMeta = null;

export async function init(container) {
  const data = await api.get("/api/stocks/active");
  stocks = (data && data.stocks) || [];
  sort();
  render(container);
  loadIndex();
}

function render(container) {
  container.innerHTML = `
    <div class="stocks-layout">
      <div class="stock-list-panel">
        <h2>清风指数</h2>
        <div class="index-card" id="index-card" onclick="window._showIndex()">
          <div class="index-value" id="index-value">--</div>
          <div class="index-change" id="index-change"></div>
          <div class="index-meta" id="index-meta"></div>
          <button class="param-btn" onclick="event.stopPropagation();window._toggleParams()">参数</button>
          <div class="param-panel" id="param-panel" style="display:none">
            <label>提及幂 <input id="param-power" type="number" value="${idxParams.power}" step="0.1" min="0"></label>
            <label>衰减天数 <input id="param-decay" type="number" value="${idxParams.decay}" step="1" min="1"></label>
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
        <div class="chart-placeholder">选择股票查看K线</div>
      </div>
    </div>
  `;
  renderList();
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
  stocks.sort((a, b) => (sortBy === "last_mentioned"
    ? (a[sortBy] || "").localeCompare(b[sortBy] || "")
    : ((a[sortBy] || 0) - (b[sortBy] || 0))) * sortDir);
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

// ---- 清风指数 ----

async function loadIndex() {
  const qs = `power=${idxParams.power}&decay=${idxParams.decay}&base_date=${idxParams.baseDate}`;
  try {
    const data = await api.get(`/api/stocks/index?${qs}`);
    idxSeries = (data && data.index) || [];
    idxMeta = (data && data.meta) || {};
    updateIndexDisplay();
  } catch (e) { /* skip */ }
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
  const last = idxSeries[idxSeries.length - 1];
  const prev = idxSeries[idxSeries.length - 2];
  const change = last.value - prev.value;
  const pct = prev.value > 0 ? (change / prev.value) * 100 : 0;

  el.textContent = last.value.toFixed(2);
  chg.innerHTML = `<span style="color:${change >= 0 ? '#ef4444' : '#22c55e'}">${change >= 0 ? '+' : ''}${change.toFixed(2)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)</span>`;
  meta.textContent = `${idxMeta.stocks || idxSeries.length}成分股 | ${idxSeries.length}点`;

  // 默认显示指数K线
  window._showIndex();
}

window._showIndex = function () {
  selectedCode = null; selectedStock = null;
  document.querySelectorAll(".stock-row").forEach(r => r.classList.remove("selected"));
  document.getElementById("index-card").classList.add("selected");
  showIndexChart();
};

function showIndexChart() {
  const panel = document.getElementById("chart-panel");
  if (!idxSeries || !idxSeries.length) {
    panel.innerHTML = `<div class="chart-placeholder">指数计算中...</div>`;
    return;
  }
  panel.innerHTML = `
    <div class="chart-header">
      <h3>清风指数</h3>
      <span>加权综合 | ${idxMeta.stocks || "?"}成分股 | ${idxSeries.length}点</span>
    </div>
    <div id="kline-container" style="width:100%;height:calc(100vh - 160px)"></div>
  `;
  const klineData = idxSeries.map(d => ({
    timestamp: datetimeToTs(d.datetime),
    open: d.value, high: d.value, low: d.value, close: d.value, volume: 0,
  }));
  chart = renderKLineChart(klineData, { mode: "index", symbol: "QF_INDEX" });
}

// ---- 个股K线 ----

window._selectStock = async function (code) {
  selectedCode = code;
  selectedStock = stocks.find(s => s.order_book_id === code);
  document.querySelectorAll(".stock-row").forEach(r => r.classList.toggle("selected", r.dataset.code === code));
  document.getElementById("index-card")?.classList.remove("selected");
  if (!selectedStock) return;

  const panel = document.getElementById("chart-panel");
  panel.innerHTML = `<div class="chart-loading">加载中...</div>`;

  const resp = await api.get(`/api/stocks/prices/${code}?limit=200`);
  const prices = (resp && resp.prices) || [];
  if (!prices.length) {
    panel.innerHTML = `<div class="chart-placeholder">暂无K线数据</div>`;
    return;
  }
  const s = selectedStock;
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
  chart = renderKLineChart(klineData, { mode: "stock", symbol: code });
};

// ---- 参数 ----

window._toggleParams = function () {
  const p = document.getElementById("param-panel");
  p.style.display = p.style.display === "none" ? "block" : "none";
};

window._applyParams = function () {
  idxParams.power = parseFloat(document.getElementById("param-power").value) || 1;
  idxParams.decay = parseInt(document.getElementById("param-decay").value) || 10;
  idxParams.baseDate = document.getElementById("param-date").value || idxParams.baseDate;
  document.getElementById("param-panel").style.display = "none";
  loadIndex();
};

// ---- 工具 ----

function datetimeToTs(dt) {
  const [d, t] = dt.split("-").reduce((a, v, i) => {
    if (i < 3) a[0] = (a[0] || "") + (a[0] ? "-" : "") + v;
    else a[1] = (a[1] || "") + (a[1] ? ":" : "") + v;
    return a;
  }, ["", ""]);
  return new Date(d + "T" + t + ":00+08:00").getTime();
}

function renderKLineChart(data, options) {
  const el = document.getElementById("kline-container");
  if (!el) return null;
  klinecharts.dispose?.("kline-container");
  el.innerHTML = "";
  const instance = klinecharts.init("kline-container", { styles: chartStyles(options.mode) });
  if (!instance) return null;
  instance.setSymbol?.({ ticker: options.symbol, pricePrecision: 2, volumePrecision: 0 });
  instance.setPeriod?.({ span: 1, type: "min" });
  instance.setBarSpace?.(options.mode === "stock" ? 7 : 4);
  if (options.mode === "stock") {
    instance.createIndicator?.("MA", false, { id: "candle_pane" });
    instance.createIndicator?.("VOL", false, { height: 120 });
  }
  instance.applyNewData(data);
  instance.scrollToRealTime?.(0);
  return instance;
}

function chartStyles(mode) {
  const root = getComputedStyle(document.documentElement);
  const accent = root.getPropertyValue("--accent").trim() || "#10a37f";
  const border = root.getPropertyValue("--border").trim() || "#e8e4df";
  const card = root.getPropertyValue("--card-bg").trim() || "#fff";
  const text = root.getPropertyValue("--text").trim() || "#2c2c2c";
  const muted = root.getPropertyValue("--muted").trim() || "#999";
  return {
    grid: {
      horizontal: { color: border },
      vertical: { color: border },
    },
    candle: {
      type: mode === "index" ? "area" : "candle_solid",
      bar: {
        upColor: "#ef4444",
        downColor: "#22c55e",
        noChangeColor: muted,
        upBorderColor: "#ef4444",
        downBorderColor: "#22c55e",
        noChangeBorderColor: muted,
        upWickColor: "#ef4444",
        downWickColor: "#22c55e",
        noChangeWickColor: muted,
      },
      area: {
        lineSize: 2,
        lineColor: accent,
        value: "close",
        backgroundColor: [
          { offset: 0, color: "rgba(16, 163, 127, 0.22)" },
          { offset: 1, color: "rgba(16, 163, 127, 0.02)" },
        ],
      },
      tooltip: {
        rect: { color: card, borderColor: border },
        text: { color: text },
      },
    },
    xAxis: {
      axisLine: { color: border },
      tickText: { color: muted },
      tickLine: { color: border },
    },
    yAxis: {
      axisLine: { color: border },
      tickText: { color: muted },
      tickLine: { color: border },
    },
    separator: { color: border },
    crosshair: {
      horizontal: {
        line: { color: muted },
        text: { backgroundColor: text, borderColor: text },
      },
      vertical: {
        line: { color: muted },
        text: { backgroundColor: text, borderColor: text },
      },
    },
  };
}

function esc(s) { return (s || "").replace(/</g, "&lt;"); }
