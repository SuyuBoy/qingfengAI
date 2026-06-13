import { type ComponentProps, useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Database,
  FileText,
  ListRestart,
  Play,
  RefreshCw,
  RotateCw,
  Trash2,
} from "lucide-react";
import { api } from "../api";
import { Calendar, CalendarDayButton } from "../components/ui/calendar";
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
  return item.doc_id || item.date || item.dynamic_id || item.event_id || item.entity_id || item.sector_id || item.job_id || String(index);
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

  const items = overview?.items || [];
  const availableDates = useMemo(() => {
    return Object.entries(dynamicDateCounts)
      .filter(([, count]) => count > 0)
      .map(([date]) => date)
      .sort();
  }, [dynamicDateCounts]);
  const selected = useMemo(() => {
    return items.find((item, index) => itemKey(item, index) === selectedKey) || items[0] || null;
  }, [items, selectedKey]);
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
    setLoading(true);
    setError("");
    try {
      const data = await api.get<WikiOverview>("/api/admin/wiki", { section, doc_type: docType, limit: 200 });
      setOverview(data || null);
      setSelectedKey("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
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

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    loadDynamicDateStats();
  }, [loadDynamicDateStats]);

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
    return (
      <div className="wiki-calendar-popover">
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
      </div>
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
            {renderCalendarPanel()}
          </div>
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
            <Play size={17} />
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
        <div className="wiki-list">
          <div className="wiki-list-head">
            <FileText size={18} />
            <span>{SECTION_LABELS[section]}</span>
            {loading && <small>加载中</small>}
          </div>
          {items.length ? items.map((item, index) => {
            const key = itemKey(item, index);
            const active = selected && itemKey(selected, items.indexOf(selected)) === key;
            return (
              <button className={`wiki-row${active ? " active" : ""}`} key={key} type="button" onClick={() => setSelectedKey(key)}>
                <strong>{itemTitle(item, section)}</strong>
                <span>{itemMeta(item, section)}</span>
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
                <h2>{itemTitle(selected, section)}</h2>
                <span>{itemMeta(selected, section)}</span>
              </div>
              <pre>{JSON.stringify(selected, null, 2)}</pre>
            </>
          ) : (
            <div className="wiki-empty">选择一条记录查看详情</div>
          )}
        </div>
      </div>
    </section>
  );
}
