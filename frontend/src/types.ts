export interface DynamicItem {
  dynamic_id: string; date: string; type: string; title: string; content: string;
  stocks?: string; sectors?: string; market_sent?: string; methods?: string;
}
export interface StockSummary {
  order_book_id: string; symbol: string; industry_name: string;
  active_mentions: number; mention_count: number; last_mentioned: string; active_from: string;
}
export interface StockIndexPoint {
  datetime: string; value: number; open?: number; high?: number; low?: number; close?: number; volume?: number;
}
export interface Holding { o: string; sc: number; w: number; }
export interface StockPrice {
  datetime: string; open: number; high: number; low: number; close: number; volume?: number; amount?: number;
}
