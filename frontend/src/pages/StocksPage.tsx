import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, SlidersHorizontal } from "lucide-react";
import { api } from "../api";
import type { StockIndexPoint, StockPrice, StockSummary } from "../types";

type SortKey = "active_mentions" | "mention_count" | "last_mentioned";
type SeriesPoint = { label: string; value: number };

const defaultBaseDate = new Date().toISOString().slice(0, 10);

function formatNumber(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : "--";
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

  const chartSeries = useMemo<SeriesPoint[]>(() => {
    if (selected) return prices.map(price => ({ label: price.datetime, value: price.close }));
    return indexSeries.map(point => ({ label: point.datetime, value: point.value }));
  }, [indexSeries, prices, selected]);

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
        {chartLoading ? <div className="chart-placeholder">加载中...</div> : <LineChart points={chartSeries} />}
      </div>
    </section>
  );
}

function LineChart({ points }: { points: SeriesPoint[] }) {
  if (!points.length) return <div className="chart-placeholder">暂无图表数据</div>;
  const values = points.map(point => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = 900;
  const height = 420;
  const path = points.map((point, index) => {
    const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
    const y = height - ((point.value - min) / span) * height;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");

  return (
    <div className="line-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="走势线图">
        <defs>
          <linearGradient id="stock-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="chart-area" d={`${path} L ${width} ${height} L 0 ${height} Z`} />
        <path className="chart-line" d={path} />
      </svg>
      <div className="chart-scale">
        <span>{points[0].label}</span>
        <strong>{formatNumber(values[values.length - 1])}</strong>
        <span>{points[points.length - 1].label}</span>
      </div>
    </div>
  );
}
