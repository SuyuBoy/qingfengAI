import { useMemo } from "react";
import { ChevronDown, ChevronUp, PanelRightClose, PanelRightOpen, RefreshCw } from "lucide-react";
import type { StockSummary } from "../../types";
import { IndexCard } from "./IndexCard";

type SortKey = "active_mentions" | "mention_count" | "last_mentioned";

export function StockPanel({
  stocks, loading, selected, sortBy, sortDir,
  onSelect, onSelectIndex, onChangeSort, onRefresh,
  collapsed, onToggleCollapse,
  indexValue, indexChange, holdingsData, onLoadHoldings,
}: {
  stocks: StockSummary[];
  loading: boolean;
  selected: StockSummary | null;
  sortBy: SortKey;
  sortDir: number;
  onSelect: (s: StockSummary) => void;
  onSelectIndex: () => void;
  onChangeSort: (k: SortKey) => void;
  onRefresh: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  indexValue: number;
  indexChange: number;
  holdingsData: Record<string, any[]>;
  onLoadHoldings: () => void;
}) {
  const sorted = useMemo(() => {
    return [...stocks].sort((a, b) => {
      if (sortBy === "last_mentioned") return ((a.last_mentioned || "").localeCompare(b.last_mentioned || "")) * sortDir;
      return (((a[sortBy] || 0) as number) - ((b[sortBy] || 0) as number)) * sortDir;
    });
  }, [sortBy, sortDir, stocks]);

  const collapseButton = (className = "") => (
    <button className={`stocks-collapse-rail${className ? ` ${className}` : ""}`} type="button"
      title={collapsed ? "展开股票列表" : "折叠股票列表"}
      onClick={onToggleCollapse}>
      <span className="stocks-collapse-icon stocks-collapse-icon-desktop">
        {collapsed ? <PanelRightOpen size={20} /> : <PanelRightClose size={20} />}
      </span>
      <span className="stocks-collapse-icon stocks-collapse-icon-mobile">
        {collapsed ? <ChevronUp size={21} /> : <ChevronDown size={21} />}
      </span>
    </button>
  );

  return (
    <aside className={`stocks-panel${collapsed ? " stocks-collapsed" : ""}`}>
      {collapseButton("collapsed-only")}
      <div className="stocks-panel-head">
        <div><h1>股票</h1></div>
        <div className="stocks-panel-actions">
          <button className="mini-icon-btn" type="button" title="刷新" onClick={onRefresh}>
            <RefreshCw size={17} />
          </button>
          {collapseButton()}
        </div>
      </div>

      <IndexCard
        indexValue={indexValue} indexChange={indexChange}
        selected={selected} holdingsData={holdingsData}
        onSelectIndex={onSelectIndex} onLoadHoldings={onLoadHoldings} />

      <div className="sort-bar stock-sort-bar">
        {(["active_mentions", "mention_count", "last_mentioned"] as SortKey[]).map(key => (
          <button className={`sort-btn${sortBy === key ? " active" : ""}`} type="button" key={key}
            onClick={() => onChangeSort(key)}>
            {key === "active_mentions" ? "活跃" : key === "mention_count" ? "总提及" : "最新"}
            {sortBy === key ? (sortDir > 0 ? " ↑" : " ↓") : ""}
          </button>
        ))}
      </div>

      <div className="stock-list">
        {loading && <div className="loading compact">加载中...</div>}
        {!loading && sorted.map(stock => (
          <button key={stock.order_book_id}
            className={`stock-row${selected?.order_book_id === stock.order_book_id ? " selected" : ""}`}
            type="button" onClick={() => onSelect(stock)}>
            <span className="stock-symbol">{stock.symbol}</span>
            <span className="stock-code">{stock.order_book_id}</span>
            <span className="stock-meta">活跃 {stock.active_mentions} / 总 {stock.mention_count}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
