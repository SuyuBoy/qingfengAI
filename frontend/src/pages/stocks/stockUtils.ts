import type { KLineData } from "klinecharts";
import type { StockIndexPoint, StockPrice } from "../../types";

export type KLinePoint = KLineData & { turnover?: number };

export function datetimeToTs(datetime: string) {
  const parts = datetime.split("-");
  const date = parts.slice(0, 3).join("-");
  const time = parts.slice(3).join(":") || "00:00";
  return new Date(`${date}T${time}:00+08:00`).getTime();
}

export function formatNumber(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : "--";
}

export function toIndexKLine(series: StockIndexPoint[]): KLinePoint[] {
  return series.map((point, i) => {
    const prevClose = i > 0 ? series[i - 1].value : point.value;
    const o = point.open ?? prevClose;
    const c = point.close ?? point.value;
    return {
      timestamp: datetimeToTs(point.datetime),
      open: o,
      high: point.high ?? Math.max(o, c),
      low: point.low ?? Math.min(o, c),
      close: c,
      volume: Number(point.volume || 0),
    };
  }).filter(p => Number.isFinite(p.timestamp) && Number.isFinite(p.close));
}

export function toStockKLine(series: StockPrice[]): KLinePoint[] {
  return series.map(point => ({
    timestamp: datetimeToTs(point.datetime),
    open: Number(point.open),
    high: Number(point.high),
    low: Number(point.low),
    close: Number(point.close),
    volume: Number(point.volume || 0),
    turnover: Number(point.amount || 0),
  })).filter(p => Number.isFinite(p.timestamp) && Number.isFinite(p.close));
}

export function aggregateBars(bars: KLinePoint[], multiplier: number): KLinePoint[] {
  if (multiplier <= 1) return bars;
  const result: KLinePoint[] = [];
  let group: KLinePoint[] = [];
  for (const bar of bars) {
    group.push(bar);
    if (group.length >= multiplier) {
      result.push({
        timestamp: group[0].timestamp,
        open: group[0].open,
        high: Math.max(...group.map(b => b.high)),
        low: Math.min(...group.map(b => b.low)),
        close: group[group.length - 1].close,
        volume: group.reduce((s, b) => s + (b.volume || 0), 0),
        turnover: group.reduce((s, b) => s + (b.turnover || 0), 0),
      });
      group = [];
    }
  }
  return result;
}

export function swapUpDownColors(obj: any): any {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(swapUpDownColors);
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = swapUpDownColors(v);
  }
  if ("upColor" in out && "downColor" in out) {
    [out.upColor, out.downColor] = [out.downColor, out.upColor];
  }
  if ("upBorderColor" in out && "downBorderColor" in out) {
    [out.upBorderColor, out.downBorderColor] = [out.downBorderColor, out.upBorderColor];
  }
  if ("upWickColor" in out && "downWickColor" in out) {
    [out.upWickColor, out.downWickColor] = [out.downWickColor, out.upWickColor];
  }
  return out;
}
