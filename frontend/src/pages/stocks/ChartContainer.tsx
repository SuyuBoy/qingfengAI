import { useEffect, useRef, useState } from "react";
import { KLineChartPro } from "@klinecharts/pro";
import { CandleType } from "klinecharts";
import type { Datafeed, Period, SymbolInfo } from "@klinecharts/pro";
import { api } from "../../api";
import type { StockIndexPoint, StockPrice } from "../../types";
import { toIndexKLine, toStockKLine, aggregateBars, swapUpDownColors, type KLinePoint } from "./stockUtils";

const defaultPeriod: Period = { multiplier: 1, timespan: "day", text: "D" };

type KLineChartProHandle = { _chartApi?: { resize?: () => void }; setStyles?: (s: any) => void; getStyles?: () => any };

// ---- 日K盘中更新 ----
// 后端已固化的最后一根 bar 作为"锚"，轮询只覆盖 close
let _backendLastBar: KLinePoint | null = null;
let _subscribeCb: ((bar: any) => void) | null = null;
let _pollTimer: ReturnType<typeof setTimeout> | null = null;
let _weightsCache: { holdings: any[]; base_value: number } | null = null;

const EX_MAP: Record<string, string> = { ".XSHG": "sh", ".XSHE": "sz" };
function toTc(c: string): string {
  for (const [suf, pre] of Object.entries(EX_MAP)) {
    if (c.endsWith(suf)) return pre + c.slice(0, 6);
  }
  return c;
}

function isTradingHours(): boolean {
  const bj = new Date(Date.now() + 8 * 3600000);
  return bj.getUTCDay() !== 0 && bj.getUTCDay() !== 6
    && !(bj.getUTCHours() < 9 || (bj.getUTCHours() === 9 && bj.getUTCMinutes() < 30))
    && bj.getUTCHours() < 15;
}

function cancelDailyPoll() {
  _subscribeCb = null;
  _backendLastBar = null;
  if (_pollTimer !== null) { clearTimeout(_pollTimer); _pollTimer = null; }
}

// 从腾讯个股日K加权算当前指数 close
async function computeIndexClose(): Promise<number | null> {
  if (!_weightsCache) {
    const data = await api.get<{ holdings: any[]; base_value: number }>("/api/stocks/index/weights");
    if (data?.holdings?.length) _weightsCache = { holdings: data.holdings, base_value: data.base_value };
  }
  if (!_weightsCache) return null;

  const { holdings, base_value } = _weightsCache;
  const results = await Promise.all(holdings.map(async (h: any) => {
    const code = h.o; if (!code) return null;
    try {
      const resp = await fetch(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${toTc(code)},day,,,1,qfq`);
      const text = await resp.text();
      let jsonStr = text.trim();
      if (jsonStr.startsWith("kline_day=")) jsonStr = jsonStr.slice(11);
      const bars = JSON.parse(jsonStr)?.data?.[toTc(code)]?.qfqday || JSON.parse(jsonStr)?.data?.[toTc(code)]?.day || [];
      if (!bars.length) return null;
      const l = bars[bars.length - 1];
      return l.length >= 6 ? { c: parseFloat(l[2]), w: parseFloat(h.w || "0") } : null;
    } catch { return null; }
  }));

  let cSum = 0, tw = 0;
  for (const r of results) { if (r && r.w > 0) { cSum += r.c * r.w; tw += r.w; } }
  if (tw <= 0 || base_value <= 0) return null;
  const v = parseFloat(((cSum / tw) / base_value * 1000).toFixed(2));
  return v > 0 && Number.isFinite(v) ? v : null;
}

async function doPoll() {
  if (!isTradingHours() || !_subscribeCb || !_backendLastBar) return;
  const c = await computeIndexClose();
  if (c != null && c > 0 && Number.isFinite(c)) {
    // 以后端 bar 为锚：O 不动，H/L 只在 close 超出时扩展
    const b = _backendLastBar;
    _subscribeCb({
      timestamp: b.timestamp,
      open: b.open,
      high: Math.max(b.high, c),
      low: Math.min(b.low, c),
      close: c,
      volume: b.volume,
    });
    window.dispatchEvent(new CustomEvent("index-realtime", { detail: { close: c } }));
  }
  if (isTradingHours()) _pollTimer = setTimeout(doPoll, 60_000);
}

export function ChartContainer({
  symbol, isIndex, orderBookId, periods, layoutKey,
}: {
  symbol: SymbolInfo; isIndex: boolean;
  orderBookId?: string; periods: Period[]; layoutKey: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<KLineChartProHandle | null>(null);
  const scheduleResizeRef = useRef<(delay?: number) => void>(() => {});
  const [error, setError] = useState("");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setError("");
    container.innerHTML = "";

    const rafIds: number[] = [];
    const resizeTimers: ReturnType<typeof setTimeout>[] = [];
    const resizeChart = () => chartRef.current?._chartApi?.resize?.();
    const scheduleResize = (delay = 0) => {
      if (delay > 0) {
        resizeTimers.push(setTimeout(resizeChart, delay));
        return;
      }
      rafIds.push(requestAnimationFrame(resizeChart));
    };
    scheduleResizeRef.current = scheduleResize;

    const theme = (document.documentElement.dataset.theme || "dark") as "light" | "dark";
    const indexCache: Record<string, KLinePoint[]> = {};

    const datafeed: Datafeed = isIndex ? {
      searchSymbols: (search?: string) => {
        const t = (search || "").trim().toLowerCase();
        const h = `${symbol.ticker} ${symbol.shortName || ""}`.toLowerCase();
        return Promise.resolve(!t || h.includes(t) ? [symbol] : []);
      },
      getHistoryKLineData: async (_s: SymbolInfo, period: Period, _from: number, _to: number) => {
        const cacheKey = period.timespan === "week" ? "week" : "day";
        if (!indexCache[cacheKey]) {
          const data = await api.get<{ index: StockIndexPoint[] }>("/api/stocks/index?period=1d");
          const bars = toIndexKLine(data?.index || []);
          if (bars.length) _backendLastBar = bars[bars.length - 1];
          indexCache[cacheKey] = bars;
        }
        const all = aggregateBars(indexCache[cacheKey], period.multiplier);
        if (!all.length) return [];
        scheduleResize();
        if (Number.isFinite(_from) && Number.isFinite(_to) && _to > _from) {
          return all.filter((p: any) => p.timestamp >= _from && p.timestamp <= _to);
        }
        return all;
      },
      subscribe: (_s: SymbolInfo, _p: Period, cb: any) => {
        _subscribeCb = cb;
        _weightsCache = null;  // 每次挂载重新拉权重
        if (isTradingHours()) _pollTimer = setTimeout(doPoll, 60_000);
      },
      unsubscribe: () => { cancelDailyPoll(); },
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
        const bars = toStockKLine(data?.prices || []);
        scheduleResize();
        return bars;
      },
      subscribe: () => {}, unsubscribe: () => {},
    };

    try {
      chartRef.current = new KLineChartPro({
        container, locale: "zh-CN", theme, watermark: "清风指数 · AI驱动<br>不代表投资建议",
        symbol, period: defaultPeriod, periods, timezone: "Asia/Shanghai",
        mainIndicators: ["MA"], subIndicators: ["VOL", "MACD"], datafeed,
      }) as unknown as KLineChartProHandle;

      requestAnimationFrame(() => {
        const styles = chartRef.current?.getStyles?.() || {};
        const swapped = swapUpDownColors(styles);
        swapped.candle = { ...(swapped.candle || {}), type: CandleType.CandleSolid };
        chartRef.current?.setStyles?.(swapped);
        resizeChart();
        scheduleResize();
      });
      scheduleResize(120);
      scheduleResize(360);
    } catch (reason: any) {
      setError(reason?.message || "图表初始化失败");
    }

    const obs = new ResizeObserver(() => {
      scheduleResize();
    });
    if (container.parentElement) obs.observe(container.parentElement);
    obs.observe(container);
    window.addEventListener("orientationchange", resizeChart);
    window.visualViewport?.addEventListener("resize", resizeChart);

    return () => {
      cancelDailyPoll();
      obs.disconnect();
      window.removeEventListener("orientationchange", resizeChart);
      window.visualViewport?.removeEventListener("resize", resizeChart);
      rafIds.forEach(id => cancelAnimationFrame(id));
      resizeTimers.forEach(timer => clearTimeout(timer));
      scheduleResizeRef.current = () => {};
      chartRef.current = null;
      container.innerHTML = "";
    };
  }, [symbol.ticker, isIndex, orderBookId]);

  useEffect(() => {
    [0, 80, 180, 300, 460].forEach(delay => scheduleResizeRef.current(delay));
  }, [layoutKey]);

  return <div className="stock-pro-chart">
    <div className="stock-pro-chart-inner" ref={containerRef} />
    {error && <div className="chart-overlay-error">{error}</div>}
  </div>;
}
