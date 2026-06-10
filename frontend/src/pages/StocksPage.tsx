import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { StockIndexPoint, StockSummary, UserRole } from "../types";
import { StockPanel } from "./stocks/StockPanel";
import { ChartContainer } from "./stocks/ChartContainer";

interface StocksPageProps {
  userRole?: UserRole;
}

type SortKey = "active_mentions" | "mention_count" | "last_mentioned";

const INDEX_CHART_PERIODS = [
  { multiplier: 1, timespan: "day", text: "D" },
];

function toPeriods(_stock: StockSummary | null): any[] {
  return INDEX_CHART_PERIODS;
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

export default function StocksPage({ userRole = "unpaid" }: StocksPageProps) {
  const isPro = userRole === "pro" || userRole === "admin";
  const [stocks, setStocks] = useState<StockSummary[]>([]);
  const [selected, setSelected] = useState<StockSummary | null>(null);
  const [indexSeries, setIndexSeries] = useState<StockIndexPoint[]>([]);
  const [sortBy, setSortBy] = useState<SortKey>("active_mentions");
  const [sortDir, setSortDir] = useState(-1);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [holdingsData, setHoldingsData] = useState<Record<string, any[]>>({});
  const [error, setError] = useState("");
  const [topN, setTopN] = useState(15);

  const last = indexSeries[indexSeries.length - 1];
  const prev = indexSeries[indexSeries.length - 2];
  const indexValue = last?.value ?? 0;
  const indexChange = (last && prev) ? last.value - prev.value : 0;

  const loadAll = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const indexUrl = topN !== 15
        ? `/api/stocks/index/recalculate?top_n=${topN}`
        : "/api/stocks/index?period=1d";
      const [sData, iData] = await Promise.all([
        api.get<{ stocks: StockSummary[] }>("/api/stocks/active"),
        api.get<{ index: StockIndexPoint[] }>(indexUrl),
      ]);
      setStocks(sData?.stocks || []);
      setIndexSeries(iData?.index || []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "数据加载失败";
      setError(msg);
    }
    setLoading(false);
  }, [topN]);

  const loadHoldings = useCallback(async () => {
    if (!isPro) return;
    try {
      const data = await api.get<{ holdings: Record<string, any[]> }>("/api/stocks/index/holdings");
      setHoldingsData(data?.holdings || {});
    } catch { /* holdings optional */ }
  }, [isPro]);

  const changeSort = useCallback((key: SortKey) => {
    setSortBy(prev => {
      if (prev === key) { setSortDir(d => -d); return key; }
      setSortDir(-1); return key;
    });
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // 盘中实时更新卡片数值
  useEffect(() => {
    const onRealtime = (e: Event) => {
      const close = (e as CustomEvent).detail?.close;
      if (close == null) return;
      setIndexSeries(prev => {
        if (!prev.length) return prev;
        const last = prev[prev.length - 1];
        return [...prev.slice(0, -1), { ...last, value: close, close }];
      });
    };
    window.addEventListener("index-realtime", onRealtime);
    return () => window.removeEventListener("index-realtime", onRealtime);
  }, []);

  const periods = toPeriods(selected);
  const symbolInfo = toSymbolInfo(selected);

  return (
    <section className={`stocks-page${collapsed ? " stocks-collapsed" : ""}`}>
      <div className="stock-chart-panel">
        <ChartContainer
          key={`chart:${selected?.order_book_id || "index"}:n${topN}`}
          symbol={symbolInfo} periods={periods}
          layoutKey={collapsed ? "collapsed" : "expanded"} stocks={stocks}
          selectedStock={selected} onSymbolSelect={setSelected}
          topN={topN} />
      </div>

      <StockPanel
        stocks={stocks} loading={loading}
        selected={selected} sortBy={sortBy} sortDir={sortDir}
        onSelect={setSelected} onSelectIndex={() => setSelected(null)}
        onChangeSort={changeSort} onRefresh={loadAll}
        indexValue={indexValue} indexChange={indexChange}
        holdingsData={holdingsData} onLoadHoldings={loadHoldings} isPro={isPro}
        collapsed={collapsed} onToggleCollapse={() => setCollapsed(c => !c)}
        topN={topN} onTopNChange={setTopN} />
    </section>
  );
}
