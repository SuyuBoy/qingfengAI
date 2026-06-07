import { marked } from "marked";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, RefreshCw, Search, X } from "lucide-react";
import { API_BASE, api } from "../api";
import { Calendar } from "../components/ui/calendar";
import type { DynamicItem, DynamicsResponse } from "../types";

function fixImages(content: string, dynamicId: string) {
  return content.replace(/!\[img:(\d+)\]/g, (_, idx) => `![图片](${API_BASE}/api/img/${dynamicId}_${idx})`);
}

function parseDateInput(value: string) {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

type DynamicsPageProps = {
  dynamicId?: string;
  title?: string;
  description?: string;
};

export default function DynamicsPage({
  dynamicId,
  title = "动态",
  description = "清风文章库检索与归档",
}: DynamicsPageProps = {}) {
  const [keyword, setKeyword] = useState("");
  const [items, setItems] = useState<DynamicItem[]>([]);
  const [cursor, setCursor] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchMode, setSearchMode] = useState(false);
  const [currentDate, setCurrentDate] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [moreLoading, setMoreLoading] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const calendarRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => {
    const grouped: Record<string, DynamicItem[]> = {};
    for (const item of items) {
      const date = item.date.slice(0, 10);
      grouped[date] ||= [];
      grouped[date].push(item);
    }
    return Object.entries(grouped).sort(([a], [b]) => b.localeCompare(a));
  }, [items]);

  const loadDynamic = useCallback(async (id: string) => {
    setLoading(true);
    setError("");
    setItems([]);
    setCursor("");
    setHasMore(false);
    setSearchMode(false);
    setCurrentDate("");
    setExpanded(new Set());
    try {
      const item = await api.get<DynamicItem>(`/api/dynamics/${encodeURIComponent(id)}`);
      if (!item) return;
      setItems([item]);
      setExpanded(new Set([item.dynamic_id]));
    } catch (e) {
      setError(`加载失败：${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const initialLoad = useCallback(async () => {
    if (dynamicId) {
      await loadDynamic(dynamicId);
      return;
    }

    setLoading(true);
    setError("");
    setItems([]);
    setCursor("");
    setExpanded(new Set());
    try {
      const data = await api.get<DynamicsResponse>("/api/dynamics", { limit: 20, type: "" });
      if (!data) return;
      setItems(data.items);
      setHasMore(data.has_more);
      setCursor(data.next_cursor);
      setSearchMode(false);
      setCurrentDate("");
    } catch (e) {
      setError(`加载失败：${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setLoading(false);
    }
  }, [dynamicId, loadDynamic]);

  const loadMore = useCallback(async () => {
    setMoreLoading(true);
    try {
      const data = await api.get<DynamicsResponse>("/api/dynamics", { limit: 20, cursor, type: "" });
      if (!data) return;
      setItems(prev => prev.concat(data.items));
      setHasMore(data.has_more);
      setCursor(data.next_cursor);
    } finally {
      setMoreLoading(false);
    }
  }, [cursor]);

  const doSearch = useCallback(async () => {
    const kw = keyword.trim();
    if (!kw) return;
    setLoading(true);
    setError("");
    setItems([]);
    setCursor("");
    setHasMore(false);
    setExpanded(new Set());
    setSearchMode(true);
    setCurrentDate("");

    if (/^\d{15,}$/.test(kw)) {
      try {
        const item = await api.get<DynamicItem>(`/api/dynamics/${kw}`);
        if (!item) return;
        setItems([item]);
      } catch {
        setError(`未找到文章 ${kw}`);
      } finally {
        setLoading(false);
      }
      return;
    }

    try {
      const data = await api.get<{ items: DynamicItem[] }>("/api/search", { keyword: kw, limit: 50 });
      if (!data) return;
      setItems(data.items);
    } catch (e) {
      setError(`搜索失败：${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setLoading(false);
    }
  }, [keyword]);

  const setDate = useCallback(async (date: string) => {
    if (dynamicId) return;
    setCurrentDate(date);
    if (!date) {
      initialLoad();
      return;
    }
    setLoading(true);
    setError("");
    setItems([]);
    setHasMore(false);
    setSearchMode(false);
    setExpanded(new Set());
    try {
      const data = await api.get<{ items: DynamicItem[] }>("/api/search", { date_from: date, date_to: date, limit: 50 });
      if (!data) return;
      setItems(data.items);
    } catch (e) {
      setError(`加载失败：${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setLoading(false);
    }
  }, [dynamicId, initialLoad]);

  const clearSearch = useCallback(() => {
    setKeyword("");
    initialLoad();
  }, [initialLoad]);

  const resetDate = useCallback(() => {
    setDate("");
  }, [setDate]);

  const handleExpand = useCallback((id: string) => {
    setExpanded(prev => new Set(prev).add(id));
  }, []);

  const handleRefresh = useCallback(() => {
    if (searchMode) setKeyword("");
    initialLoad();
  }, [searchMode, initialLoad]);

  const handleCalendarSelect = useCallback((date?: Date) => {
    if (!date) return;
    setCalendarOpen(false);
    setDate(formatDateInput(date));
  }, [setDate]);

  useEffect(() => {
    initialLoad();
  }, [initialLoad]);

  useEffect(() => {
    if (!calendarOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!calendarRef.current?.contains(event.target as Node)) {
        setCalendarOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCalendarOpen(false);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [calendarOpen]);

  return (
    <section className="dynamics-page">
      <div className="workspace-head">
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <button className="mini-icon-btn" title="刷新" type="button" onClick={handleRefresh}>
          <RefreshCw size={17} />
        </button>
      </div>

      {!dynamicId && (
        <div className="top-row">
          <div className="search-bar">
            <Search size={18} />
            <input
              type="text"
              id="search-kw"
              placeholder="关键词 / 文章ID..."
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") doSearch(); }}
            />
            <button id="search-btn" onClick={doSearch}>搜索</button>
            {searchMode && (
              <button id="search-clear-btn" className="clear-btn icon-only" title="清空" onClick={clearSearch}><X size={16} /></button>
            )}
          </div>
          <div className="filter-actions">
            <div className="date-picker-control" ref={calendarRef}>
              <button
                id="cal-btn"
                type="button"
                title="按日期筛选"
                aria-label="按日期筛选"
                aria-expanded={calendarOpen}
                onClick={() => setCalendarOpen(open => !open)}
              >
                <CalendarDays size={17} />
              </button>
              {calendarOpen && (
                <div className="date-picker-popover">
                  <Calendar
                    mode="single"
                    selected={parseDateInput(currentDate)}
                    onSelect={handleCalendarSelect}
                  />
                </div>
              )}
            </div>
            <span id="cal-label" className="cal-label">{currentDate}</span>
            {currentDate && (
              <button id="cal-reset" className="clear-btn" onClick={resetDate}>重置</button>
            )}
          </div>
        </div>
      )}

      <div id="card-list">
        {loading ? <div className="loading">加载中...</div> : null}
        {!loading && error ? (
            <div className="error">
              {error}
              {error.includes("内容验证") && (
                <a href="#/profile" style={{ display: "block", marginTop: "0.5rem", color: "var(--accent)" }}>
                  前往个人中心完成验证 →
                </a>
              )}
              <br />
              <button onClick={initialLoad}>重试</button>
            </div>
          ) : null}
        {!loading && !error && !items.length ? <div className="empty">暂无数据</div> : null}
        {!loading && !error && groups.map(([date, dateItems]) => (
          <div className="month-group" key={date}>
            <div className="month-label">{date}</div>
            {dateItems.map(item => (
              <DynamicCard
                key={item.dynamic_id}
                item={item}
                expanded={expanded.has(item.dynamic_id)}
                onExpand={handleExpand}
              />
            ))}
          </div>
        ))}
      </div>

      {!searchMode && hasMore && !loading && !error && (
        <button id="more-btn" onClick={loadMore} disabled={moreLoading}>
          {moreLoading ? "加载中..." : "加载更多"}
        </button>
      )}
    </section>
  );
}

const DynamicCard = memo(function DynamicCard({ item, expanded, onExpand }: {
  item: DynamicItem;
  expanded: boolean;
  onExpand: (id: string) => void;
}) {
  const isLong = item.content.length > 300;
  const content = isLong && !expanded ? item.content.slice(0, 300) : item.content;

  const html = useMemo(
    () => marked.parse(fixImages(content, item.dynamic_id), { gfm: true, breaks: false }) as string,
    [content, item.dynamic_id],
  );

  const dateStr = useMemo(
    () => new Date(item.date).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
    [item.date],
  );

  const handleExpand = useCallback(() => onExpand(item.dynamic_id), [onExpand, item.dynamic_id]);

  return (
    <div className="card" data-id={item.dynamic_id}>
      <div className="meta"><span>{dateStr}</span><span className="card-id">{item.dynamic_id}</span></div>
      <div className={`content${isLong && !expanded ? " preview" : ""}`} dangerouslySetInnerHTML={{ __html: html }} />
      {isLong && !expanded && <button className="expand-btn" onClick={handleExpand}>展开全文</button>}
    </div>
  );
});
