import { useEffect, useRef, useState } from "react";
import { KLineChartPro } from "@klinecharts/pro";
import { CandleType } from "klinecharts";
import type { Datafeed, Period, SymbolInfo } from "@klinecharts/pro";
import { api } from "../../api";
import type { StockIndexPoint, StockPrice } from "../../types";
import { toIndexKLine, toStockKLine, aggregateBars, swapUpDownColors, type KLinePoint } from "./stockUtils";

const defaultPeriod: Period = { multiplier: 1, timespan: "day", text: "D" };

type KLineChartProHandle = { _chartApi?: { resize?: () => void }; setStyles?: (s: any) => void; getStyles?: () => any };

// ---- 模块级缓存：前端持有全部分钟线，自己聚合 ----
let _minuteBars: KLinePoint[] | null = null;
let _minuteLoaded = false;
let _subscribeCb: ((bar: any) => void) | null = null;  // 图表实时推送回调

function isTradingTime(): boolean {
  const now = new Date();
  const bj = new Date(now.getTime() + 8 * 3600000);
  const h = bj.getUTCHours();
  const m = bj.getUTCMinutes();
  const wd = bj.getUTCDay();
  if (wd === 0 || wd === 6) return false;
  if (h < 9 || (h === 9 && m < 30)) return false;
  if (h > 15 || (h === 15 && m > 0)) return false;
  return true;
}

async function loadMinuteBars(): Promise<KLinePoint[]> {
  const d = new Date();
  const toDate = d.toISOString().slice(0, 10);
  d.setDate(d.getDate() - 7);
  const fromDate = d.toISOString().slice(0, 10);

  const data = await api.get<{ index: StockIndexPoint[] }>(
    `/api/stocks/index/ohlc?from=${fromDate}&to=${toDate}`,
  );
  const bars = toIndexKLine(data?.index || []);
  _minuteBars = bars;
  _minuteLoaded = true;

  if (isTradingTime()) {
    setTimeout(pollMinuteUpdates, 120000);
  }
  return bars;
}

async function pollMinuteUpdates() {
  if (!isTradingTime() || !_minuteBars || _minuteBars.length === 0) return;

  const lastTs = _minuteBars[_minuteBars.length - 1].timestamp;
  const fromDate = new Date(lastTs).toISOString().slice(0, 10);
  const data = await api.get<{ index: StockIndexPoint[] }>(
    `/api/stocks/index/ohlc?from=${fromDate}&to=${fromDate}`,
  );
  const newBars = toIndexKLine(data?.index || []);

  const trulyNew = newBars.filter(b => b.timestamp > lastTs);
  if (trulyNew.length > 0) {
    _minuteBars = [..._minuteBars, ...trulyNew];
    if (_subscribeCb) {
      for (const bar of trulyNew) {
        _subscribeCb(bar);
      }
    }
  }

  if (isTradingTime()) {
    setTimeout(pollMinuteUpdates, 120000);
  }
}

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

    const datafeed: Datafeed = isIndex ? {
      searchSymbols: (search?: string) => {
        const t = (search || "").trim().toLowerCase();
        const h = `${symbol.ticker} ${symbol.shortName || ""}`.toLowerCase();
        return Promise.resolve(!t || h.includes(t) ? [symbol] : []);
      },
      getHistoryKLineData: async (_s: SymbolInfo, period: Period, _from: number, _to: number) => {
        if (period.timespan === "minute") {
          if (!_minuteLoaded) {
            await loadMinuteBars();
          }
          return aggregateBars(_minuteBars || [], period.multiplier);
        }

        // 日线：加载一次缓存
        const cacheKey = period.timespan === "week" ? "week" : "day";
        if (!indexCache[cacheKey]) {
          const data = await api.get<{ index: StockIndexPoint[] }>("/api/stocks/index?period=1d");
          indexCache[cacheKey] = toIndexKLine(data?.index || []);
        }
        const all = aggregateBars(indexCache[cacheKey], period.multiplier);
        if (!all.length) return [];
        if (Number.isFinite(_from) && Number.isFinite(_to) && _to > _from) {
          return all.filter((p: any) => p.timestamp >= _from && p.timestamp <= _to);
        }
        return all;
      },
      subscribe: (_s: SymbolInfo, _p: Period, cb: any) => { _subscribeCb = cb; },
      unsubscribe: () => { _subscribeCb = null; },
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
