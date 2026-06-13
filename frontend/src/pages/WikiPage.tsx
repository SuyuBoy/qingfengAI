import { type ComponentProps, type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CalendarDays,
  CheckCircle2,
  Database,
  Eye,
  FileText,
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
import { renderMarkdown } from "../markdown";
import type { CurrentUser } from "../types";

type WikiSection = "documents" | "daily" | "sources" | "events" | "entities" | "sectors" | "jobs";
type DocType = "" | "market" | "rolling" | "sector" | "stock" | "method";

interface WikiJob {
  job_id: string;
  job_type: string;
  status: string;
  processed?: number;
  failed?: number;
  cursor?: string;
  error?: string;
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

const DOC_TYPES: Array<{ value: DocType; label: string }> = [
  { value: "", label: "全部" },
  { value: "market", label: "大盘" },
  { value: "rolling", label: "滚动" },
  { value: "sector", label: "板块" },
  { value: "stock", label: "个股" },
  { value: "method", label: "方法" },
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
  fetched_at: "抓取时间",
  finalized: "已定稿",
  job_id: "任务 ID",
  job_type: "任务类型",
  latest_date: "最新日期",
  long_term_updates: "长期更新",
  name: "名称",
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
};

const PRIMARY_FIELDS: Record<WikiSection, string[]> = {
  documents: ["summary", "content", "content_json", "result", "error"],
  daily: ["daily_summary", "daily_overview", "long_term_updates", "summary", "result", "error"],
  sources: ["summary", "content", "value", "result", "error"],
  events: ["summary", "result", "error"],
  entities: ["summary", "content_json", "result", "error"],
  sectors: ["summary", "content_json", "result", "error"],
  jobs: ["result", "error"],
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

function itemMeta(item: Record<string, any>, section: WikiSection) {
  if (section === "documents") return [item.doc_type, item.status, item.updated_at].filter(Boolean).join(" / ");
  if (section === "daily") return [item.finalized ? "finalized" : "pending", item.updated_at].filter(Boolean).join(" / ");
  if (section === "sources") return [item.dynamic_id, item.value, item.time].filter(Boolean).join(" / ");
  if (section === "events") return [item.category, item.stance, item.dynamic_id].filter(Boolean).join(" / ");
  if (section === "entities") return [item.type, item.status, item.latest_date].filter(Boolean).join(" / ");
  if (section === "sectors") return [item.board_type, item.code, item.fetched_at].filter(Boolean).join(" / ");
  return [item.job_type, item.status, `processed=${item.processed ?? 0}`, item.updated_at].filter(Boolean).join(" / ");
}

function compactSummary(item: Record<string, any>, section: WikiSection) {
  const value = item.summary || item.daily_summary || item.content_json?.current || item.error || item.result || "";
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

function formatScalar(value: unknown) {
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.trim();
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
    const text = formatScalar(entry);
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

function recordMarkdown(item: Record<string, any>, section: WikiSection) {
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

function jobDisplayStatus(item: Record<string, any>) {
  const status = String(item.status || "").toLowerCase();
  if (["success", "succeeded", "complete", "completed", "done", "finished", "finalized"].includes(status)) return "success";
  if (["failed", "failure", "error", "errored", "cancelled", "canceled", "timeout"].includes(status)) return "failed";
  return "running";
}

function jobStatusLabel(item: Record<string, any>) {
  const status = jobDisplayStatus(item);
  if (status === "success") return "成功";
  if (status === "failed") return "失败";
  return "正在运行";
}

function JobStatusIcon({ item, size = 16 }: { item: Record<string, any>; size?: number }) {
  const status = jobDisplayStatus(item);
  if (status === "success") return <CheckCircle2 className="wiki-job-status success" size={size} aria-label="成功" />;
  if (status === "failed") return <XCircle className="wiki-job-status failed" size={size} aria-label="失败" />;
  return <LoaderCircle className="wiki-job-status running wiki-running-icon" size={size} aria-label="正在运行" />;
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

type CalendarField = "start" | "end";
type WikiCalendarDayButtonProps = ComponentProps<typeof CalendarDayButton>;

export default function WikiPage({ user }: { user: CurrentUser }) {
  const isAdmin = user.is_admin === true || user.role === "admin";
  const [section, setSection] = useState<WikiSection>("documents");
  const [docType, setDocType] = useState<DocType>("");
  const [overview, setOverview] = useState<WikiOverview | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [batchSize, setBatchSize] = useState(20);
  const [dynamicDateCounts, setDynamicDateCounts] = useState<Record<string, number>>({});
  const [dateStatsLoading, setDateStatsLoading] = useState(false);
  const [openCalendar, setOpenCalendar] = useState<CalendarField | "">("");
  const [jobId, setJobId] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [rawOpen, setRawOpen] = useState(false);
  const overviewRequestRef = useRef(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const startTriggerRef = useRef<HTMLButtonElement | null>(null);
  const endTriggerRef = useRef<HTMLButtonElement | null>(null);
  const calendarPanelRef = useRef<HTMLDivElement | null>(null);
  const [calendarStyle, setCalendarStyle] = useState<CSSProperties>({});

  const overviewMatchesSelection = overview?.section === section && (section !== "documents" || (overview.doc_type || "") === docType);
  const items = overviewMatchesSelection ? overview.items : [];
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
    if (item.status === "running") return true;
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
    loadDynamicDateStats();
  }, [loadDynamicDateStats]);

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
    } catch (e) {
      setError(e instanceof Error ? e.message : `${label}失败`);
    } finally {
      setBusy("");
    }
  }, [loadOverview]);

  const createInitJob = () => runAction("创建初始化任务", async () => {
    const data = await api.post<{ job: WikiJob }>("/api/admin/wiki/init", {
      start_date: startDate,
      end_date: endDate,
      batch_size: batchSize,
      reset: false,
    });
    if (data?.job?.job_id) {
      setJobId(data.job.job_id);
      setSection("jobs");
    }
  });

  const runJobBatch = () => runAction("推进任务", async () => {
    if (!jobId.trim()) throw new Error("缺少 job_id");
    const data = await api.post<{ job: WikiJob }>(`/api/admin/wiki/jobs/${encodeURIComponent(jobId.trim())}/run`);
    if (data?.job?.job_id) setJobId(data.job.job_id);
    setSection("jobs");
  });

  const refreshSectors = () => runAction("刷新板块", async () => {
    await api.post("/api/admin/wiki/sectors/refresh");
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
    setSection("documents");
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
          <div className="wiki-section-grid">
            {(Object.keys(SECTION_LABELS) as WikiSection[]).map(key => (
              <button key={key} className={section === key ? "active" : ""} type="button" onClick={() => setSection(key)}>
                <span>{SECTION_LABELS[key]}</span>
                <strong>{overview?.counts?.[key] ?? 0}</strong>
              </button>
            ))}
          </div>
          {section === "documents" && (
            <select value={docType} onChange={e => setDocType(e.target.value as DocType)}>
              {DOC_TYPES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          )}
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

      <div className="wiki-main">
        <div className="wiki-list" ref={listRef}>
          <div className="wiki-list-head">
            <FileText size={18} />
            <span>{SECTION_LABELS[section]}</span>
            {loading && <small>加载中</small>}
          </div>
          {items.length ? items.map((item, index) => {
            const key = itemKey(item, index);
            const active = selected && itemKey(selected, items.indexOf(selected)) === key;
            const advancing = isAdvancingJob(item);
            return (
              <button className={`wiki-row${active ? " active" : ""}${advancing ? " running" : ""}`} key={`${section}:${docType}:${key}`} type="button" onClick={() => setSelectedKey(key)}>
                <strong className="wiki-row-title">
                  {section === "jobs" && <JobStatusIcon item={item} />}
                  <span>{itemTitle(item, section)}</span>
                </strong>
                <span>{section === "jobs" ? `${jobStatusLabel(item)} / ${itemMeta(item, section)}` : itemMeta(item, section)}</span>
                {compactSummary(item, section) && <small>{compactSummary(item, section)}</small>}
              </button>
            );
          }) : (
            <div className="wiki-empty">{loading ? "加载中..." : "暂无数据"}</div>
          )}
        </div>

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
