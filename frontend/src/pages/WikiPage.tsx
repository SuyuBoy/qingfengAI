import { type ComponentProps, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CalendarDays,
  CheckCircle2,
  Database,
  Eye,
  FileText,
  Hourglass,
  ListRestart,
  LoaderCircle,
  Play,
  RefreshCw,
  RotateCw,
  Trash2,
  XCircle,
} from "lucide-react";
import { api } from "../api";
import { Calendar, CalendarDayButton } from "../components/ui/calendar";
import { formatBeijingDateTime } from "../lib/time";
import { renderMarkdown } from "../markdown";
import type { CurrentUser } from "../types";

type WikiSection = "documents" | "daily" | "sources" | "events" | "entities" | "sectors" | "jobs";
type DocType = "" | "root" | "market" | "rolling" | "weekly" | "sector" | "stock" | "method" | "sectors" | "stocks" | "methods";

interface WikiCategory {
  key: string;
  label: string;
  section: WikiSection;
  docType?: DocType;
  docTypeAliases?: DocType[];
}

interface WikiJob {
  job_id: string;
  job_type: string;
  status: string;
  processed?: number;
  total?: number;
  failed?: number;
  cursor?: string;
  error?: string;
  phase?: string;
  current_date?: string;
  current_dynamic_id?: string;
  finalized_dates?: string[];
  progress?: {
    total?: number;
    processed?: number;
    percent?: number;
    current_date?: string;
    phase?: string;
    finalized_count?: number;
  };
  result?: unknown;
  updated_at?: string;
  created_at?: string;
}

interface WikiOverview {
  section: WikiSection;
  doc_type?: string;
  counts: Record<string, number>;
  items: Record<string, any>[];
}

interface DynamicDateStats {
  dates: Array<{ date: string; count: number }>;
  counts?: Record<string, number>;
}

const SECTION_LABELS: Record<WikiSection, string> = {
  documents: "文档",
  daily: "每日",
  sources: "动态",
  events: "事件",
  entities: "实体",
  sectors: "板块",
  jobs: "任务",
};

const WIKI_LIST_MIN_WIDTH = 280;
const WIKI_DETAIL_MIN_WIDTH = 360;
const WIKI_PANEL_RESIZER_WIDTH = 9;

const WIKI_TREE_CATEGORIES: WikiCategory[] = [
  { key: "root", label: "根目录", section: "documents", docType: "root" },
  { key: "daily", label: "每日", section: "daily" },
  { key: "market", label: "大盘", section: "documents", docType: "market" },
  { key: "rolling", label: "滚动", section: "documents", docType: "rolling" },
  { key: "weekly", label: "周报", section: "documents", docType: "weekly" },
  { key: "sector", label: "板块", section: "documents", docType: "sector", docTypeAliases: ["sectors"] },
  { key: "stock", label: "个股", section: "documents", docType: "stock", docTypeAliases: ["stocks"] },
  { key: "method", label: "方法", section: "documents", docType: "method", docTypeAliases: ["methods"] },
];

const WIKI_INDEX_CATEGORIES: WikiCategory[] = [
  { key: "sources", label: "动态", section: "sources" },
  { key: "events", label: "事件", section: "events" },
  { key: "entities", label: "实体", section: "entities" },
  { key: "sector-catalog", label: "板块目录", section: "sectors" },
  { key: "jobs", label: "任务", section: "jobs" },
];

const FIELD_LABELS: Record<string, string> = {
  board_type: "板块类型",
  category: "分类",
  code: "代码",
  content: "内容",
  content_json: "结构化内容",
  created_at: "创建时间",
  cursor: "游标",
  daily_overview: "每日概览",
  daily_summary: "每日总结",
  date: "日期",
  description: "说明",
  doc_id: "文档 ID",
  doc_type: "文档类型",
  dynamic_id: "动态 ID",
  entity_id: "实体 ID",
  error: "错误",
  event_id: "事件 ID",
  failed: "失败数",
  finalized_dates: "已总结日期",
  fetched_at: "抓取时间",
  finalized: "已定稿",
  job_id: "任务 ID",
  job_type: "任务类型",
  latest_date: "最新日期",
  long_term_updates: "长期更新",
  name: "名称",
  path: "路径",
  phase: "阶段",
  progress: "进度",
  processed: "处理数",
  result: "结果",
  sector_id: "板块 ID",
  source: "来源",
  status: "状态",
  stance: "倾向",
  summary: "摘要",
  target: "目标",
  time: "时间",
  title: "标题",
  type: "类型",
  update_type: "更新类型",
  updated_at: "更新时间",
  value: "数值",
  total: "总数",
  current_date: "当前日期",
  current_dynamic_id: "当前动态",
  weekly_overview: "周度概览",
  weekly_summary: "周度总结",
  market_review: "大盘复盘",
  sector_review: "板块复盘",
  stock_review: "个股复盘",
  view_changes: "观点变化",
  next_week_watch: "下周关注",
  week_view: "本周观点",
  change_from_last_week: "较上周变化",
  week_trend: "本周走势",
  sentiment_path: "情绪路径",
  position_advice: "仓位建议",
  key_levels: "关键点位",
  catalyst: "催化",
  risk: "风险",
  focus: "关注点",
  reason: "理由",
  trigger: "触发原因",
  change: "变化",
  from: "起点",
  to: "终点",
  finalized_weeks: "已总结周",
};

const PRIMARY_FIELDS: Record<WikiSection, string[]> = {
  documents: ["summary", "content", "content_json", "result", "error"],
  daily: ["daily_summary", "daily_overview", "long_term_updates", "summary", "result", "error"],
  sources: ["summary", "content", "value", "result", "error"],
  events: ["summary", "result", "error"],
  entities: ["summary", "content_json", "result", "error"],
  sectors: ["summary", "content_json", "result", "error"],
  jobs: ["progress", "result", "error"],
};

const META_FIELDS = new Set([
  "board_type",
  "category",
  "code",
  "created_at",
  "date",
  "doc_id",
  "doc_type",
  "dynamic_id",
  "entity_id",
  "event_id",
  "failed",
  "fetched_at",
  "finalized",
  "job_id",
  "job_type",
  "latest_date",
  "name",
  "path",
  "processed",
  "sector_id",
  "status",
  "stance",
  "time",
  "title",
  "type",
  "updated_at",
]);

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDate(value: string) {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function defaultEndDate() {
  return formatDate(new Date());
}

function defaultStartDate() {
  const date = new Date();
  date.setDate(date.getDate() - 6);
  return formatDate(date);
}

function itemKey(item: Record<string, any>, index: number) {
  const id = item.doc_id || item.date || item.dynamic_id || item.event_id || item.entity_id || item.sector_id || item.job_id || "item";
  return `${id}:${index}`;
}

function itemTitle(item: Record<string, any>, section: WikiSection) {
  if (section === "documents") return item.title || `${item.doc_type}/${item.doc_id}`;
  if (section === "daily") return item.date || "未命名日期";
  if (section === "sources") return `${item.date || ""} ${item.title || item.dynamic_id || ""}`.trim();
  if (section === "events") return item.summary || item.event_id || "事件";
  if (section === "entities") return item.name || item.entity_id || "实体";
  if (section === "sectors") return item.name || item.sector_id || "板块";
  return item.job_id || "任务";
}

function isTimeField(key: string) {
  return key === "time"
    || key === "fetched_at"
    || key.endsWith("_at")
    || key.endsWith("_time")
    || key.endsWith("_until");
}

function formatMetaValue(key: string, value: unknown) {
  if (isEmptyValue(value)) return "";
  if (isTimeField(key) && (typeof value === "string" || typeof value === "number")) {
    return formatBeijingDateTime(value);
  }
  return formatScalar(value);
}

function itemMeta(item: Record<string, any>, section: WikiSection) {
  if (section === "documents") return [item.path || item.doc_type, item.status, formatMetaValue("updated_at", item.updated_at)].filter(Boolean).join(" / ");
  if (section === "daily") return [item.finalized ? "finalized" : "pending", formatMetaValue("updated_at", item.updated_at)].filter(Boolean).join(" / ");
  if (section === "sources") return [item.dynamic_id, item.value, formatMetaValue("time", item.time)].filter(Boolean).join(" / ");
  if (section === "events") return [item.category, item.stance, item.dynamic_id].filter(Boolean).join(" / ");
  if (section === "entities") return [item.type, item.status, item.latest_date].filter(Boolean).join(" / ");
  if (section === "sectors") return [item.board_type, item.code, formatMetaValue("fetched_at", item.fetched_at)].filter(Boolean).join(" / ");
  const progress = jobProgress(item);
  return [item.job_type, item.status, item.phase, `${progress.processed}/${progress.total}`, formatMetaValue("updated_at", item.updated_at)].filter(Boolean).join(" / ");
}

function compactSummary(item: Record<string, any>, section: WikiSection) {
  const content = parsedRecord(item.content_json);
  const contentSummary = content?.current || content?.current_status || content?.overview;
  const summary = isJsonLikeText(item.summary) ? "" : item.summary;
  const value = contentSummary || summary || item.daily_summary || item.error || item.result || "";
  if (typeof value === "string") return value.slice(0, 180);
  return JSON.stringify(value).slice(0, 180);
}

function fieldLabel(key: string) {
  return FIELD_LABELS[key] || key.replace(/_/g, " ");
}

function isEmptyValue(value: unknown) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatScalar(value: unknown, key = "") {
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return key && isTimeField(key) ? formatBeijingDateTime(value) : value.trim();
  return String(value);
}

function markdownHeading(level: number, title: string) {
  return `${"#".repeat(Math.min(Math.max(level, 2), 4))} ${title}`;
}

function markdownObject(value: Record<string, unknown>, level: number): string {
  const lines: string[] = [];
  for (const [key, entry] of Object.entries(value)) {
    if (isEmptyValue(entry)) continue;
    const label = fieldLabel(key);
    if (isRecord(entry) || Array.isArray(entry)) {
      lines.push(markdownHeading(level, label), "", markdownValue(entry, level + 1));
      continue;
    }
    const text = formatScalar(entry, key);
    if (text.length > 120 || text.includes("\n")) {
      lines.push(markdownHeading(level, label), "", text);
    } else {
      lines.push(`- **${label}**：${text}`);
    }
  }
  return lines.join("\n");
}

function markdownValue(value: unknown, level = 2): string {
  if (isEmptyValue(value)) return "暂无内容";
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      if (isRecord(entry)) {
        return `${markdownHeading(level, `条目 ${index + 1}`)}\n\n${markdownObject(entry, level + 1)}`;
      }
      if (Array.isArray(entry)) {
        return `${markdownHeading(level, `条目 ${index + 1}`)}\n\n${markdownValue(entry, level + 1)}`;
      }
      return `- ${formatScalar(entry)}`;
    }).join("\n\n");
  }
  if (isRecord(value)) return markdownObject(value, level);
  return formatScalar(value);
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text || !["{", "["].includes(text[0])) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function parsedRecord(value: unknown): Record<string, unknown> | null {
  const parsed = parseJsonValue(value);
  return isRecord(parsed) ? parsed : null;
}

function isJsonLikeText(value: unknown) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  return Boolean(text) && ["{", "["].includes(text[0]);
}

function markdownCell(value: unknown, key = ""): string {
  value = parseJsonValue(value);
  if (isEmptyValue(value)) return "原文未说明";
  if (Array.isArray(value)) {
    const text = value.map(entry => {
      if (isRecord(entry)) return Object.entries(entry).filter(([, v]) => !isEmptyValue(v)).map(([entryKey, entryValue]) => formatScalar(entryValue, entryKey)).join(" / ");
      return formatScalar(entry, key);
    }).filter(Boolean).join("、");
    return markdownCell(text);
  }
  if (isRecord(value)) {
    const text = Object.entries(value)
      .filter(([, entry]) => !isEmptyValue(entry))
      .map(([entryKey, entry]) => `${fieldLabel(entryKey)}：${formatScalarValue(entry, entryKey)}`)
      .join("；");
    return markdownCell(text);
  }
  return formatScalar(value, key).replace(/\|/g, "｜").replace(/\r?\n/g, "；");
}

function formatScalarValue(value: unknown, key = ""): string {
  value = parseJsonValue(value);
  if (isEmptyValue(value)) return "";
  if (Array.isArray(value)) return value.map(entry => formatScalarValue(entry, key)).filter(Boolean).join("、");
  if (isRecord(value)) {
    return Object.entries(value)
      .filter(([, entry]) => !isEmptyValue(entry))
      .map(([entryKey, entry]) => `${fieldLabel(entryKey)}：${formatScalarValue(entry, entryKey)}`)
      .join("；");
  }
  return formatScalar(value, key);
}

function sectionHeading(lines: string[], title: string) {
  lines.push("", `## ${title}`);
}

function addParagraph(lines: string[], title: string, value: unknown) {
  if (isEmptyValue(value)) return;
  sectionHeading(lines, title);
  lines.push("", markdownCell(value));
}

function addKeyValueTable(lines: string[], title: string, value: unknown, label = "维度") {
  if (!isRecord(value)) {
    addParagraph(lines, title, value);
    return;
  }
  const rows = Object.entries(value).filter(([, entry]) => !isEmptyValue(entry));
  if (!rows.length) return;
  sectionHeading(lines, title);
  lines.push("", `| ${label} | 内容 |`, "| --- | --- |");
  for (const [key, entry] of rows) {
    lines.push(`| ${markdownCell(fieldLabel(key))} | ${markdownCell(entry)} |`);
  }
}

function addRecordsTable(
  lines: string[],
  title: string,
  value: unknown,
  columns: Array<[string, string]>,
) {
  const rows = Array.isArray(value) ? value.filter(isRecord) : [];
  if (!rows.length) return;
  sectionHeading(lines, title);
  lines.push("", `| ${columns.map(([, label]) => markdownCell(label)).join(" | ")} |`);
  lines.push(`| ${columns.map(() => "---").join(" | ")} |`);
  for (const row of rows) {
    lines.push(`| ${columns.map(([key]) => markdownCell(row[key])).join(" | ")} |`);
  }
}

function addStringList(lines: string[], title: string, value: unknown) {
  value = parseJsonValue(value);
  if (!Array.isArray(value) || !value.length) return;
  const entries = value.filter(entry => !isEmptyValue(entry));
  if (!entries.length) return;
  sectionHeading(lines, title);
  for (const entry of entries) {
    lines.push(`- ${markdownCell(entry)}`);
  }
}

function addFlexibleSection(
  lines: string[],
  title: string,
  value: unknown,
  columns?: Array<[string, string]>,
) {
  value = parseJsonValue(value);
  if (isEmptyValue(value)) return;
  if (Array.isArray(value)) {
    if (value.some(isRecord) && columns?.length) {
      addRecordsTable(lines, title, value, columns);
      return;
    }
    addStringList(lines, title, value);
    return;
  }
  if (isRecord(value)) {
    addKeyValueTable(lines, title, value);
    return;
  }
  addParagraph(lines, title, value);
}

function documentPath(item: Record<string, any>) {
  if (item.path) return item.path;
  const docType = normalizedDocType(item.doc_type);
  const docId = item.doc_id || "";
  if (docType === "sector") return `sectors/${docId}.md`;
  if (docType === "stock") return `stocks/${docId}.md`;
  if (docType === "method") return `methods/${docId}.md`;
  if (docType === "market") return `market/${docId}.md`;
  if (docType === "rolling") return `rolling/${docId}.md`;
  if (docType === "weekly") return `weekly/${docId}.md`;
  return docId ? `${docId}.md` : "";
}

function documentMetaMarkdown(item: Record<string, any>) {
  const rows = [
    ["路径", documentPath(item)],
    ["状态", item.status],
    ["更新时间", item.updated_at],
    ["日期范围", item.date_range],
    ["来源动态", item.source_dynamic_ids],
  ].filter(([, value]) => !isEmptyValue(value));
  if (!rows.length) return "";
  return rows.map(([label, value]) => `> **${label}**：${markdownCell(value)}`).join("\n");
}

function documentMarkdown(item: Record<string, any>) {
  const docType = normalizedDocType(item.doc_type);
  const content = parsedRecord(item.content_json) || parsedRecord(item.summary);
  const lines: string[] = [`# ${itemTitle(item, "documents")}`];
  const meta = documentMetaMarkdown(item);
  if (meta) lines.push("", meta);
  if (item.summary && !isJsonLikeText(item.summary)) addParagraph(lines, "摘要", item.summary);

  if (!content) {
    const fallback = item.content || item.result || item.error;
    if (!isEmptyValue(fallback)) lines.push("", markdownValue(fallback, 2));
    return lines.join("\n");
  }

  if (docType === "market") {
    addFlexibleSection(lines, "当前状态", content.current || content.current_status || content.overview);
    addFlexibleSection(lines, "时间线", content.timeline, [
      ["date", "日期"],
      ["judgment", "判断"],
      ["change_type", "变化类型"],
      ["reason", "关键理由"],
      ["source", "来源"],
    ]);
    addFlexibleSection(lines, "情绪与操作节奏", content.sentiment, [
      ["date", "日期"],
      ["stage", "情绪阶段"],
      ["style", "风格"],
      ["action", "操作建议"],
      ["source", "来源"],
    ]);
    addKeyValueTable(lines, "其他内容", Object.fromEntries(Object.entries(content).filter(([key]) => !["current", "timeline", "sentiment"].includes(key))));
    return lines.join("\n");
  }

  if (docType === "weekly") {
    addParagraph(lines, "周度总结", content.weekly_summary);
    addKeyValueTable(lines, "周度概览", content.weekly_overview);
    addFlexibleSection(lines, "大盘复盘", content.market_review, [
      ["week_trend", "本周走势"],
      ["sentiment_path", "情绪路径"],
      ["position_advice", "仓位建议"],
      ["key_levels", "关键点位"],
      ["source", "来源"],
    ]);
    addRecordsTable(lines, "板块复盘", content.sector_review, [
      ["name", "板块"],
      ["status", "状态"],
      ["week_view", "本周观点"],
      ["change_from_last_week", "较上周变化"],
      ["catalyst", "催化"],
      ["risk", "风险"],
      ["source", "来源"],
    ]);
    addRecordsTable(lines, "个股复盘", content.stock_review, [
      ["name", "个股"],
      ["code", "代码"],
      ["status", "状态"],
      ["week_view", "本周观点"],
      ["change", "变化"],
      ["source", "来源"],
    ]);
    addRecordsTable(lines, "观点变化", content.view_changes, [
      ["from", "起点"],
      ["to", "终点"],
      ["trigger", "触发原因"],
      ["source", "来源"],
    ]);
    addRecordsTable(lines, "下周关注", content.next_week_watch, [
      ["focus", "关注点"],
      ["reason", "理由"],
      ["source", "来源"],
    ]);
    addKeyValueTable(lines, "其他内容", Object.fromEntries(Object.entries(content).filter(([key]) => !["weekly_summary", "weekly_overview", "market_review", "sector_review", "stock_review", "view_changes", "next_week_watch"].includes(key))));
    return lines.join("\n");
  }

  if (docType === "rolling") {
    addFlexibleSection(lines, "核心结论", content.core_conclusions, [
      ["theme", "主题"],
      ["current_judgment", "当前判断"],
      ["change", "变化方向"],
      ["source", "证据动态"],
    ]);
    addFlexibleSection(lines, "市场主线", content.market_themes, [
      ["theme", "主线"],
      ["strength", "强度"],
      ["catalyst", "催化"],
      ["risk", "风险"],
      ["stance", "清风态度"],
      ["source", "来源"],
    ]);
    addFlexibleSection(lines, "大盘与情绪", content.market_sentiment, [
      ["date", "日期"],
      ["market_status", "大盘状态"],
      ["sentiment", "情绪状态"],
      ["style", "量能/风格"],
      ["position", "仓位建议"],
      ["source", "来源"],
    ]);
    addFlexibleSection(lines, "观点变化", content.view_changes, [
      ["from", "起点"],
      ["to", "终点"],
      ["change", "变化"],
      ["trigger", "触发原因"],
      ["source", "来源"],
    ]);
    addKeyValueTable(lines, "其他内容", Object.fromEntries(Object.entries(content).filter(([key]) => !["core_conclusions", "market_themes", "market_sentiment", "view_changes"].includes(key))));
    return lines.join("\n");
  }

  if (docType === "sector") {
    addKeyValueTable(lines, "当前结论", content.current);
    addRecordsTable(lines, "事件线", content.events, [
      ["date", "日期"],
      ["event", "事件/催化"],
      ["view", "清风观点"],
      ["impact", "影响"],
      ["stocks", "相关个股"],
      ["source", "来源"],
    ]);
    addRecordsTable(lines, "阶段总结", content.stage_summaries, [
      ["period", "时间段"],
      ["mainline_change", "主线变化"],
      ["view_change", "观点变化"],
      ["conclusion", "结论"],
    ]);
    addStringList(lines, "别名", content.aliases);
    addKeyValueTable(lines, "其他内容", Object.fromEntries(Object.entries(content).filter(([key]) => !["current", "events", "stage_summaries", "aliases"].includes(key))));
    return lines.join("\n");
  }

  if (docType === "stock") {
    addKeyValueTable(lines, "当前结论", content.current);
    addStringList(lines, "所属板块", content.sectors);
    addRecordsTable(lines, "提及时间线", content.mentions, [
      ["date", "日期"],
      ["scene", "场景"],
      ["view", "观点"],
      ["sectors", "相关板块"],
      ["source", "来源"],
    ]);
    addKeyValueTable(lines, "其他内容", Object.fromEntries(Object.entries(content).filter(([key]) => !["current", "sectors", "mentions"].includes(key))));
    return lines.join("\n");
  }

  if (docType === "method") {
    addFlexibleSection(lines, "稳定原则", content.principles, [
      ["principle", "原则"],
      ["description", "说明"],
      ["source", "来源"],
    ]);
    addFlexibleSection(lines, "新增/修正记录", content.updates, [
      ["date", "日期"],
      ["new_view", "新观点"],
      ["relation", "与旧观点关系"],
      ["source", "来源"],
    ]);
    addKeyValueTable(lines, "其他内容", Object.fromEntries(Object.entries(content).filter(([key]) => !["principles", "updates"].includes(key))));
    return lines.join("\n");
  }

  lines.push("", markdownValue(content, 2));
  return lines.join("\n");
}

function dailyMarkdown(item: Record<string, any>) {
  const lines: string[] = [`# ${itemTitle(item, "daily")}`];
  const meta = itemMeta(item, "daily");
  if (meta) lines.push("", `- **信息**：${meta}`);
  addParagraph(lines, "日终总结", item.daily_summary);
  addKeyValueTable(lines, "每日概览", item.daily_overview);
  addRecordsTable(lines, "长期 Wiki 更新", item.long_term_updates, [
    ["target", "目标"],
    ["update_type", "更新类型"],
    ["summary", "摘要"],
    ["source", "来源"],
  ]);
  addStringList(lines, "来源动态", item.source_dynamic_ids);
  return lines.join("\n");
}

function recordMarkdown(item: Record<string, any>, section: WikiSection) {
  if (section === "documents") return documentMarkdown(item);
  if (section === "daily") return dailyMarkdown(item);

  const meta = itemMeta(item, section);
  const orderedKeys = [
    ...PRIMARY_FIELDS[section],
    ...Object.keys(item).filter(key => !PRIMARY_FIELDS[section].includes(key) && !META_FIELDS.has(key)),
  ];
  const seen = new Set<string>();
  const lines: string[] = [`# ${itemTitle(item, section)}`];

  if (meta) lines.push("", `- **信息**：${meta}`);

  for (const key of orderedKeys) {
    if (seen.has(key) || isEmptyValue(item[key])) continue;
    seen.add(key);
    lines.push("", markdownHeading(2, fieldLabel(key)), "", markdownValue(item[key], 3));
  }

  if (lines.length <= 3) {
    const fallbackKeys = Object.keys(item).filter(key => !META_FIELDS.has(key) && !isEmptyValue(item[key]));
    for (const key of fallbackKeys) {
      if (seen.has(key)) continue;
      lines.push("", markdownHeading(2, fieldLabel(key)), "", markdownValue(item[key], 3));
    }
  }

  return lines.join("\n");
}

type JobDisplayStatus = "success" | "failed" | "pending" | "running";

function jobDisplayStatus(item: Record<string, any>): JobDisplayStatus {
  const status = String(item.status || "").toLowerCase();
  if (["success", "succeeded", "complete", "completed", "done", "finished", "finalized"].includes(status)) return "success";
  if (["failed", "failure", "error", "errored", "cancelled", "canceled", "timeout"].includes(status)) return "failed";
  if (["pending", "waiting", "queued", "ready", "idle"].includes(status)) return "pending";
  return "running";
}

function jobStatusLabel(item: Record<string, any>) {
  const status = jobDisplayStatus(item);
  if (status === "success") return "成功";
  if (status === "failed") return "失败";
  if (status === "pending") return "等待推进";
  return "正在运行";
}

function JobStatusIcon({ item, size = 16 }: { item: Record<string, any>; size?: number }) {
  const status = jobDisplayStatus(item);
  if (status === "success") return <CheckCircle2 className="wiki-job-status success" size={size} aria-label="成功" />;
  if (status === "failed") return <XCircle className="wiki-job-status failed" size={size} aria-label="失败" />;
  if (status === "pending") return <Hourglass className="wiki-job-status pending" size={size} aria-label="等待推进" />;
  return <LoaderCircle className="wiki-job-status running wiki-running-icon" size={size} aria-label="正在运行" />;
}

function jobProgress(item: Record<string, any>) {
  const progress = isRecord(item.progress) ? item.progress : {};
  const total = Math.max(0, Number(progress.total ?? item.total ?? 0) || 0);
  const rawProcessed = Math.max(0, Number(progress.processed ?? item.processed ?? 0) || 0);
  const processed = total > 0 ? Math.min(total, rawProcessed) : rawProcessed;
  const rawPercent = Number(progress.percent ?? (total > 0 ? processed * 100 / total : 0));
  const percent = Math.max(0, Math.min(100, Number.isFinite(rawPercent) ? rawPercent : 0));
  const finalizedCount = Number(progress.finalized_count ?? (Array.isArray(item.finalized_dates) ? item.finalized_dates.length : 0)) || 0;
  return {
    total,
    processed,
    percent,
    finalizedCount,
    phase: String(progress.phase ?? item.phase ?? item.status ?? ""),
    currentDate: String(progress.current_date ?? item.current_date ?? ""),
  };
}

function JobProgress({ item, compact = false }: { item: Record<string, any>; compact?: boolean }) {
  const progress = jobProgress(item);
  const status = jobDisplayStatus(item);
  const percentLabel = `${Math.round(progress.percent)}%`;
  const detail = [
    progress.total ? `${progress.processed}/${progress.total}` : "",
    progress.currentDate,
    progress.phase,
    progress.finalizedCount ? `已总结 ${progress.finalizedCount} 天` : "",
  ].filter(Boolean).join(" / ");
  return (
    <div className={`wiki-progress${compact ? " compact" : ""}${status === "failed" ? " failed" : ""}`}>
      {!compact && (
        <div className="wiki-progress-head">
          <span>{detail || "等待任务进度"}</span>
          <strong>{percentLabel}</strong>
        </div>
      )}
      <div className="wiki-progress-track" aria-label={`任务进度 ${percentLabel}`}>
        <span style={{ width: `${progress.percent}%` }} />
      </div>
      {compact && <small>{percentLabel}</small>}
    </div>
  );
}

function nearestPreviousDate(dates: string[], target: string) {
  for (let index = dates.length - 1; index >= 0; index -= 1) {
    if (dates[index] <= target) return dates[index];
  }
  return dates[dates.length - 1] || target;
}

function nearestNextDate(dates: string[], target: string, maxDate: string) {
  const next = dates.find(date => date >= target && date <= maxDate);
  return next || maxDate;
}

function normalizedDocType(value: unknown): DocType {
  if (value === null || value === undefined) return "";
  const docType = String(value);
  if (!docType) return "";
  if (docType === "sectors") return "sector";
  if (docType === "stocks") return "stock";
  if (docType === "methods") return "method";
  if (["root", "market", "rolling", "weekly", "sector", "stock", "method"].includes(docType)) return docType as DocType;
  return "";
}

type CalendarField = "start" | "end";
type WikiCalendarDayButtonProps = ComponentProps<typeof CalendarDayButton>;

export default function WikiPage({ user }: { user: CurrentUser }) {
  const isAdmin = user.is_admin === true || user.role === "admin";
  const [section, setSection] = useState<WikiSection>("daily");
  const [docType, setDocType] = useState<DocType>("");
  const [overview, setOverview] = useState<WikiOverview | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [batchSize, setBatchSize] = useState(20);
  const [dynamicDateCounts, setDynamicDateCounts] = useState<Record<string, number>>({});
  const [documentCounts, setDocumentCounts] = useState<Record<string, number>>({});
  const [documentTypeCounts, setDocumentTypeCounts] = useState<Record<string, number>>({});
  const [dateStatsLoading, setDateStatsLoading] = useState(false);
  const [openCalendar, setOpenCalendar] = useState<CalendarField | "">("");
  const [jobId, setJobId] = useState("");
  const [activeJob, setActiveJob] = useState<WikiJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [rawOpen, setRawOpen] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [wikiListWidth, setWikiListWidth] = useState(42);
  const [resizingPanels, setResizingPanels] = useState(false);
  const overviewRequestRef = useRef(0);
  const advancingRef = useRef(false);
  const autoAdvanceRef = useRef(true);
  const wikiMainRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const resizingPanelsRef = useRef(false);
  const startTriggerRef = useRef<HTMLButtonElement | null>(null);
  const endTriggerRef = useRef<HTMLButtonElement | null>(null);
  const calendarPanelRef = useRef<HTMLDivElement | null>(null);
  const [calendarStyle, setCalendarStyle] = useState<CSSProperties>({});

  const overviewMatchesSelection = overview?.section === section && (section !== "documents" || normalizedDocType(overview.doc_type || "") === normalizedDocType(docType));
  const items = overviewMatchesSelection ? overview.items : [];
  const activeCategory = useMemo(() => {
    return [...WIKI_TREE_CATEGORIES, ...WIKI_INDEX_CATEGORIES].find(category => (
      category.section === section && (
        category.section !== "documents"
        || normalizedDocType(category.docType || "") === normalizedDocType(docType)
      )
    ));
  }, [docType, section]);
  const activeCategoryLabel = activeCategory?.label || SECTION_LABELS[section];
  const mergeJob = useCallback((job: WikiJob) => {
    setActiveJob(job);
    setOverview(prev => {
      if (!prev || prev.section !== "jobs") return prev;
      const items = [...prev.items];
      const index = items.findIndex(item => item.job_id === job.job_id);
      if (index >= 0) {
        items[index] = { ...items[index], ...job };
      } else {
        items.unshift(job as unknown as Record<string, any>);
      }
      return { ...prev, items };
    });
  }, []);
  const availableDates = useMemo(() => {
    return Object.entries(dynamicDateCounts)
      .filter(([, count]) => count > 0)
      .map(([date]) => date)
      .sort();
  }, [dynamicDateCounts]);
  const selected = useMemo(() => {
    return items.find((item, index) => itemKey(item, index) === selectedKey) || items[0] || null;
  }, [items, selectedKey]);
  const selectedMarkdown = useMemo(() => selected ? recordMarkdown(selected, section) : "", [section, selected]);
  const selectedHtml = useMemo(() => renderMarkdown(selectedMarkdown), [selectedMarkdown]);
  const selectedRaw = useMemo(() => selected ? JSON.stringify(selected, null, 2) : "", [selected]);
  const isAdvancingJob = useCallback((item: Record<string, any> | null) => {
    if (section !== "jobs" || !item) return false;
    if (jobDisplayStatus(item) === "running") return true;
    return busy === "推进任务" && Boolean(item.job_id) && item.job_id === jobId.trim();
  }, [busy, jobId, section]);
  const batchForRange = useCallback((nextStartDate: string, nextEndDate: string) => {
    const from = nextStartDate <= nextEndDate ? nextStartDate : nextEndDate;
    const to = nextStartDate <= nextEndDate ? nextEndDate : nextStartDate;
    const total = availableDates.reduce((sum, date) => {
      if (date < from || date > to) return sum;
      return sum + (dynamicDateCounts[date] || 0);
    }, 0);
    return Math.max(1, Math.min(total || 1, 100));
  }, [availableDates, dynamicDateCounts]);
  const categoryCount = useCallback((category: WikiCategory) => {
    if (category.section === "documents") {
      const key = normalizedDocType(category.docType || "");
      return key ? documentCounts[key] ?? 0 : overview?.counts?.documents ?? 0;
    }
    return overview?.counts?.[category.section] ?? 0;
  }, [documentCounts, overview]);
  const categoryDocType = useCallback((category: WikiCategory) => {
    const docTypes = [category.docType, ...(category.docTypeAliases || [])].filter(Boolean) as DocType[];
    return docTypes.find(key => documentTypeCounts[key]) || category.docType || "";
  }, [documentTypeCounts]);
  const selectCategory = useCallback((category: WikiCategory) => {
    setSection(category.section);
    setDocType(category.section === "documents" ? categoryDocType(category) : "");
  }, [categoryDocType]);

  const updateWikiListWidth = useCallback((nextListWidth: number) => {
    const main = wikiMainRef.current;
    if (!main) return;
    const { width } = main.getBoundingClientRect();
    const maxListWidth = Math.max(WIKI_LIST_MIN_WIDTH, width - WIKI_DETAIL_MIN_WIDTH - WIKI_PANEL_RESIZER_WIDTH);
    const clampedWidth = Math.min(Math.max(nextListWidth, WIKI_LIST_MIN_WIDTH), maxListWidth);
    setWikiListWidth(clampedWidth * 100 / width);
  }, []);

  const updateWikiListWidthFromPointer = useCallback((clientX: number) => {
    const main = wikiMainRef.current;
    if (!main) return;
    const { left } = main.getBoundingClientRect();
    updateWikiListWidth(clientX - left);
  }, [updateWikiListWidth]);

  const startPanelResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizingPanelsRef.current = true;
    setResizingPanels(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    updateWikiListWidthFromPointer(event.clientX);
  }, [updateWikiListWidthFromPointer]);

  const resizePanels = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizingPanelsRef.current) return;
    event.preventDefault();
    updateWikiListWidthFromPointer(event.clientX);
  }, [updateWikiListWidthFromPointer]);

  const stopPanelResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizingPanelsRef.current) return;
    resizingPanelsRef.current = false;
    setResizingPanels(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const adjustPanelResize = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const main = wikiMainRef.current;
    if (!main) return;
    event.preventDefault();
    const { width } = main.getBoundingClientRect();
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    updateWikiListWidth(width * wikiListWidth / 100 + direction * 24);
  }, [updateWikiListWidth, wikiListWidth]);

  const loadOverview = useCallback(async () => {
    if (!isAdmin) return;
    const requestId = overviewRequestRef.current + 1;
    overviewRequestRef.current = requestId;
    const requestSection = section;
    const requestDocType = docType;
    setLoading(true);
    setError("");
    setSelectedKey("");
    listRef.current?.scrollTo({ top: 0 });
    try {
      const data = await api.get<WikiOverview>("/api/admin/wiki", { section: requestSection, doc_type: requestDocType, limit: 200 });
      if (overviewRequestRef.current !== requestId) return;
      setOverview(data || null);
    } catch (e) {
      if (overviewRequestRef.current !== requestId) return;
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      if (overviewRequestRef.current !== requestId) return;
      setLoading(false);
    }
  }, [docType, isAdmin, section]);

  const loadDocumentCounts = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const data = await api.get<WikiOverview>("/api/admin/wiki", { section: "documents", doc_type: "", limit: 500 });
      const counts: Record<string, number> = {};
      const rawCounts: Record<string, number> = {};
      for (const item of data?.items || []) {
        const rawKey = String(item.doc_type || "root");
        const key = normalizedDocType(rawKey);
        if (!key) continue;
        rawCounts[rawKey] = (rawCounts[rawKey] || 0) + 1;
        counts[key] = (counts[key] || 0) + 1;
      }
      setDocumentTypeCounts(rawCounts);
      setDocumentCounts(counts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "文档层级统计加载失败");
    }
  }, [isAdmin]);

  const loadDynamicDateStats = useCallback(async () => {
    if (!isAdmin) return;
    setDateStatsLoading(true);
    try {
      const data = await api.get<DynamicDateStats>("/api/admin/wiki/dynamic-dates");
      const counts = data?.counts || Object.fromEntries((data?.dates || []).map(item => [item.date, item.count]));
      setDynamicDateCounts(counts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "动态日期加载失败");
    } finally {
      setDateStatsLoading(false);
    }
  }, [isAdmin]);

  const updateCalendarPosition = useCallback(() => {
    if (!openCalendar) return;
    const trigger = openCalendar === "start" ? startTriggerRef.current : endTriggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const panelWidth = Math.min(306, window.innerWidth - 16);
    const panelHeight = calendarPanelRef.current?.offsetHeight || 0;
    const gap = 8;
    const left = Math.min(Math.max(gap, rect.left), window.innerWidth - panelWidth - gap);
    let top = rect.bottom + gap;

    if (panelHeight && top + panelHeight > window.innerHeight - gap && rect.top > panelHeight + gap) {
      top = rect.top - panelHeight - gap;
    }

    setCalendarStyle({ left, top, width: panelWidth });
  }, [openCalendar]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    loadDocumentCounts();
  }, [loadDocumentCounts]);

  useEffect(() => {
    if (section !== "documents" || !activeCategory) return;
    const nextDocType = categoryDocType(activeCategory);
    if (nextDocType && nextDocType !== docType && normalizedDocType(nextDocType) === normalizedDocType(docType)) {
      setDocType(nextDocType);
    }
  }, [activeCategory, categoryDocType, docType, section]);

  useEffect(() => {
    loadDynamicDateStats();
  }, [loadDynamicDateStats]);

  useEffect(() => {
    autoAdvanceRef.current = autoAdvance;
  }, [autoAdvance]);

  // 自动推进一批：复用轮询节奏，pending 即触发下一批，直到 done/failed。
  // advancingRef 防止重叠（单批耗时通常远大于 3s 轮询间隔）。
  const advanceJobBatch = useCallback(async (targetJobId: string) => {
    if (advancingRef.current || !targetJobId) return;
    advancingRef.current = true;
    try {
      const data = await api.post<{ job: WikiJob }>(`/api/admin/wiki/jobs/${encodeURIComponent(targetJobId)}/run`);
      if (data?.job?.job_id) mergeJob(data.job);
    } catch (e) {
      setError(e instanceof Error ? e.message : "自动推进失败");
      setAutoAdvance(false); // 出错即停，避免持续重试打满
    } finally {
      advancingRef.current = false;
    }
  }, [mergeJob]);

  useEffect(() => {
    if (!isAdmin || !jobId.trim()) return;
    let stopped = false;
    const encodedJobId = encodeURIComponent(jobId.trim());
    const pollJob = async () => {
      try {
        const data = await api.get<{ job: WikiJob }>(`/api/admin/wiki/jobs/${encodedJobId}`);
        if (stopped || !data?.job?.job_id) return;
        mergeJob(data.job);
        if (
          autoAdvanceRef.current
          && !advancingRef.current
          && jobDisplayStatus(data.job as unknown as Record<string, any>) === "pending"
        ) {
          void advanceJobBatch(String(data.job.job_id));
        }
      } catch (e) {
        if (!stopped) setError(e instanceof Error ? e.message : "任务状态刷新失败");
      }
    };
    pollJob();
    const timer = window.setInterval(pollJob, 3000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [isAdmin, jobId, mergeJob, advanceJobBatch]);

  useEffect(() => {
    setRawOpen(false);
  }, [section, selectedKey]);

  useLayoutEffect(() => {
    updateCalendarPosition();
  }, [updateCalendarPosition, startDate, endDate, dynamicDateCounts]);

  useEffect(() => {
    if (!openCalendar) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const trigger = openCalendar === "start" ? startTriggerRef.current : endTriggerRef.current;
      if (calendarPanelRef.current?.contains(target) || trigger?.contains(target)) return;
      setOpenCalendar("");
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenCalendar("");
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updateCalendarPosition);
    window.addEventListener("scroll", updateCalendarPosition, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updateCalendarPosition);
      window.removeEventListener("scroll", updateCalendarPosition, true);
    };
  }, [openCalendar, updateCalendarPosition]);

  useEffect(() => {
    if (!availableDates.length) return;
    const alignedEnd = dynamicDateCounts[endDate] ? endDate : nearestPreviousDate(availableDates, endDate);
    const alignedStart = dynamicDateCounts[startDate] && startDate <= alignedEnd
      ? startDate
      : nearestNextDate(availableDates, startDate, alignedEnd);
    if (alignedStart !== startDate) setStartDate(alignedStart);
    if (alignedEnd !== endDate) setEndDate(alignedEnd);
    setBatchSize(batchForRange(alignedStart, alignedEnd));
  }, [availableDates, batchForRange, dynamicDateCounts, endDate, startDate]);

  const runAction = useCallback(async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setMessage("");
    setError("");
    try {
      await action();
      setMessage(`${label}完成`);
      await loadOverview();
      await loadDocumentCounts();
    } catch (e) {
      setError(e instanceof Error ? e.message : `${label}失败`);
    } finally {
      setBusy("");
    }
  }, [loadDocumentCounts, loadOverview]);

  const createInitJob = () => runAction("创建初始化任务", async () => {
    const data = await api.post<{ job: WikiJob }>("/api/admin/wiki/init", {
      start_date: startDate,
      end_date: endDate,
      batch_size: batchSize,
      reset: false,
    });
    if (data?.job?.job_id) {
      setJobId(data.job.job_id);
      mergeJob(data.job);
      setDocType("");
      setSection("jobs");
    }
  });

  const runJobBatch = () => runAction("推进任务", async () => {
    const targetJobId = jobId.trim() || (section === "jobs" && selected?.job_id ? String(selected.job_id) : "");
    if (!targetJobId) throw new Error("缺少 job_id");
    if (targetJobId !== jobId.trim()) setJobId(targetJobId);
    const data = await api.post<{ job: WikiJob }>(`/api/admin/wiki/jobs/${encodeURIComponent(targetJobId)}/run`);
    if (data?.job?.job_id) {
      setJobId(data.job.job_id);
      mergeJob(data.job);
    }
    setDocType("");
    setSection("jobs");
  });

  const refreshSectors = () => runAction("刷新板块", async () => {
    await api.post("/api/admin/wiki/sectors/refresh");
    setDocType("");
    setSection("sectors");
  });

  const clearWiki = () => runAction("清除 Wiki", async () => {
    const ok = window.confirm("确认清除 wiki_sources/events/daily/documents/entities/jobs/state？板块目录默认保留。");
    if (!ok) throw new Error("已取消");
    await api.post("/api/admin/wiki/clear", {
      confirm: "CLEAR_WIKI",
      include_jobs: true,
      include_sectors: false,
    });
    setDocType("");
    setSection("daily");
    setJobId("");
  });

  const handleDateSelect = useCallback((field: CalendarField, date?: Date) => {
    if (!date) return;
    const selectedDate = formatDate(date);
    const nextStart = field === "start" ? selectedDate : startDate;
    const nextEnd = field === "end" ? selectedDate : endDate;
    const alignedStart = nextStart <= nextEnd ? nextStart : selectedDate;
    const alignedEnd = nextStart <= nextEnd ? nextEnd : selectedDate;
    setStartDate(alignedStart);
    setEndDate(alignedEnd);
    setBatchSize(batchForRange(alignedStart, alignedEnd));
    setOpenCalendar("");
  }, [batchForRange, endDate, startDate]);

  const renderCalendarDayButton = useCallback((props: WikiCalendarDayButtonProps) => {
    const day = formatDate(props.day.date);
    const count = dynamicDateCounts[day] || 0;
    const className = `${props.className || ""} wiki-calendar-day${count ? " has-dynamics" : " no-dynamics"}`;
    return (
      <CalendarDayButton {...props} className={className}>
        <span className="wiki-calendar-date">{props.children}</span>
        {count > 0 && <span className="wiki-calendar-count">{count}</span>}
      </CalendarDayButton>
    );
  }, [dynamicDateCounts]);

  const renderDatePicker = (field: CalendarField, label: string, value: string) => (
    <div className="wiki-date-field">
      <span>{label}</span>
      <button
        ref={field === "start" ? startTriggerRef : endTriggerRef}
        type="button"
        className="wiki-date-trigger"
        aria-expanded={openCalendar === field}
        onClick={() => setOpenCalendar(open => open === field ? "" : field)}
      >
        <span>{value}</span>
        <CalendarDays size={16} />
      </button>
    </div>
  );

  const renderCalendarPanel = () => {
    if (!openCalendar) return null;
    const value = openCalendar === "start" ? startDate : endDate;
    return createPortal(
      <div ref={calendarPanelRef} className="wiki-calendar-popover" style={calendarStyle}>
        <Calendar
          key={openCalendar}
          mode="single"
          defaultMonth={parseDate(value)}
          selected={parseDate(value)}
          onSelect={date => handleDateSelect(openCalendar, date)}
          disabled={date => !dynamicDateCounts[formatDate(date)]}
          components={{ DayButton: renderCalendarDayButton }}
        />
        {dateStatsLoading && <div className="wiki-calendar-note">加载动态日期...</div>}
      </div>,
      document.body,
    );
  };

  const renderRawPanel = () => {
    if (!rawOpen || !selected) return null;
    return createPortal(
      <div className="wiki-raw-overlay" onMouseDown={event => { if (event.target === event.currentTarget) setRawOpen(false); }}>
        <section className="wiki-raw-panel" role="dialog" aria-modal="true" aria-label="原始数据">
          <div className="wiki-raw-head">
            <div>
              <h3>原始数据</h3>
              <span>{itemTitle(selected, section)}</span>
            </div>
            <button className="wiki-action" type="button" onClick={() => setRawOpen(false)}>关闭</button>
          </div>
          <pre>{selectedRaw}</pre>
        </section>
      </div>,
      document.body,
    );
  };

  if (!isAdmin) {
    return (
      <section className="wiki-page">
        <div className="wiki-empty">仅管理员可访问 Wiki 功能。</div>
      </section>
    );
  }

  return (
    <section className="wiki-page">
      <aside className="wiki-control">
        <div className="wiki-head">
          <Database size={22} />
          <div>
            <h1>Wiki</h1>
            <p>数据库内容与初始化任务</p>
          </div>
        </div>

        <div className="wiki-panel">
          <div className="wiki-panel-title">初始化</div>
          <div className="wiki-date-range">
            {renderDatePicker("start", "开始", startDate)}
            {renderDatePicker("end", "结束", endDate)}
          </div>
          {renderCalendarPanel()}
          <label>
            <span>批次</span>
            <input type="number" min={1} max={100} value={batchSize} onChange={e => setBatchSize(Number(e.target.value || 20))} />
          </label>
          <button className="wiki-action primary" type="button" disabled={Boolean(busy)} onClick={createInitJob}>
            <ListRestart size={17} />
            <span>创建任务</span>
          </button>
          <label>
            <span>任务 ID</span>
            <input value={jobId} onChange={e => setJobId(e.target.value)} placeholder="wiki-init-..." />
          </label>
          {activeJob && activeJob.job_id === jobId.trim() && (
            <div className="wiki-active-job">
              <div className="wiki-active-job-title">
                <JobStatusIcon item={activeJob as unknown as Record<string, any>} />
                <span>{jobStatusLabel(activeJob as unknown as Record<string, any>)}</span>
              </div>
              <JobProgress item={activeJob as unknown as Record<string, any>} />
            </div>
          )}
          <label className="wiki-auto-advance">
            <input type="checkbox" checked={autoAdvance} onChange={e => setAutoAdvance(e.target.checked)} />
            <span>自动续跑（保持本页打开，pending 自动推进至完成）</span>
          </label>
          <button className="wiki-action" type="button" disabled={Boolean(busy)} onClick={runJobBatch}>
            {busy === "推进任务" ? <LoaderCircle className="wiki-running-icon" size={17} /> : <Play size={17} />}
            <span>推进一批</span>
          </button>
        </div>

        <div className="wiki-panel">
          <div className="wiki-panel-title">维护</div>
          <button className="wiki-action" type="button" disabled={Boolean(busy)} onClick={refreshSectors}>
            <RotateCw size={17} />
            <span>刷新板块</span>
          </button>
          <button className="wiki-action danger" type="button" disabled={Boolean(busy)} onClick={clearWiki}>
            <Trash2 size={17} />
            <span>清除内容</span>
          </button>
        </div>

        <div className="wiki-panel">
          <div className="wiki-panel-title">数据</div>
          <div className="wiki-section-group">
            <span>Wiki 层级</span>
            <div className="wiki-section-grid">
              {WIKI_TREE_CATEGORIES.map(category => (
                <button
                  key={category.key}
                  className={activeCategory?.key === category.key ? "active" : ""}
                  type="button"
                  onClick={() => selectCategory(category)}
                >
                  <span>{category.label}</span>
                  <strong>{categoryCount(category)}</strong>
                </button>
              ))}
            </div>
          </div>
          <div className="wiki-section-group">
            <span>索引/运维</span>
            <div className="wiki-section-grid">
              {WIKI_INDEX_CATEGORIES.map(category => (
                <button
                  key={category.key}
                  className={activeCategory?.key === category.key ? "active" : ""}
                  type="button"
                  onClick={() => selectCategory(category)}
                >
                  <span>{category.label}</span>
                  <strong>{categoryCount(category)}</strong>
                </button>
              ))}
            </div>
          </div>
          <button className="wiki-action" type="button" disabled={loading} onClick={loadOverview}>
            <RefreshCw size={17} />
            <span>刷新列表</span>
          </button>
        </div>

        {(message || error || busy) && (
          <div className={`wiki-status${error ? " error" : ""}`}>
            {busy || error || message}
          </div>
        )}
      </aside>

      <div className={`wiki-main${resizingPanels ? " resizing" : ""}`} ref={wikiMainRef} style={{ "--wiki-list-width": `${wikiListWidth}%` } as CSSProperties}>
        <div className="wiki-list" ref={listRef}>
          <div className="wiki-list-head">
            <FileText size={18} />
            <span>{activeCategoryLabel}</span>
            {loading && <small>加载中</small>}
          </div>
          {items.length ? items.map((item, index) => {
            const key = itemKey(item, index);
            const active = selected && itemKey(selected, items.indexOf(selected)) === key;
            const advancing = isAdvancingJob(item);
            return (
              <button className={`wiki-row${active ? " active" : ""}${advancing ? " running" : ""}`} key={`${section}:${docType}:${key}`} type="button" onClick={() => {
                setSelectedKey(key);
                if (section === "jobs" && item.job_id) {
                  setJobId(String(item.job_id));
                  mergeJob(item as unknown as WikiJob);
                }
              }}>
                <strong className="wiki-row-title">
                  {section === "jobs" && <JobStatusIcon item={item} />}
                  <span>{itemTitle(item, section)}</span>
                </strong>
                <span>{section === "jobs" ? `${jobStatusLabel(item)} / ${itemMeta(item, section)}` : itemMeta(item, section)}</span>
                {compactSummary(item, section) && <small>{compactSummary(item, section)}</small>}
                {section === "jobs" && <JobProgress item={item} compact />}
              </button>
            );
          }) : (
            <div className="wiki-empty">{loading ? "加载中..." : "暂无数据"}</div>
          )}
        </div>

        <div
          className="wiki-panel-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整内容列表宽度"
          tabIndex={0}
          onPointerDown={startPanelResize}
          onPointerMove={resizePanels}
          onPointerUp={stopPanelResize}
          onPointerCancel={stopPanelResize}
          onKeyDown={adjustPanelResize}
        />

        <div className="wiki-detail">
          {selected ? (
            <>
              <div className="wiki-detail-head">
                <h2>
                  {section === "jobs" && <JobStatusIcon item={selected} size={17} />}
                  <span>{itemTitle(selected, section)}</span>
                </h2>
                <div className="wiki-detail-meta">
                  <span>{section === "jobs" ? `${jobStatusLabel(selected)} / ${itemMeta(selected, section)}` : itemMeta(selected, section)}</span>
                  <button className="wiki-action wiki-detail-raw" type="button" onClick={() => setRawOpen(true)}>
                    <Eye size={16} />
                    <span>原始数据</span>
                  </button>
                </div>
              </div>
              {section === "jobs" && <JobProgress item={selected} />}
              <div className="wiki-detail-body markdown-body" dangerouslySetInnerHTML={{ __html: selectedHtml }} />
            </>
          ) : (
            <div className="wiki-empty">选择一条记录查看详情</div>
          )}
        </div>
      </div>
      {renderRawPanel()}
    </section>
  );
}
