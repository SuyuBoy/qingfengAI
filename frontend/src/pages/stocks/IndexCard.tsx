import { useState, useCallback } from "react";
import { CalendarDays, BarChart3, X } from "lucide-react";
import { formatNumber } from "./stockUtils";
import { Calendar } from "../../components/ui/calendar";

interface Holding {
  o: string; symbol?: string; sc: number; w: number;
  open?: number; high?: number; low?: number; close?: number;
}

export function IndexCard({
  indexValue, indexChange, selected, holdingsData, onSelectIndex, onLoadHoldings,
}: {
  indexValue: number; indexChange: number; selected: null | any;
  holdingsData: Record<string, Holding[]>; onSelectIndex: () => void; onLoadHoldings: () => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [holdingsDate, setHoldingsDate] = useState("");
  const [calOpen, setCalOpen] = useState(false);

  const load = useCallback(async () => {
    await onLoadHoldings();
    const ds = Object.keys(holdingsData).sort().reverse();
    if (ds.length) setHoldingsDate(ds[0]);
    setModalOpen(true);
  }, [onLoadHoldings, holdingsData]);

  const handleCalendarSelect = useCallback((date: Date | undefined) => {
    if (date) {
      const d = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
      if (holdingsData[d]) setHoldingsDate(d);
      setCalOpen(false);
    }
  }, [holdingsData]);

  const holding = holdingsData[holdingsDate] || [];

  return (
    <div className="index-dual">
      <div className={`index-summary${!selected ? " active" : ""}`} onClick={onSelectIndex}>
        <div className="index-summary-left">
          <span>清风指数</span>
          <strong>{formatNumber(indexValue)}</strong>
          <small className={indexChange >= 0 ? "up" : "down"}>
            {(indexChange >= 0 ? "+" : "")}{formatNumber(indexChange)}
          </small>
        </div>
        <div className="index-card-btns">
          <button type="button" title="查看持仓" onClick={(e) => { e.stopPropagation(); load(); }}>
            <BarChart3 size={14} /></button>
        </div>
      </div>

      {modalOpen && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setModalOpen(false); }}>
          <div className="modal-box">
            <div className="modal-header">
              <div>
                <h3>{holdingsDate} 持仓</h3>
                <span className="modal-meta" style={{cursor:"pointer"}} onClick={() => setCalOpen(c => !c)}>
                  <CalendarDays size={12} style={{verticalAlign:-1,marginRight:4}} />切换日期
                </span>
              </div>
              <button className="modal-close" onClick={() => setModalOpen(false)}><X size={18} /></button>
            </div>
            {calOpen && (
              <div style={{padding:"0.5rem 1.15rem"}}>
                <Calendar mode="single" selected={
                  holdingsDate ? new Date(holdingsDate + "T00:00:00+08:00") : undefined
                } onSelect={handleCalendarSelect} />
              </div>
            )}
            <div className="modal-body">
              <table className="holdings-table">
                <thead><tr><th>名称</th><th>代码</th><th>评分</th><th>开</th><th>收</th><th>涨跌</th></tr></thead>
                <tbody>
                  {holding.map(h => {
                    const chg = h.open ? ((h.close! / h.open - 1) * 100) : 0;
                    const scColor = h.sc >= 0.7 ? '#EF5350' : h.sc >= 0.5 ? '#FF9800' : '#9E9E9E';
                    return (
                      <tr key={h.o}>
                        <td>{h.symbol || ""}</td>
                        <td>{h.o}</td>
                        <td style={{color: scColor, fontWeight: 600}}>{(h.sc * 10).toFixed(1)}</td>
                        <td>{h.open != null ? h.open.toFixed(2) : "--"}</td>
                        <td>{h.close != null ? h.close.toFixed(2) : "--"}</td>
                        <td style={{color: chg >= 0 ? '#EF5350' : '#26A69A'}}>
                          {h.open != null ? `${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%` : "--"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
