import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, SlidersHorizontal } from "lucide-react";
import { api } from "../api";
import type { StockIndexPoint, StockPrice, StockSummary } from "../types";

type SortKey = "active_mentions" | "mention_count" | "last_mentioned";
type ChartMode = "index" | "stock";
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
  return {
    styles: {
      grid: {
        horizontal: { color: colors.border },
        vertical: { color: colors.border },
      },
      candle: {
        type: mode === "index" ? "area" : "candle_solid",
        bar: {
          upColor: "#ef4444",
          downColor: "#22c55e",
          noChangeColor: colors.muted,
          upBorderColor: "#ef4444",
          downBorderColor: "#22c55e",
          noChangeBorderColor: colors.muted,
          upWickColor: "#ef4444",
          downWickColor: "#22c55e",
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
        tooltip: {
          rect: {
            color: colors.surface,
            borderColor: colors.border,
          },
          text: {
            color: colors.text,
          },
        },
      },
      xAxis: {
        axisLine: { color: colors.border },
        tickText: { color: colors.muted },
        tickLine: { color: colors.border },
      },
      yAxis: {
        axisLine: { color: colors.border },
        tickText: { color: colors.muted },
        tickLine: { color: colors.border },
      },
      separator: { color: colors.border },
      crosshair: {
        horizontal: {
          line: { color: colors.muted },
          text: { backgroundColor: colors.text, borderColor: colors.text },
        },
        vertical: {
          line: { color: colors.muted },
          text: { backgroundColor: colors.text, borderColor: colors.text },
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
        <div className="stock-chart-header">
          <div>
            <h2>{selected ? selected.symbol : "清风指数"}</h2>
            <p>
              {selected
                ? `${selected.order_book_id} · ${selected.industry_name || "未标注行业"}`
                : `加权综合 · ${String(indexMeta.stocks || "?")} 成分股`}
            </p>
          </div>
          <span>{chartSeries.length} 点</span>
        </div>
        {chartLoading
          ? <div className="chart-placeholder">加载中...</div>
          : (
              <KLineChart
                points={chartSeries}
                mode={selected ? "stock" : "index"}
                symbol={selected?.order_book_id || "QF_INDEX"}
              />
            )}
      </div>
    </section>
  );
}

function KLineChart({ points, mode, symbol }: { points: KLinePoint[]; mode: ChartMode; symbol: string }) {
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
      chart.setPeriod?.({ span: 1, type: "min" });
      chart.setBarSpace?.(mode === "stock" ? 7 : 4);
      if (mode === "stock") {
        chart.createIndicator?.("MA", false, { id: "candle_pane" });
        chart.createIndicator?.("VOL", false, { height: 120 });
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
  }, [mode, points, symbol]);

  useEffect(() => {
    const resize = () => chartRef.current?.resize?.();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  if (!points.length) return <div className="chart-placeholder">暂无图表数据</div>;
  return (
    <div className="kline-chart-shell">
      <div className="kline-chart" ref={containerRef} />
      {error && <div className="chart-overlay-error">{error}</div>}
    </div>
  );
}
