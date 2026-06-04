import { useEffect, useRef, useState } from "react";
import { KLineChartPro } from "@klinecharts/pro";
import { CandleType } from "klinecharts";
import type { Datafeed, Period, SymbolInfo } from "@klinecharts/pro";
import { api } from "../../api";
import type { StockIndexPoint, StockPrice } from "../../types";
import { toIndexKLine, toStockKLine, aggregateBars, swapUpDownColors, type KLinePoint } from "./stockUtils";

const defaultPeriod: Period = { multiplier: 1, timespan: "day", text: "D" };

type KLineChartProHandle = { _chartApi?: { resize?: () => void }; setStyles?: (s: any) => void; getStyles?: () => any };

export function ChartContainer({
  symbol, isIndex, orderBookId, periods, layoutKey,
}: {
  symbol: SymbolInfo; isIndex: boolean;
  orderBookId?: string; periods: Period[]; layoutKey: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<KLineChartProHandle | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setError("");
    container.innerHTML = "";

    const theme = (document.documentElement.dataset.theme || "dark") as "light" | "dark";
    const indexCache: Record<string, KLinePoint[]> = {};
    const minuteCache: Record<string, KLinePoint[]> = {};

    const datafeed: Datafeed = isIndex ? {
      searchSymbols: (search?: string) => {
        const t = (search || "").trim().toLowerCase();
        const h = `${symbol.ticker} ${symbol.shortName || ""}`.toLowerCase();
        return Promise.resolve(!t || h.includes(t) ? [symbol] : []);
      },
      getHistoryKLineData: async (_s: SymbolInfo, period: Period, from: number, to: number) => {
        const isMin = period.timespan === "minute";
        const cacheKey = isMin ? "minute" : "day";

        if (cacheKey === "minute") {
          if (!minuteCache["_all"]) {
            const d = new Date();
            const toDate = d.toISOString().slice(0, 10);
            d.setDate(d.getDate() - 7);
            const params = new URLSearchParams();
            params.set("from", d.toISOString().slice(0, 10));
            params.set("to", toDate);
            const data = await api.get<{ index: StockIndexPoint[] }>(
              `/api/stocks/index/ohlc?${params.toString()}`,
            );
            minuteCache["_all"] = toIndexKLine(data?.index || []);
          }
          return aggregateBars(minuteCache["_all"], period.multiplier);
        }

        if (!indexCache[cacheKey]) {
          const data = await api.get<{ index: StockIndexPoint[] }>("/api/stocks/index?period=1d");
          indexCache[cacheKey] = toIndexKLine(data?.index || []);
        }

        const all = aggregateBars(indexCache[cacheKey], period.multiplier);
        if (!all.length) return [];
        if (Number.isFinite(from) && Number.isFinite(to) && to > from) {
          return all.filter((p: any) => p.timestamp >= from && p.timestamp <= to);
        }
        return all;
      },
      subscribe: () => {}, unsubscribe: () => {},
    } : {
      searchSymbols: (search?: string) => {
        const t = (search || "").trim().toLowerCase();
        const h = `${symbol.ticker} ${symbol.shortName || ""}`.toLowerCase();
        return Promise.resolve(!t || h.includes(t) ? [symbol] : []);
      },
      getHistoryKLineData: async (_s: SymbolInfo, _p: Period, from: number, to: number) => {
        const params = new URLSearchParams();
        if (Number.isFinite(from)) params.set("start", new Date(from).toISOString().slice(0, 10));
        if (Number.isFinite(to)) params.set("end", new Date(to).toISOString().slice(0, 10));
        const qs = params.toString();
        const data = await api.get<{ prices: StockPrice[] }>(
          `/api/stocks/prices/${encodeURIComponent(orderBookId || symbol.ticker)}${qs ? "?" + qs : ""}`,
        );
        return toStockKLine(data?.prices || []);
      },
      subscribe: () => {}, unsubscribe: () => {},
    };

    try {
      chartRef.current = new KLineChartPro({
        container, locale: "zh-CN", theme, watermark: "",
        symbol, period: defaultPeriod, periods, timezone: "Asia/Shanghai",
        mainIndicators: ["MA"], subIndicators: ["VOL", "MACD"], datafeed,
      }) as unknown as KLineChartProHandle;

      requestAnimationFrame(() => {
        const styles = chartRef.current?.getStyles?.() || {};
        const swapped = swapUpDownColors(styles);
        swapped.candle = { ...(swapped.candle || {}), type: CandleType.CandleSolid };
        chartRef.current?.setStyles?.(swapped);
      });
    } catch (reason: any) {
      setError(reason?.message || "图表初始化失败");
    }

    const obs = new ResizeObserver(() => {
      chartRef.current?._chartApi?.resize?.();
    });
    if (container.parentElement) obs.observe(container.parentElement);
    obs.observe(container);

    return () => {
      obs.disconnect();
      chartRef.current = null;
      container.innerHTML = "";
    };
  }, [symbol.ticker, isIndex, orderBookId, layoutKey]);

  return <div className="stock-pro-chart">
    <div className="stock-pro-chart-inner" ref={containerRef} />
    {error && <div className="chart-overlay-error">{error}</div>}
  </div>;
}
