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
