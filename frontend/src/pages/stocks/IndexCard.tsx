import { useState, useCallback } from "react";
import { Calendar, BarChart3 } from "lucide-react";
import { formatNumber } from "./stockUtils";

interface Holding { o: string; sc: number; w: number; }

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
  const [showCalendar, setShowCalendar] = useState(false);

  const load = useCallback(async () => {
    await onLoadHoldings();
    const dates = Object.keys(holdingsData).sort().reverse();
    if (dates.length) setHoldingsDate(dates[0]);
    setShowHoldings(true);
  }, [onLoadHoldings, holdingsData]);

  const pickDate = useCallback((d: string) => {
    setHoldingsDate(d);
    setShowCalendar(false);
  }, []);

  return (
    <div className="index-dual">
      <button className={`index-summary${!selected ? " active" : ""}`}
        type="button" onClick={onSelectIndex}>
        <span>清风指数</span>
        <strong>{formatNumber(indexValue)}</strong>
        <small className={indexChange >= 0 ? "up" : "down"}>
          {(indexChange >= 0 ? "+" : "")}{formatNumber(indexChange)}
        </small>
      </button>

      <button className="holdings-btn" type="button" title="查看历史持仓" onClick={load}>
        <BarChart3 size={15} /> 持仓
      </button>

      <button className="calendar-btn" type="button" title="按日期查看持仓"
        onClick={() => setShowCalendar(c => !c)}>
        <Calendar size={15} />
      </button>

      {showCalendar && (
        <div className="calendar-dropdown">
          {Object.keys(holdingsData).sort().reverse().map(d => (
            <button key={d} type="button" onClick={() => pickDate(d)}
              className={d === holdingsDate ? "active" : ""}>{d}</button>
          ))}
        </div>
      )}

      {showHoldings && (
        <div className="holdings-panel">
          <div className="holdings-head">
            <select value={holdingsDate} onChange={e => setHoldingsDate(e.target.value)}>
              {Object.keys(holdingsData).sort().reverse().map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <button type="button" onClick={() => setShowHoldings(false)}>×</button>
          </div>
          <div className="holdings-list">
            {(holdingsData[holdingsDate] || []).map((h) => (
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
