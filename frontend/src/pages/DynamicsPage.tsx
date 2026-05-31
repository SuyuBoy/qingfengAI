import { marked } from "marked";
import { useEffect, useMemo, useState } from "react";
import { API_BASE, api } from "../api";
import type { DynamicItem, DynamicsResponse } from "../types";

function fixImages(content: string, dynamicId: string) {
  return content.replace(/!\[img:(\d+)\]/g, (_, idx) => `![图片](${API_BASE}/api/img/${dynamicId}_${idx})`);
}

export default function DynamicsPage() {
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

  const groups = useMemo(() => {
    const grouped: Record<string, DynamicItem[]> = {};
    for (const item of items) {
      const date = item.date.slice(0, 10);
      grouped[date] ||= [];
      grouped[date].push(item);
    }
    return Object.entries(grouped).sort(([a], [b]) => b.localeCompare(a));
  }, [items]);

  async function initialLoad() {
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
  }

  async function loadMore() {
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
  }

  async function doSearch() {
    const kw = keyword.trim();
    if (!kw) return;
    setLoading(true);
    setError("");
    setItems([]);
    setCursor("");
    setHasMore(false);
    setExpanded(new Set());
    try {
      const data = await api.get<{ items: DynamicItem[] }>("/api/search", { keyword: kw, limit: 50 });
      if (!data) return;
      setItems(data.items);
      setSearchMode(true);
      setCurrentDate("");
    } catch (e) {
      setError(`搜索失败：${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setLoading(false);
    }
  }

  async function setDate(date: string) {
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
  }

  useEffect(() => {
    initialLoad();
  }, []);

  return (
    <>
      <div className="top-row">
        <div className="search-bar">
          <input
            type="text"
            id="search-kw"
            placeholder="搜索标题关键词..."
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") doSearch(); }}
          />
          <button id="search-btn" onClick={doSearch}>搜索</button>
          {searchMode && (
            <button id="search-clear-btn" className="clear-btn" onClick={() => { setKeyword(""); initialLoad(); }}>清空</button>
          )}
        </div>
        <button id="cal-btn" title="按日期筛选" onClick={() => document.getElementById("date-pick")?.click()}>📅</button>
        <span id="cal-label" className="cal-label">{currentDate}</span>
        {currentDate && (
          <button id="cal-reset" className="clear-btn" onClick={() => setDate("")}>重置</button>
        )}
        <input
          type="date"
          id="date-pick"
          style={{ display: "none" }}
          value={currentDate}
          onChange={e => setDate(e.target.value)}
        />
        <button id="refresh-btn" onClick={() => searchMode ? (setKeyword(""), initialLoad()) : initialLoad()}>刷新</button>
      </div>

      <div id="card-list">
        {loading ? <div className="loading">加载中...</div> : null}
        {!loading && error ? <div className="error">{error}<br /><button onClick={initialLoad}>重试</button></div> : null}
        {!loading && !error && !items.length ? <div className="empty">暂无数据</div> : null}
        {!loading && !error && groups.map(([date, dateItems]) => (
          <div className="month-group" key={date}>
            <div className="month-label">{date}</div>
            {dateItems.map(item => (
              <DynamicCard
                key={item.dynamic_id}
                item={item}
                expanded={expanded.has(item.dynamic_id)}
                onExpand={() => setExpanded(prev => new Set(prev).add(item.dynamic_id))}
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
    </>
  );
}

function DynamicCard({ item, expanded, onExpand }: {
  item: DynamicItem;
  expanded: boolean;
  onExpand: () => void;
}) {
  const isLong = item.content.length > 300;
  const content = isLong && !expanded ? item.content.slice(0, 300) : item.content;
  const html = marked.parse(fixImages(content, item.dynamic_id)) as string;
  const dateStr = new Date(item.date).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="card" data-id={item.dynamic_id}>
      <div className="meta"><span>{dateStr}</span><span className="card-id">{item.dynamic_id}</span></div>
      <div className={`content${isLong && !expanded ? " preview" : ""}`} dangerouslySetInnerHTML={{ __html: html }} />
      {isLong && !expanded && <button className="expand-btn" onClick={onExpand}>展开全文</button>}
    </div>
  );
}
