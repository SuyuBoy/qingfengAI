import { useState, useCallback, useRef, useEffect } from "react";
import { CalendarDays, BarChart3 } from "lucide-react";
import { formatNumber } from "./stockUtils";
import { Calendar } from "../../components/ui/calendar";

interface Holding { o: string; sc: number; w: number; }

function parseDate(value: string) {
  if (!value) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function IndexCard({
  indexValue, indexChange, selected, holdingsData, onSelectIndex, onLoadHoldings,
}: {
  indexValue: number;
  indexChange: number;
  selected: null | any;
  holdingsData: Record<string, Holding[]>;
  onSelectIndex: () => void;
  onLoadHoldings: () => void;
}) {
  const [showHoldings, setShowHoldings] = useState(false);
  const [holdingsDate, setHoldingsDate] = useState("");
  const [calOpen, setCalOpen] = useState(false);
  const calRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    await onLoadHoldings();
    const dates = Object.keys(holdingsData).sort().reverse();
    if (dates.length) setHoldingsDate(dates[0]);
    setShowHoldings(true);
  }, [onLoadHoldings, holdingsData]);

  const handleCalendarSelect = useCallback((date: Date | undefined) => {
    if (date) {
      const d = formatDate(date);
      if (holdingsData[d]) { setHoldingsDate(d); setShowHoldings(true); }
      setCalOpen(false);
    }
  }, [holdingsData]);

  useEffect(() => {
    if (!calOpen) return;
    const h = (e: MouseEvent) => {
      if (calRef.current && !calRef.current.contains(e.target as Node)) setCalOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [calOpen]);

  const dates = Object.keys(holdingsData).sort().reverse();
  const holding = holdingsData[holdingsDate] || [];

  return (
    <div className="index-dual">
      <button className={`index-summary${!selected ? " active" : ""}`}
        type="button" onClick={onSelectIndex}>
        <span>清风指数</span>
        <strong>{formatNumber(indexValue)}</strong>
        <small className={indexChange >= 0 ? "up" : "down"}>
          {(indexChange >= 0 ? "+" : "")}{formatNumber(indexChange)}
        </small>
        <div className="index-card-actions" onClick={e => e.stopPropagation()}>
          <button className="index-card-btn" type="button" title="持仓"
            onClick={load}><BarChart3 size={14} /></button>
          <button className="index-card-btn" type="button" title="选日期"
            onClick={() => setCalOpen(c => !c)}><CalendarDays size={14} /></button>
        </div>
      </button>

      {calOpen && (
        <div className="date-picker-popover" ref={calRef}>
          <Calendar mode="single" selected={parseDate(holdingsDate)} onSelect={handleCalendarSelect} />
        </div>
      )}

      {showHoldings && (
        <div className="holdings-panel">
          <div className="holdings-head">
            <select value={holdingsDate} onChange={e => setHoldingsDate(e.target.value)}>
              {dates.map(d => (<option key={d} value={d}>{d}</option>))}
            </select>
            <button type="button" onClick={() => setShowHoldings(false)}>×</button>
          </div>
          <div className="holdings-list">
            {holding.map((h) => (
              <div key={h.o} className="holdings-item">
                <span className="holdings-code">{h.o}</span>
                <span className="holdings-score" style={{ color: h.sc >= 0 ? '#EF5350' : '#26A69A' }}>
                  {h.sc > 0 ? '+' : ''}{h.sc.toFixed(1)}
                </span>
                <span className="holdings-weight">{(h.w * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
