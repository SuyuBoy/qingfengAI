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
let _subscribeCb: ((bar: any) => void) | null = null;
let _lastPeriodDate = "";  // 最后一条的 period_date，如 "2026-06-04-14-55"
let _minutePollTimer: ReturnType<typeof setTimeout> | null = null;
let _minutePollStopped = false;

function toPeriodDate(ts: number): string {
  // timestamp → "2026-06-04-14-55"
  const d = new Date(ts);
  const bj = new Date(d.getTime() + 8 * 3600000);
  const y = bj.getUTCFullYear();
  const mo = String(bj.getUTCMonth() + 1).padStart(2, "0");
  const da = String(bj.getUTCDate()).padStart(2, "0");
  const h = String(bj.getUTCHours()).padStart(2, "0");
  const mi = String(bj.getUTCMinutes()).padStart(2, "0");
  return `${y}-${mo}-${da}-${h}-${mi}`;
}

function msUntilNextPoll(): number {
  // 下个整10分钟的 +2 分钟
  const now = new Date();
  const bj = new Date(now.getTime() + 8 * 3600000);
  const m = bj.getUTCMinutes();
  const next10 = (Math.floor(m / 10) + 1) * 10;
  const target = new Date(bj);
  target.setUTCMinutes(next10 + 2, 0, 0);
  return target.getTime() - now.getTime();
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
  if (bars.length > 0) {
    _lastPeriodDate = toPeriodDate(bars[bars.length - 1].timestamp);
  }

  _minutePollStopped = false;
  const bs = new Date(Date.now() + 8 * 3600000);
  const isTrading = bs.getUTCDay() !== 0 && bs.getUTCDay() !== 6
    && !(bs.getUTCHours() < 9 || (bs.getUTCHours() === 9 && bs.getUTCMinutes() < 30))
    && !(bs.getUTCHours() >= 15 && bs.getUTCMinutes() > 0);
  if (isTrading) {
    _minutePollTimer = setTimeout(pollMinuteUpdates, msUntilNextPoll());
  }
  return bars;
}

function cancelMinutePoll() {
  _minutePollStopped = true;
  if (_minutePollTimer !== null) {
    clearTimeout(_minutePollTimer);
    _minutePollTimer = null;
  }
  _subscribeCb = null;
  _minuteLoaded = false;
}

async function pollMinuteUpdates() {
  if (_minutePollStopped) return;

  const now = new Date();
  const bj = new Date(now.getTime() + 8 * 3600000);
  const isTrading = bj.getUTCDay() !== 0 && bj.getUTCDay() !== 6
    && !(bj.getUTCHours() < 9 || (bj.getUTCHours() === 9 && bj.getUTCMinutes() < 30))
    && !(bj.getUTCHours() >= 15 && bj.getUTCMinutes() > 0);

  if (isTrading && _lastPeriodDate) {
    try {
      const data = await api.get<{ index: StockIndexPoint[] }>(
        `/api/stocks/index/ohlc?last=${_lastPeriodDate}`,
      );
      if (_minutePollStopped) return;
      const newBars = toIndexKLine(data?.index || []);
      if (newBars.length > 0 && _minuteBars) {
        _minuteBars = [..._minuteBars, ...newBars];
        _lastPeriodDate = toPeriodDate(newBars[newBars.length - 1].timestamp);
        if (_subscribeCb) {
          for (const bar of newBars) {
            _subscribeCb(bar);
          }
        }
      }
    } catch (_) {}
  }

  if (!_minutePollStopped && isTrading) {
    _minutePollTimer = setTimeout(pollMinuteUpdates, msUntilNextPoll());
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
      if (isIndex) cancelMinutePoll();
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
