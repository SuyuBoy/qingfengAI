import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { StockIndexPoint, StockSummary } from "../types";
import { StockPanel } from "./stocks/StockPanel";
import { ChartContainer } from "./stocks/ChartContainer";

type SortKey = "active_mentions" | "mention_count" | "last_mentioned";

const INDEX_CHART_PERIODS = [
  { multiplier: 1, timespan: "minute", text: "1m" },
  { multiplier: 5, timespan: "minute", text: "5m" },
  { multiplier: 15, timespan: "minute", text: "15m" },
  { multiplier: 30, timespan: "minute", text: "30m" },
  { multiplier: 1, timespan: "day", text: "D" },
  { multiplier: 1, timespan: "week", text: "W" },
];

function toPeriods(stock: StockSummary | null): any[] {
  if (!stock) return INDEX_CHART_PERIODS;
  const days = Math.ceil((Date.now() - new Date(stock.active_from || "2026-01-01").getTime()) / 86400000);
  const periods: any[] = [];
  if (days <= 3) {
    periods.push({ multiplier: 1, timespan: "minute", text: "1m" });
    periods.push({ multiplier: 5, timespan: "minute", text: "5m" });
  }
  periods.push({ multiplier: 1, timespan: "day", text: "D" });
  if (days > 30) periods.push({ multiplier: 1, timespan: "week", text: "W" });
  return periods;
}

function toSymbolInfo(selected: StockSummary | null): any {
  if (selected) return {
    ticker: selected.order_book_id, shortName: selected.symbol,
    name: selected.industry_name || selected.symbol,
    market: "stocks", pricePrecision: 2, volumePrecision: 0,
  };
  return {
    ticker: "QF_INDEX", shortName: "QF",
    name: "清风指数",
    market: "stocks", pricePrecision: 2, volumePrecision: 0,
  };
}

export default function StocksPage() {
  const [stocks, setStocks] = useState<StockSummary[]>([]);
  const [selected, setSelected] = useState<StockSummary | null>(null);
  const [indexSeries, setIndexSeries] = useState<StockIndexPoint[]>([]);
  const [sortBy, setSortBy] = useState<SortKey>("active_mentions");
  const [sortDir, setSortDir] = useState(-1);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [holdingsData, setHoldingsData] = useState<Record<string, any[]>>({});
  const [error, setError] = useState("");

  const last = indexSeries[indexSeries.length - 1];
  const prev = indexSeries[indexSeries.length - 2];
  const indexValue = last?.value ?? 0;
  const indexChange = (last && prev) ? last.value - prev.value : 0;

  const loadAll = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const [sData, iData] = await Promise.all([
        api.get<{ stocks: StockSummary[] }>("/api/stocks/active"),
        api.get<{ index: StockIndexPoint[] }>("/api/stocks/index?period=1d"),
      ]);
      setStocks(sData?.stocks || []);
      setIndexSeries(iData?.index || []);
    } catch { setError("数据加载失败"); }
    setLoading(false);
  }, []);

  const loadHoldings = useCallback(async () => {
    try {
      const data = await api.get<{ holdings: Record<string, any[]> }>("/api/stocks/index/holdings");
      setHoldingsData(data?.holdings || {});
    } catch { /* holdings optional */ }
  }, []);

  const changeSort = useCallback((key: SortKey) => {
    setSortBy(prev => {
      if (prev === key) { setSortDir(d => -d); return key; }
      setSortDir(-1); return key;
    });
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const periods = toPeriods(selected);
  const symbolInfo = toSymbolInfo(selected);

  return (
    <section className={`stocks-page${collapsed ? " stocks-collapsed" : ""}`}>
      <div className="stock-chart-panel">
        <ChartContainer
          key={`chart:${selected?.order_book_id || "index"}`}
          symbol={symbolInfo} isIndex={!selected}
          orderBookId={selected?.order_book_id}
          periods={periods} layoutKey={collapsed ? "collapsed" : "expanded"} />
      </div>

      <StockPanel
        stocks={stocks} loading={loading}
        selected={selected} sortBy={sortBy} sortDir={sortDir}
        onSelect={setSelected} onSelectIndex={() => setSelected(null)}
        onChangeSort={changeSort} onRefresh={loadAll}
        indexValue={indexValue} indexChange={indexChange}
        holdingsData={holdingsData} onLoadHoldings={loadHoldings}
        collapsed={collapsed} onToggleCollapse={() => setCollapsed(c => !c)} />
    </section>
  );
}
