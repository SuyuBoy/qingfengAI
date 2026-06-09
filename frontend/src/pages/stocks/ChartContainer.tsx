import { useEffect, useRef, useState } from "react";
import { KLineChartPro } from "@klinecharts/pro";
import { CandleType, DomPosition, init as initKLineChart } from "klinecharts";
import type { Datafeed, Period, SymbolInfo } from "@klinecharts/pro";
import type { Chart as KLineChart } from "klinecharts";
import { api } from "../../api";
import type { StockIndexPoint, StockPrice, StockSummary } from "../../types";
import { toIndexKLine, toStockKLine, aggregateBars, swapUpDownColors, type KLinePoint } from "./stockUtils";
import { StockSearchDialog } from "./StockSearchDialog";

const defaultPeriod: Period = { multiplier: 1, timespan: "day", text: "D" };

type KLineChartProHandle = {
  setStyles?: (s: any) => void;
  getStyles?: () => any;
  setSymbol?: (symbol: SymbolInfo) => void;
};
type InnerKLineChart = KLineChart & { resize?: () => void };

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

function toChartSymbol(stock: StockSummary): SymbolInfo {
  return {
    ticker: stock.order_book_id,
    shortName: stock.symbol,
    name: stock.industry_name || stock.symbol,
    market: "stocks",
    pricePrecision: 2,
    volumePrecision: 0,
  };
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
      return l.length >= 6 ? { o: parseFloat(l[1]), c: parseFloat(l[2]), w: parseFloat(h.w || "0") } : null;
    } catch { return null; }
  }));

  // 指数 = 前收 × 加权日内收益
  let ret = 0, tw = 0;
  for (const r of results) {
    if (r && r.w > 0 && r.o > 0) { ret += r.w * (r.c / r.o); tw += r.w; }
  }
  if (tw <= 0 || base_value <= 0) return null;
  const v = parseFloat((base_value * ret / tw).toFixed(2));
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
  symbol, periods, layoutKey, stocks, selectedStock, onSymbolSelect,
}: {
  symbol: SymbolInfo; periods: Period[]; layoutKey: string;
  stocks: StockSummary[];
  selectedStock: StockSummary | null;
  onSymbolSelect: (stock: StockSummary) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<KLineChartProHandle | null>(null);
  const innerChartRef = useRef<InnerKLineChart | null>(null);
  const scheduleResizeRef = useRef<(delay?: number) => void>(() => {});
  const [error, setError] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setError("");
    container.innerHTML = "";

    const rafIds: number[] = [];
    const resizeTimers: ReturnType<typeof setTimeout>[] = [];
    const getInnerChart = () => {
      if (innerChartRef.current) return innerChartRef.current;
      const chartDom = container.querySelector<HTMLElement>("[k-line-chart-id]");
      const chartId = chartDom?.getAttribute("k-line-chart-id");
      if (!chartDom || !chartId) return null;
      chartDom.id = chartId;
      innerChartRef.current = initKLineChart(chartDom) as InnerKLineChart | null;
      return innerChartRef.current;
    };
    const fitHorizontalScale = () => {
      const chart = getInnerChart();
      const dataCount = chart?.getDataList?.().length || 0;
      if (!chart || dataCount <= 0) return;

      chart.resize?.();
      const mainWidth = chart.getSize("candle_pane", DomPosition.Main)?.width || 0;
      if (mainWidth <= 0) return;

      const maxVisibleCount = Math.max(1, Math.floor(mainWidth / 4));
      const targetVisibleCount = Math.max(45, Math.min(dataCount + 6, maxVisibleCount));
      const barSpace = Math.min(28, Math.max(4, (mainWidth - 24) / targetVisibleCount));
      chart.setBarSpace(Number(barSpace.toFixed(2)));
      chart.scrollToRealTime(0);
    };
    const resizeChart = () => {
      window.dispatchEvent(new Event("resize"));
      rafIds.push(requestAnimationFrame(fitHorizontalScale));
    };
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
    const stockSymbols = stocks.map(toChartSymbol);
    const searchableSymbols = stockSymbols.length ? stockSymbols : (symbol.ticker === "QF_INDEX" ? [] : [symbol]);
    const matchSymbol = (item: SymbolInfo, search: string) => {
      const t = search.trim().toLowerCase();
      if (!t) return true;
      return `${item.ticker} ${item.shortName || ""} ${item.name || ""} ${item.exchange || ""}`.toLowerCase().includes(t);
    };

    const patchSearchModalText = () => {
      container.querySelectorAll(".klinecharts-pro-modal .title-container").forEach(title => {
        if (title.textContent?.includes("商品搜索")) {
          for (const node of Array.from(title.childNodes)) {
            if (node.nodeType === Node.TEXT_NODE && node.textContent?.includes("商品搜索")) {
              node.textContent = node.textContent.replace("商品搜索", "股票搜索");
            }
          }
        }
      });
      container.querySelectorAll<HTMLInputElement>(".klinecharts-pro-symbol-search-modal-input input").forEach(input => {
        if (input.placeholder === "商品代码") input.placeholder = "股票代码";
      });
    };

    const datafeed: Datafeed = {
      searchSymbols: (search?: string) => {
        return Promise.resolve(searchableSymbols.filter(item => matchSymbol(item, search || "")));
      },
      getHistoryKLineData: async (target: SymbolInfo, period: Period, from: number, to: number) => {
        if (target.ticker !== "QF_INDEX") {
          const params = new URLSearchParams();
          if (Number.isFinite(from)) params.set("start", new Date(from).toISOString().slice(0, 10));
          if (Number.isFinite(to)) params.set("end", new Date(to).toISOString().slice(0, 10));
          const qs = params.toString();
          const data = await api.get<{ prices: StockPrice[] }>(
            `/api/stocks/prices/${encodeURIComponent(target.ticker)}${qs ? "?" + qs : ""}`,
          );
          const bars = toStockKLine(data?.prices || []);
          scheduleResize();
          return bars;
        }

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
        if (Number.isFinite(from) && Number.isFinite(to) && to > from) {
          return all.filter((p: any) => p.timestamp >= from && p.timestamp <= to);
        }
        return all;
      },
      subscribe: (target: SymbolInfo, _p: Period, cb: any) => {
        if (target.ticker !== "QF_INDEX") {
          cancelDailyPoll();
          return;
        }
        _subscribeCb = cb;
        _weightsCache = null;  // 每次挂载重新拉权重
        if (isTradingHours()) _pollTimer = setTimeout(doPoll, 60_000);
      },
      unsubscribe: () => { cancelDailyPoll(); },
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
    const modalObserver = new MutationObserver(patchSearchModalText);
    modalObserver.observe(container, { childList: true, subtree: true });
    patchSearchModalText();
    const onSymbolClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".klinecharts-pro-period-bar .symbol")) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setSearchOpen(true);
    };
    container.addEventListener("click", onSymbolClick, true);

    return () => {
      cancelDailyPoll();
      obs.disconnect();
      modalObserver.disconnect();
      window.removeEventListener("orientationchange", resizeChart);
      window.visualViewport?.removeEventListener("resize", resizeChart);
      container.removeEventListener("click", onSymbolClick, true);
      rafIds.forEach(id => cancelAnimationFrame(id));
      resizeTimers.forEach(timer => clearTimeout(timer));
      scheduleResizeRef.current = () => {};
      chartRef.current = null;
      innerChartRef.current = null;
      container.innerHTML = "";
    };
  }, [symbol.ticker, stocks]);

  useEffect(() => {
    [0, 80, 180, 300, 460].forEach(delay => scheduleResizeRef.current(delay));
  }, [layoutKey]);

  return <div className="stock-pro-chart">
    <div className="stock-pro-chart-inner" ref={containerRef} />
    <StockSearchDialog
      open={searchOpen}
      stocks={stocks}
      selected={selectedStock}
      onOpenChange={setSearchOpen}
      onSelect={stock => {
        chartRef.current?.setSymbol?.(toChartSymbol(stock));
        onSymbolSelect(stock);
      }}
    />
    {error && <div className="chart-overlay-error">{error}</div>}
  </div>;
}
