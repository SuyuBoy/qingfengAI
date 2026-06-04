import { useEffect, useRef, useState } from "react";
import { KLineChartPro } from "@klinecharts/pro";
import { CandleType } from "klinecharts";
import type { Datafeed, Period, SymbolInfo } from "@klinecharts/pro";
import { api } from "../../api";
import type { StockIndexPoint, StockPrice } from "../../types";
import { toIndexKLine, toStockKLine, aggregateBars, swapUpDownColors, type KLinePoint } from "./stockUtils";

const defaultPeriod: Period = { multiplier: 1, timespan: "day", text: "D" };

type KLineChartProHandle = { _chartApi?: { resize?: () => void }; setStyles?: (s: any) => void; getStyles?: () => any };

// ---- 日K盘中更新 (直接查腾讯) ----
let _dailySubscribeCb: ((bar: any) => void) | null = null;
let _dailyPollTimer: ReturnType<typeof setTimeout> | null = null;
let _dailyPollStopped = false;
let _weightsCache: { holdings: any[]; base_value: number } | null = null;

const EX_MAP: Record<string, string> = { ".XSHG": "sh", ".XSHE": "sz" };
function toTc(code: string): string {
  for (const [suf, pre] of Object.entries(EX_MAP)) {
    if (code.endsWith(suf)) return pre + code.slice(0, 6);
  }
  return code;
}

function isTradingHours(): boolean {
  const bj = new Date(Date.now() + 8 * 3600000);
  return bj.getUTCDay() !== 0 && bj.getUTCDay() !== 6
    && !(bj.getUTCHours() < 9 || (bj.getUTCHours() === 9 && bj.getUTCMinutes() < 30))
    && bj.getUTCHours() < 15;
}

function stopDailyPoll() {
  _dailyPollStopped = true;
  if (_dailyPollTimer !== null) {
    clearTimeout(_dailyPollTimer);
    _dailyPollTimer = null;
  }
  _dailySubscribeCb = null;
}

async function fetchTcBar(tc: string): Promise<any | null> {
  try {
    const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tc},day,,,1,qfq`;
    const resp = await fetch(url);
    const text = await resp.text();
    let jsonStr = text.trim();
    if (jsonStr.startsWith("kline_day=")) jsonStr = jsonStr.slice(11);
    const data = JSON.parse(jsonStr);
    const bars = data?.data?.[tc]?.qfqday || data?.data?.[tc]?.day || [];
    if (!bars.length) return null;
    const last = bars[bars.length - 1];
    if (last.length < 6) return null;
    return {
      open: parseFloat(last[1]), close: parseFloat(last[2]),
      high: parseFloat(last[3]), low: parseFloat(last[4]),
      volume: parseFloat(last[5]),
    };
  } catch { return null; }
}

async function loadWeights(): Promise<void> {
  if (_weightsCache) return;
  const data = await api.get<{ holdings: any[]; base_value: number }>("/api/stocks/index/weights");
  if (data?.holdings?.length) {
    _weightsCache = { holdings: data.holdings, base_value: data.base_value };
  }
}

async function pollTencentDaily() {
  if (_dailyPollStopped) return;
  if (!isTradingHours()) return;

  await loadWeights();
  if (!_weightsCache || !_dailySubscribeCb) return;

  const { holdings, base_value } = _weightsCache;
  const results = await Promise.all(
    holdings.map(async (h: any) => {
      const code = h.o;
      if (!code) return null;
      const bar = await fetchTcBar(toTc(code));
      return bar ? { ...bar, w: parseFloat(h.w || "0") } : null;
    }),
  );

  let oSum = 0, hSum = 0, lSum = 0, cSum = 0, tw = 0;
  for (const r of results) {
    if (!r || r.w <= 0) continue;
    oSum += r.open * r.w;
    hSum += r.high * r.w;
    lSum += r.low * r.w;
    cSum += r.close * r.w;
    tw += r.w;
  }

  if (tw > 0 && base_value > 0) {
    const norm = (v: number) => parseFloat(((v / tw) / base_value * 1000).toFixed(2));
    _dailySubscribeCb({
      timestamp: Date.now(),
      open: norm(oSum), high: norm(hSum), low: norm(lSum), close: norm(cSum),
      volume: 0,
    });
  }

  if (!_dailyPollStopped && isTradingHours()) {
    _dailyPollTimer = setTimeout(pollTencentDaily, 60_000);
  }
}

function startDailyPoll() {
  if (_dailyPollTimer !== null) return;
  _dailyPollStopped = false;
  _weightsCache = null;  // 每次重新加载最新权重
  _dailyPollTimer = setTimeout(pollTencentDaily, 60_000);
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
      subscribe: (_s: SymbolInfo, _p: Period, cb: any) => {
        _dailySubscribeCb = cb;
        if (isTradingHours()) startDailyPoll();
      },
      unsubscribe: () => { stopDailyPoll(); },
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
      stopDailyPoll();
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
