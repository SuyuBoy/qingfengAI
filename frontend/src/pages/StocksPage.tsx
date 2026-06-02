import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, PanelRightClose, PanelRightOpen } from "lucide-react";
import { KLineChartPro } from "@klinecharts/pro";
import type { Datafeed, DatafeedSubscribeCallback, Period, SymbolInfo } from "@klinecharts/pro";
import type { KLineData } from "klinecharts";
import { api } from "../api";
import type { StockIndexPoint, StockPrice, StockSummary } from "../types";

type SortKey = "active_mentions" | "mention_count" | "last_mentioned";
type KLinePoint = KLineData & { turnover?: number };
type KLineChartProHandle = { _chartApi?: { resize?: () => void } };
type IndexPeriod = "1d" | "1w";

const INDEX_PERIODS: { key: IndexPeriod; label: string }[] = [
  { key: "1d", label: "日级" },
  { key: "1w", label: "周级" },
];

const defaultPeriod: Period = { multiplier: 1, timespan: "day", text: "D" };

function buildPeriods(dataDays: number): Period[] {
  const periods: Period[] = [];
  if (dataDays <= 3) {
    periods.push({ multiplier: 1, timespan: "minute", text: "1m" });
    periods.push({ multiplier: 5, timespan: "minute", text: "5m" });
  }
  if (dataDays <= 30) {
    periods.push({ multiplier: 15, timespan: "minute", text: "15m" });
    periods.push({ multiplier: 1, timespan: "hour", text: "1H" });
  }
  periods.push({ multiplier: 1, timespan: "day", text: "D" });
  if (dataDays > 30) {
    periods.push({ multiplier: 1, timespan: "week", text: "W" });
  }
  return periods;
}

const proWatermark = `
<svg class="logo" viewBox="0 0 160 160">
  <path d="M95.1576,6.27848L153.722,64.8424Q156.803,67.9238,158.43,71.9362Q160,75.8078,160,80Q160,84.1922,158.43,88.0638Q156.803,92.0762,153.722,95.1576L95.1576,153.722Q92.0762,156.803,88.0638,158.43Q84.1922,160,80,160Q75.8078,160,71.9362,158.43Q67.9238,156.803,64.8424,153.722L6.27848,95.1576Q3.19708,92.0762,1.56999,88.0638Q0,84.1922,0,80Q0,75.8078,1.56999,71.9362Q3.19707,67.9238,6.27848,64.8424L64.8424,6.27848Q67.9238,3.19707,71.9362,1.56999Q75.8078,0,80,0Q84.1922,0,88.0638,1.56999Q92.0762,3.19707,95.1576,6.27848ZM87.9397,13.4964Q86.322,11.8787,84.2279,11.0295Q82.2013,10.2077,80,10.2077Q77.7987,10.2077,75.7721,11.0295Q73.678,11.8787,72.0603,13.4964L54.5534,31.0033L105.447,31.0033L87.9397,13.4964ZM107.561,118.789Q109.848,118.789,111.93,117.909Q113.944,117.057,115.5,115.5Q117.057,113.944,117.909,111.93Q118.789,109.848,118.789,107.561L118.789,52.4393Q118.789,50.1516,117.909,48.0703Q117.057,46.0562,115.5,44.4996Q113.944,42.9431,111.93,42.0912Q109.848,41.2109,107.561,41.2109L52.4393,41.2109Q50.1515,41.2109,48.0703,42.0912Q46.0562,42.9431,44.4996,44.4996Q42.9431,46.0562,42.0912,48.0703Q41.2109,50.1515,41.2109,52.4393L41.2109,107.561Q41.2109,109.848,42.0912,111.93Q42.9431,113.944,44.4996,115.5Q46.0562,117.057,48.0703,117.909Q50.1516,118.789,52.4393,118.789L107.561,118.789ZM13.4964,72.0603L31.0033,54.5534L31.0033,105.447L13.4964,87.9397Q11.8787,86.322,11.0295,84.2278Q10.2077,82.2013,10.2077,80Q10.2077,77.7987,11.0295,75.7721Q11.8787,73.678,13.4964,72.0603ZM146.504,87.9397L128.997,105.447L128.997,54.5534L146.504,72.0603Q148.121,73.678,148.971,75.7721Q149.792,77.7987,149.792,80Q149.792,82.2013,148.971,84.2279Q148.121,86.322,146.504,87.9397ZM72.0603,146.504L54.5534,128.997L105.447,128.997L87.9397,146.504Q86.322,148.121,84.2278,148.971Q82.2012,149.792,80,149.792Q77.7987,149.792,75.7721,148.971Q73.678,148.121,72.0603,146.504Z" fill-rule="evenodd" />
  <path d="M64.1621,62.6883C63.3482,62.6883,62.6884,63.2727,62.6884,63.9936L62.6884,71.8252L55.32,71.8252C53.6922,71.8252,52.3726,72.9939,52.3726,74.4357L52.3726,96.6251C52.3726,98.0669,53.6922,99.2357,55.32,99.2357L62.6884,99.2357L62.6884,107.067C62.6884,107.788,63.3482,108.373,64.1621,108.373C64.976,108.373,65.6358,107.788,65.6358,107.067L65.6358,99.2357L73.0042,99.2357C74.632,99.2357,75.9515,98.0669,75.9515,96.6251L75.9515,74.4357C75.9515,72.9939,74.632,71.8252,73.0042,71.8252L65.6358,71.8252L65.6358,63.9936C65.6358,63.2727,64.976,62.6883,64.1621,62.6883Z" fill-rule="evenodd" />
  <path d="M96.5831,52.3726C95.7692,52.3726,95.1094,52.9569,95.1094,53.6778L95.1094,61.5094L87.741,61.5094C86.1132,61.5094,84.7936,62.6782,84.7936,64.12L84.7936,86.3094C84.7936,87.7512,86.1132,88.92,87.741,88.92L95.1094,88.92L95.1094,96.7515C95.1094,97.4724,95.7692,98.0568,96.5831,98.0568C97.397,98.0568,98.0568,97.4724,98.0568,96.7515L98.0568,88.92L105.425,88.92C107.053,88.92,108.373,87.7512,108.373,86.3094L108.373,64.12C108.373,62.6782,107.053,61.5094,105.425,61.5094L98.0568,61.5094L98.0568,53.6778C98.0568,52.9569,97.397,52.3726,96.5831,52.3726Z" fill-rule="evenodd" />
</svg>`;

function formatNumber(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : "--";
}

function datetimeToTs(datetime: string) {
  const parts = datetime.split("-");
  const date = parts.slice(0, 3).join("-");
  const time = parts.slice(3).join(":") || "00:00";
  return new Date(`${date}T${time}:00+08:00`).getTime();
}

function toIndexKLine(series: StockIndexPoint[]): KLinePoint[] {
  return series.map((point, i) => {
    const prevClose = i > 0 ? series[i - 1].value : point.value;
    const o = point.open ?? prevClose;
    const c = point.close ?? point.value;
    const h = point.high ?? Math.max(o, c);
    const l = point.low ?? Math.min(o, c);
    return {
      timestamp: datetimeToTs(point.datetime),
      open: o, high: h, low: l, close: c,
      volume: 0,
    };
  }).filter(point => Number.isFinite(point.timestamp) && Number.isFinite(point.close));
}

function toStockKLine(series: StockPrice[]): KLinePoint[] {
  return series.map(point => ({
    timestamp: datetimeToTs(point.datetime),
    open: Number(point.open), high: Number(point.high), low: Number(point.low),
    close: Number(point.close), volume: Number(point.volume || 0),
    turnover: Number(point.amount || 0),
  })).filter(point => Number.isFinite(point.timestamp) && Number.isFinite(point.close));
}

function getSymbolInfo(selected: StockSummary | null, periodLabel: string): SymbolInfo {
  if (selected) {
    return {
      ticker: selected.order_book_id, shortName: selected.symbol,
      name: selected.industry_name || selected.symbol,
      market: "stocks", pricePrecision: 2, volumePrecision: 0,
    };
  }
  return {
    ticker: `QF_INDEX`, shortName: "QF",
    name: `清风指数 · ${periodLabel}`,
    market: "stocks", pricePrecision: 2, volumePrecision: 0,
  };
}

class StaticDatafeed implements Datafeed {
  constructor(private readonly symbol: SymbolInfo, private readonly points: KLinePoint[]) {}
  searchSymbols(search?: string) {
    const text = (search || "").trim().toLowerCase();
    const haystack = `${this.symbol.ticker} ${this.symbol.shortName || ""}`.toLowerCase();
    return Promise.resolve(!text || haystack.includes(text) ? [this.symbol] : []);
  }
  getHistoryKLineData(_symbol: SymbolInfo, _period: Period, from: number, to: number) {
    const rangeMatched = Number.isFinite(from) && Number.isFinite(to) && to > from
      ? this.points.filter(p => p.timestamp >= from && p.timestamp <= to) : [];
    return Promise.resolve(rangeMatched.length ? rangeMatched : this.points);
  }
  subscribe(_symbol: SymbolInfo, _period: Period, _callback: DatafeedSubscribeCallback) {}
  unsubscribe(_symbol: SymbolInfo, _period: Period) {}
}

export default function StocksPage() {
  const [stocks, setStocks] = useState<StockSummary[]>([]);
  const [selected, setSelected] = useState<StockSummary | null>(null);
  const [indexPeriod, setIndexPeriod] = useState<IndexPeriod>("1d");
  const [indexSeries, setIndexSeries] = useState<Record<IndexPeriod, StockIndexPoint[]>>({ "1d": [], "1w": [] });
  const [indexMeta, setIndexMeta] = useState<Record<string, number | string>>({});
  const [sortBy, setSortBy] = useState<SortKey>("active_mentions");
  const [sortDir, setSortDir] = useState(-1);
  const [loading, setLoading] = useState(true);
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  const selectedSeries = indexSeries[indexPeriod] || [];
  const latestVal = selectedSeries.length ? selectedSeries[selectedSeries.length - 1]?.value : null;
  const prevVal = selectedSeries.length > 1 ? selectedSeries[selectedSeries.length - 2]?.value : null;
  const indexChange = latestVal != null && prevVal != null ? latestVal - prevVal : 0;
  const dataDays = selectedSeries.length
    ? Math.ceil((datetimeToTs(selectedSeries[selectedSeries.length - 1].datetime) - datetimeToTs(selectedSeries[0].datetime)) / 86400000)
    : 0;
  const periods = useMemo(() => buildPeriods(dataDays), [dataDays]);
  const indexChartSeries = useMemo(() => toIndexKLine(selectedSeries), [selectedSeries]);
  const symbolInfo = useMemo(() => getSymbolInfo(selected,
    INDEX_PERIODS.find(p => p.key === indexPeriod)?.label || ""), [selected, indexPeriod]);

  const sortedStocks = useMemo(() => {
    return [...stocks].sort((a, b) => {
      if (sortBy === "last_mentioned") return ((a.last_mentioned || "").localeCompare(b.last_mentioned || "")) * sortDir;
      return (((a[sortBy] || 0) as number) - ((b[sortBy] || 0) as number)) * sortDir;
    });
  }, [sortBy, sortDir, stocks]);

  const loadStocks = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ stocks: StockSummary[] }>("/api/stocks/active");
      setStocks(data?.stocks || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const loadIndex = useCallback(async (period: IndexPeriod) => {
    try {
      const data = await api.get<{ index: StockIndexPoint[]; meta: Record<string, number | string> }>(
        `/api/stocks/index?period=${period}`);
      setIndexSeries(prev => ({ ...prev, [period]: data?.index || [] }));
      if (period === indexPeriod) setIndexMeta(data?.meta || {});
    } catch { /* ignore */ }
  }, [indexPeriod]);

  const selectStock = useCallback((stock: StockSummary) => {
    setSelected(stock);
  }, []);

  const selectIndex = useCallback((period: IndexPeriod) => {
    setIndexPeriod(period);
    setSelected(null);
  }, []);

  const changeSort = useCallback((key: SortKey) => {
    setSortBy(prev => { if (prev === key) setSortDir(d => -d); else setSortDir(-1); return key; });
  }, []);

  useEffect(() => { loadStocks(); }, [loadStocks]);
  useEffect(() => { loadIndex("1d"); loadIndex("1w"); }, []);

  return (
    <section className={`stocks-page${panelCollapsed ? " stocks-collapsed" : ""}`}>
      <div className="stock-chart-panel">
        {selected
          ? <KLineProChart key={`stock:${selected.order_book_id}`} symbol={symbolInfo} isIndex={false}
              layoutKey={panelCollapsed ? "collapsed" : "expanded"} orderBookId={selected.order_book_id} periods={periods} />
          : <KLineProChart key={`index:${indexPeriod}`} symbol={symbolInfo} isIndex={true}
              indexPoints={indexChartSeries} layoutKey={panelCollapsed ? "collapsed" : "expanded"} periods={periods} />
        }
      </div>

      <aside className="stocks-panel">
        <button className="stocks-collapse-rail" type="button"
          title={panelCollapsed ? "展开股票列表" : "折叠股票列表"}
          onClick={() => setPanelCollapsed(c => !c)}>
          {panelCollapsed ? <PanelRightOpen size={20} /> : <PanelRightClose size={20} />}
        </button>
        <div className="stocks-panel-head">
          <div><h1>股票</h1><p>清风文章库中的活跃标的</p></div>
          <div className="stocks-panel-actions">
            <button className="mini-icon-btn" type="button" title="刷新" onClick={loadStocks}>
              <BarChart3 size={17} />
            </button>
          </div>
        </div>

        {/* 双指数卡片 */}
        <div className="index-dual">
          {INDEX_PERIODS.map(({ key, label }) => {
            const series = indexSeries[key];
            const latest = series.length ? series[series.length - 1].value : null;
            const prev = series.length > 1 ? series[series.length - 2].value : null;
            const chg = latest != null && prev != null ? latest - prev : null;
            const active = indexPeriod === key && !selected;
            return (
              <button key={key} className={`index-summary${active ? " active" : ""}`}
                type="button" onClick={() => selectIndex(key)}>
                <span>清风指数 · {label}</span>
                <strong>{latest != null ? formatNumber(latest) : "--"}</strong>
                {chg != null && <small className={chg >= 0 ? "up" : "down"}>
                  {chg >= 0 ? "+" : ""}{formatNumber(chg)}</small>}
              </button>
            );
          })}
        </div>

        <div className="sort-bar stock-sort-bar">
          {(["active_mentions", "mention_count", "last_mentioned"] as SortKey[]).map(key => (
            <button className={`sort-btn${sortBy === key ? " active" : ""}`} type="button" key={key}
              onClick={() => changeSort(key)}>
              {key === "active_mentions" ? "活跃" : key === "mention_count" ? "总提及" : "最新"}
              {sortBy === key ? (sortDir > 0 ? " ↑" : " ↓") : ""}
            </button>
          ))}
        </div>

        <div className="stock-list">
          {loading && <div className="loading compact">加载中...</div>}
          {!loading && sortedStocks.map(stock => (
            <button key={stock.order_book_id}
              className={`stock-row${selected?.order_book_id === stock.order_book_id ? " selected" : ""}`}
              type="button" onClick={() => selectStock(stock)}>
              <span className="stock-symbol">{stock.symbol}</span>
              <span className="stock-code">{stock.order_book_id}</span>
              <span className="stock-meta">活跃 {stock.active_mentions} / 总 {stock.mention_count}</span>
            </button>
          ))}
        </div>
      </aside>
    </section>
  );
}

function KLineProChart({
  symbol, isIndex, indexPoints, orderBookId, layoutKey, periods,
}: {
  symbol: SymbolInfo; isIndex: boolean; indexPoints?: KLinePoint[];
  orderBookId?: string; layoutKey: string; periods: Period[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<KLineChartProHandle | null>(null);
  const resizeLoopRef = useRef(0);
  const [error, setError] = useState("");
  const [theme, setTheme] = useState(() =>
    (document.documentElement.dataset.theme || "dark") as "light" | "dark");

  useEffect(() => {
    const root = document.documentElement;
    const update = () => setTheme((root.dataset.theme || "dark") as "light" | "dark");
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  const resizeChart = useCallback(() => {
    chartRef.current?._chartApi?.resize?.();
    window.dispatchEvent(new Event("resize"));
  }, []);

  const resizeChartDuringTransition = useCallback((duration = 320) => {
    window.cancelAnimationFrame(resizeLoopRef.current);
    const startedAt = window.performance.now();
    const tick = (now: number) => {
      resizeChart();
      if (now - startedAt < duration) resizeLoopRef.current = window.requestAnimationFrame(tick);
    };
    resizeLoopRef.current = window.requestAnimationFrame(tick);
  }, [resizeChart]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setError("");
    container.innerHTML = "";

    let datafeed: Datafeed;
    if (isIndex) {
      datafeed = new StaticDatafeed(symbol, indexPoints || []);
      if (!indexPoints?.length) return;
    } else {
      datafeed = {
        searchSymbols: (search?: string) => {
          const t = (search || "").trim().toLowerCase();
          const h = `${symbol.ticker} ${symbol.shortName || ""}`.toLowerCase();
          return Promise.resolve(!t || h.includes(t) ? [symbol] : []);
        },
        getHistoryKLineData: async (_s: SymbolInfo, _p: Period, _from: number, _to: number) => {
          const data = await api.get<{ prices: StockPrice[] }>(
            `/api/stocks/prices/${encodeURIComponent(orderBookId || symbol.ticker)}`,
          );
          return toStockKLine(data?.prices || []);
        },
        subscribe: () => {}, unsubscribe: () => {},
      };
    }

    try {
      chartRef.current = new KLineChartPro({
        container, locale: "zh-CN", theme, watermark: proWatermark,
        symbol, period: defaultPeriod, periods, timezone: "Asia/Shanghai",
        mainIndicators: ["MA"],
        subIndicators: ["VOL", "MACD"],
        datafeed,
      }) as unknown as KLineChartProHandle;
      resizeChartDuringTransition(160);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "KLineChart Pro 初始化失败");
    }
    return () => { chartRef.current = null; container.innerHTML = ""; };
  }, [theme, layoutKey, isIndex ? indexPoints : null]);  // index mode: re-init when data arrives

  useEffect(() => { resizeChartDuringTransition(); }, [layoutKey, resizeChartDuringTransition]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => resizeChartDuringTransition());
    });
    observer.observe(container);
    if (container.parentElement) observer.observe(container.parentElement);
    return () => { window.cancelAnimationFrame(frame); observer.disconnect(); };
  }, [resizeChartDuringTransition]);

  if (isIndex && (!indexPoints || !indexPoints.length)) return <div className="chart-placeholder">暂无图表数据</div>;

  return <div className="stock-pro-chart">
    <div className="stock-pro-chart-inner" ref={containerRef} />
    {error && <div className="chart-overlay-error">{error}</div>}
  </div>;
}
