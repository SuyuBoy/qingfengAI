export type UserRole = "unpaid" | "paid" | "admin" | string;

export interface CurrentUser {
  email: string;
  role: UserRole;
  is_admin?: boolean;
}

export interface DynamicItem {
  dynamic_id: string;
  date: string;
  type?: string;
  title?: string;
  content: string;
  tags?: string;
  stocks?: string;
  sectors?: string;
  sentiment?: string;
  methods?: string;
}

export interface DynamicsResponse {
  items: DynamicItem[];
  has_more: boolean;
  next_cursor: string;
}

export interface ArticleSummary {
  id: string;
  date: string;
  title?: string;
  snippet?: string;
  stocks?: string;
  sectors?: string;
  sentiment?: string;
  methods?: string;
}

export interface ChatToolCall {
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  id?: string;
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_calls?: ChatToolCall[];
  reasoning_content?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
  createdAt: number;
}

export interface ToolCardData {
  id: string;
  name: string;
  query: string;
  cached: boolean;
  articles: ArticleSummary[];
}

export interface DebugLogEntry {
  round: number;
  request: unknown;
  response?: string;
}

export interface DsCacheStats {
  hit: number;
  miss: number;
}

export interface StockSummary {
  order_book_id: string;
  symbol: string;
  industry_name?: string;
  last_mentioned?: string;
  active_from?: string;
  active_mentions: number;
  mention_count: number;
}

export interface StockPrice {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  amount?: number;
}

export interface StockIndexPoint {
  datetime: string;
  value: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
}
