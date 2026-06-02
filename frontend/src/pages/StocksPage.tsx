import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Camera,
  Circle,
  Eye,
  Fullscreen,
  Gauge,
  Globe2,
  Lock,
  Magnet,
  Menu,
  MoveDiagonal2,
  PencilRuler,
  Settings,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { api } from "../api";
import type { StockIndexPoint, StockPrice, StockSummary } from "../types";

type SortKey = "active_mentions" | "mention_count" | "last_mentioned";
type ChartMode = "index" | "stock";
type KLinePeriod = { label: string; span: number; type: string };
type KLinePoint = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover?: number;
};

const defaultBaseDate = new Date().toISOString().slice(0, 10);
const chartPeriods: KLinePeriod[] = [
  { label: "1m", span: 1, type: "min" },
  { label: "5m", span: 5, type: "min" },
  { label: "15m", span: 15, type: "min" },
  { label: "1H", span: 1, type: "hour" },
  { label: "2H", span: 2, type: "hour" },
  { label: "4H", span: 4, type: "hour" },
  { label: "D", span: 1, type: "day" },
  { label: "W", span: 1, type: "week" },
  { label: "M", span: 1, type: "month" },
  { label: "Y", span: 1, type: "year" },
];
const drawingTools = [
  { title: "十字光标", icon: MoveDiagonal2 },
  { title: "趋势线", icon: PencilRuler },
  { title: "圆形标注", icon: Circle },
  { title: "水平线", icon: SlidersHorizontal },
  { title: "磁吸", icon: Magnet },
  { title: "锁定", icon: Lock },
  { title: "显示", icon: Eye },
];
let klineScriptPromise: Promise<void> | null = null;

function formatNumber(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : "--";
}

function datetimeToTs(datetime: string) {
  const parts = datetime.split("-");
  const date = parts.slice(0, 3).join("-");
  const time = parts.slice(3).join(":") || "00:00";
  return new Date(`${date}T${time}:00+08:00`).getTime();
}

function getKLineScriptCandidates() {
  return [new URL("./js/klinecharts.umd.js", window.location.href).toString()];
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-klinecharts-src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`KLineChart 加载失败：${src}`)), { once: true });
      if (window.klinecharts) resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.klinechartsSrc = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`KLineChart 加载失败：${src}`));
    document.head.appendChild(script);
  });
}

function ensureKLineCharts() {
  if (window.klinecharts) return Promise.resolve();
  if (!klineScriptPromise) {
    const candidates = getKLineScriptCandidates();
    klineScriptPromise = candidates.reduce<Promise<void>>(
      (chain, src) => chain.catch(() => loadScript(src)),
      Promise.reject(new Error("KLineChart 未加载")),
    ).then(() => {
      if (!window.klinecharts) throw new Error("KLineChart 未初始化");
    });
  }
  return klineScriptPromise;
}

function readChartColors() {
  const styles = getComputedStyle(document.documentElement);
  return {
    accent: styles.getPropertyValue("--accent").trim() || "#10a37f",
    border: styles.getPropertyValue("--border").trim() || "#e5e5e5",
    surface: styles.getPropertyValue("--card-bg").trim() || "#ffffff",
    text: styles.getPropertyValue("--text").trim() || "#0d0d0d",
    muted: styles.getPropertyValue("--muted").trim() || "#6b6b6b",
  };
}

function getChartOptions(mode: ChartMode) {
  const colors = readChartColors();
  const green = "#2dc08e";
  const red = "#f92855";
  const grid = "#e7eaf0";
  const axis = "#d8dde6";
  const text = "#7b8797";
  return {
    styles: {
      grid: {
        show: true,
        horizontal: { show: true, size: 1, color: grid, style: "dashed", dashedValue: [2, 2] },
        vertical: { show: true, size: 1, color: grid, style: "dashed", dashedValue: [2, 2] },
      },
      candle: {
        type: mode === "index" ? "area" : "candle_solid",
        bar: {
          compareRule: "current_open",
          upColor: green,
          downColor: red,
          noChangeColor: colors.muted,
          upBorderColor: green,
          downBorderColor: red,
          noChangeBorderColor: colors.muted,
          upWickColor: green,
          downWickColor: red,
          noChangeWickColor: colors.muted,
        },
        area: {
          lineSize: 2,
          lineColor: colors.accent,
          value: "close",
          backgroundColor: [
            { offset: 0, color: "rgba(16, 163, 127, 0.22)" },
            { offset: 1, color: "rgba(16, 163, 127, 0.02)" },
          ],
        },
        priceMark: {
          show: true,
          high: { show: true, color: text, textSize: 11, textFamily: "Helvetica Neue", textWeight: "normal", textOffset: 5 },
          low: { show: true, color: text, textSize: 11, textFamily: "Helvetica Neue", textWeight: "normal", textOffset: 5 },
          last: {
            show: true,
            compareRule: "current_open",
            upColor: green,
            downColor: red,
            noChangeColor: green,
            line: { show: true, style: "dashed", dashedValue: [5, 5], size: 1 },
            text: {
              show: true,
              style: "fill",
              color: "#ffffff",
              size: 12,
              family: "Helvetica Neue",
              weight: "normal",
              borderStyle: "solid",
              borderDashedValue: [2, 2],
              borderSize: 0,
              borderColor: "transparent",
              borderRadius: 2,
              paddingLeft: 5,
              paddingTop: 4,
              paddingRight: 5,
              paddingBottom: 4,
            },
          },
        },
        tooltip: {
          showRule: "always",
          showType: "standard",
          rect: {
            color: "#ffffff",
            borderColor: "transparent",
          },
          title: {
            show: false,
            color: text,
          },
          legend: {
            color: text,
            size: 12,
            marginLeft: 8,
            marginTop: 4,
            marginRight: 8,
            marginBottom: 4,
            template: [
              { title: "时间", value: "{time}" },
              { title: "开", value: "{open}" },
              { title: "高", value: "{high}" },
              { title: "低", value: "{low}" },
              { title: "收", value: "{close}" },
              { title: "成交量", value: "{volume}" },
            ],
          },
          features: [],
        },
      },
      indicator: {
        ohlc: { compareRule: "current_open", upColor: "rgba(45, 192, 142, 0.68)", downColor: "rgba(249, 40, 85, 0.68)", noChangeColor: colors.muted },
        bars: [{
          style: "fill",
          borderStyle: "solid",
          borderSize: 1,
          borderDashedValue: [2, 2],
          upColor: "rgba(45, 192, 142, 0.68)",
          downColor: "rgba(249, 40, 85, 0.68)",
          noChangeColor: colors.muted,
        }],
        lines: ["#ff8f1f", "#9b5cc7", "#1677ff", "#ec297b", "#63d8ad"].map(color => ({
          style: "solid",
          smooth: false,
          size: 1,
          dashedValue: [2, 2],
          color,
        })),
        lastValueMark: { show: false },
        tooltip: {
          showRule: "always",
          showType: "standard",
          title: { show: true, showName: true, showParams: true, color: text, size: 12, marginLeft: 8, marginTop: 4, marginRight: 8, marginBottom: 4 },
          legend: { color: text, size: 12, marginLeft: 8, marginTop: 4, marginRight: 8, marginBottom: 4 },
          features: [],
        },
      },
      xAxis: {
        show: true,
        axisLine: { show: true, color: axis, size: 1 },
        tickText: { show: true, color: text, size: 12, marginStart: 4, marginEnd: 6 },
        tickLine: { show: false, color: axis },
      },
      yAxis: {
        show: true,
        position: "right",
        inside: false,
        axisLine: { show: true, color: axis, size: 1 },
        tickText: { show: true, color: text, size: 12, marginStart: 6, marginEnd: 8 },
        tickLine: { show: false, color: axis },
      },
      separator: { size: 1, color: axis, fill: true, activeBackgroundColor: "rgba(22, 119, 255, 0.06)" },
      crosshair: {
        show: true,
        horizontal: {
          show: true,
          line: { show: true, style: "dashed", dashedValue: [4, 2], size: 1, color: "#8792a2" },
          text: { color: "#ffffff", backgroundColor: "#7b8797", borderColor: "#7b8797" },
        },
        vertical: {
          show: true,
          line: { show: true, style: "dashed", dashedValue: [4, 2], size: 1, color: "#8792a2" },
          text: { color: "#ffffff", backgroundColor: "#7b8797", borderColor: "#7b8797" },
        },
      },
    },
  };
}

function toIndexKLine(series: StockIndexPoint[]): KLinePoint[] {
  return series.map(point => ({
    timestamp: datetimeToTs(point.datetime),
    open: point.value,
    high: point.value,
    low: point.value,
    close: point.value,
    volume: 0,
  })).filter(point => Number.isFinite(point.timestamp) && Number.isFinite(point.close));
}

function toStockKLine(series: StockPrice[]): KLinePoint[] {
  return series.map(point => ({
    timestamp: datetimeToTs(point.datetime),
    open: Number(point.open),
    high: Number(point.high),
    low: Number(point.low),
    close: Number(point.close),
    volume: Number(point.volume || 0),
    turnover: Number(point.amount || 0),
  })).filter(point => Number.isFinite(point.timestamp) && Number.isFinite(point.close));
}

export default function StocksPage() {
  const [stocks, setStocks] = useState<StockSummary[]>([]);
  const [selected, setSelected] = useState<StockSummary | null>(null);
  const [prices, setPrices] = useState<StockPrice[]>([]);
  const [indexSeries, setIndexSeries] = useState<StockIndexPoint[]>([]);
  const [indexMeta, setIndexMeta] = useState<Record<string, number | string>>({});
  const [sortBy, setSortBy] = useState<SortKey>("active_mentions");
  const [sortDir, setSortDir] = useState(-1);
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(false);
  const [error, setError] = useState("");
  const [power, setPower] = useState(1);
  const [decay, setDecay] = useState(10);
  const [baseDate, setBaseDate] = useState(defaultBaseDate);
  const [period, setPeriod] = useState<KLinePeriod>(chartPeriods[2]);

  const sortedStocks = useMemo(() => {
    return [...stocks].sort((a, b) => {
      if (sortBy === "last_mentioned") return ((a.last_mentioned || "").localeCompare(b.last_mentioned || "")) * sortDir;
      return (((a[sortBy] || 0) as number) - ((b[sortBy] || 0) as number)) * sortDir;
    });
  }, [sortBy, sortDir, stocks]);

  const chartSeries = useMemo(() => selected ? toStockKLine(prices) : toIndexKLine(indexSeries), [indexSeries, prices, selected]);

  const latestIndex = indexSeries[indexSeries.length - 1];
  const previousIndex = indexSeries[indexSeries.length - 2];
  const indexChange = latestIndex && previousIndex ? latestIndex.value - previousIndex.value : 0;

  const loadStocks = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.get<{ stocks: StockSummary[] }>("/api/stocks/active");
      setStocks(data?.stocks || []);
    } catch (e) {
      setError(`加载失败：${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadIndex = useCallback(async () => {
    setChartLoading(true);
    try {
      const data = await api.get<{ index: StockIndexPoint[]; meta: Record<string, number | string> }>("/api/stocks/index", {
        power,
        decay,
        base_date: baseDate,
      });
      setIndexSeries(data?.index || []);
      setIndexMeta(data?.meta || {});
      setSelected(null);
      setPrices([]);
    } finally {
      setChartLoading(false);
    }
  }, [baseDate, decay, power]);

  const selectStock = useCallback(async (stock: StockSummary) => {
    setSelected(stock);
    setChartLoading(true);
    try {
      const data = await api.get<{ prices: StockPrice[] }>(`/api/stocks/prices/${encodeURIComponent(stock.order_book_id)}`, { limit: 200 });
      setPrices(data?.prices || []);
    } finally {
      setChartLoading(false);
    }
  }, []);

  const changeSort = useCallback((key: SortKey) => {
    setSortBy(prev => {
      if (prev === key) setSortDir(dir => -dir);
      else setSortDir(-1);
      return key;
    });
  }, []);

  useEffect(() => {
    loadStocks();
  }, [loadStocks]);

  useEffect(() => {
    loadIndex();
  }, [loadIndex]);

  return (
    <section className="stocks-page">
      <aside className="stocks-panel">
        <div className="stocks-panel-head">
          <div>
            <h1>股票</h1>
            <p>清风文章库中的活跃标的</p>
          </div>
          <button className="mini-icon-btn" type="button" title="刷新" onClick={loadStocks}>
            <BarChart3 size={17} />
          </button>
        </div>

        <button className={`index-summary${!selected ? " active" : ""}`} type="button" onClick={loadIndex}>
          <span>清风指数</span>
          <strong>{latestIndex ? formatNumber(latestIndex.value) : "--"}</strong>
          <small className={indexChange >= 0 ? "up" : "down"}>
            {indexChange >= 0 ? "+" : ""}{formatNumber(indexChange)}
          </small>
        </button>

        <div className="index-params">
          <div className="index-params-title"><SlidersHorizontal size={15} /> 指数参数</div>
          <label>提及幂<input type="number" value={power} min="0" step="0.1" onChange={e => setPower(Number(e.target.value) || 1)} /></label>
          <label>衰减天数<input type="number" value={decay} min="1" step="1" onChange={e => setDecay(Number(e.target.value) || 10)} /></label>
          <label>基准日<input type="date" value={baseDate} onChange={e => setBaseDate(e.target.value || defaultBaseDate)} /></label>
        </div>

        <div className="sort-bar stock-sort-bar">
          {(["active_mentions", "mention_count", "last_mentioned"] as SortKey[]).map(key => (
            <button className={`sort-btn${sortBy === key ? " active" : ""}`} type="button" key={key} onClick={() => changeSort(key)}>
              {key === "active_mentions" ? "活跃" : key === "mention_count" ? "总提及" : "最新"}
              {sortBy === key ? (sortDir > 0 ? " ↑" : " ↓") : ""}
            </button>
          ))}
        </div>

        <div className="stock-list">
          {loading && <div className="loading compact">加载中...</div>}
          {!loading && error && <div className="error compact">{error}</div>}
          {!loading && !error && sortedStocks.map(stock => (
            <button
              className={`stock-row${selected?.order_book_id === stock.order_book_id ? " selected" : ""}`}
              type="button"
              key={stock.order_book_id}
              onClick={() => selectStock(stock)}
            >
              <span className="stock-symbol">{stock.symbol}</span>
              <span className="stock-code">{stock.order_book_id}</span>
              <span className="stock-meta">活跃 {stock.active_mentions} / 总 {stock.mention_count}</span>
            </button>
          ))}
        </div>
      </aside>

      <div className="stock-chart-panel">
        <div className="stock-terminal">
          <div className="stock-terminal-topbar">
            <button className="chart-tool-btn menu-btn" type="button" title="菜单">
              <Menu size={22} />
            </button>
            <div className="chart-symbol">
              <span className="chart-symbol-badge">{(selected?.symbol || "Q").slice(0, 1).toUpperCase()}</span>
              <div>
                <strong>{selected ? selected.symbol : "清风指数"}</strong>
                <small>
                  {selected
                    ? `${selected.order_book_id} · ${selected.industry_name || "未标注行业"}`
                    : `加权综合 · ${String(indexMeta.stocks || "?")} 成分股`}
                </small>
              </div>
            </div>
            <div className="chart-periods" role="tablist" aria-label="K线周期">
              {chartPeriods.map(item => (
                <button
                  className={`chart-period${period.label === item.label ? " active" : ""}`}
                  type="button"
                  key={item.label}
                  onClick={() => setPeriod(item)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="chart-actions">
              <button className="chart-action-btn" type="button" title="指标"><Gauge size={18} /><span>指标</span></button>
              <button className="chart-action-btn" type="button" title="时区"><Globe2 size={18} /><span>时区</span></button>
              <button className="chart-action-btn" type="button" title="设置"><Settings size={18} /><span>设置</span></button>
              <button className="chart-action-btn" type="button" title="截屏"><Camera size={18} /><span>截屏</span></button>
              <button className="chart-action-btn" type="button" title="全屏"><Fullscreen size={18} /><span>全屏</span></button>
            </div>
            <span className="chart-point-count">{chartSeries.length} 点</span>
          </div>
          <div className="stock-chart-workspace">
            <div className="chart-left-toolbar" aria-label="绘图工具">
              {drawingTools.map(({ title, icon: Icon }) => (
                <button className="chart-left-tool" type="button" title={title} key={title}>
                  <Icon size={22} />
                </button>
              ))}
              <button className="chart-left-tool chart-left-danger" type="button" title="清空">
                <Trash2 size={22} />
              </button>
            </div>
            <div className="chart-canvas-area">
              <span className="chart-currency">USD</span>
              {chartLoading
                ? <div className="chart-placeholder">加载中...</div>
                : (
                    <KLineChart
                      points={chartSeries}
                      mode={selected ? "stock" : "index"}
                      symbol={selected?.order_book_id || "QF_INDEX"}
                      period={period}
                    />
                  )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function KLineChart({ points, mode, symbol, period }: { points: KLinePoint[]; mode: ChartMode; symbol: string; period: KLinePeriod }) {
  const chartRef = useRef<KLineChartInstance | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !points.length) return;
    let disposed = false;
    setError("");
    ensureKLineCharts().then(() => {
      if (disposed || !window.klinecharts) return;
      window.klinecharts.dispose(container);
      container.innerHTML = "";
      const chart = window.klinecharts.init(container, getChartOptions(mode));
      chartRef.current = chart;
      if (!chart) {
        setError("K线图初始化失败");
        return;
      }
      chart.setSymbol?.({ ticker: symbol, pricePrecision: 2, volumePrecision: 0 });
      chart.setPeriod?.({ span: period.span, type: period.type });
      chart.setBarSpace?.(mode === "stock" ? 7 : 4);
      if (mode === "stock") {
        chart.createIndicator?.("MA", false, { id: "candle_pane" });
        chart.createIndicator?.("VOL", false, { height: 116 });
        chart.createIndicator?.("MACD", false, { height: 78 });
      }
      chart.applyNewData(points);
      chart.scrollToRealTime?.(0);
    }).catch(reason => {
      setError(reason instanceof Error ? reason.message : "KLineChart 加载失败");
    });

    return () => {
      disposed = true;
      if (window.klinecharts && container) window.klinecharts.dispose(container);
      chartRef.current = null;
    };
  }, [mode, period, points, symbol]);

  useEffect(() => {
    const resize = () => chartRef.current?.resize?.();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  if (!points.length) return <div className="chart-placeholder">暂无图表数据</div>;
  return (
    <div className="kline-chart-shell">
      <div className="kline-chart" ref={containerRef} />
      <div className="kline-watermark" aria-hidden="true">
        <BarChart3 size={68} />
      </div>
      {error && <div className="chart-overlay-error">{error}</div>}
    </div>
  );
}
