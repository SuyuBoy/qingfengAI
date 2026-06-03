import { useState, useCallback } from "react";
import { CalendarDays, BarChart3, X } from "lucide-react";
import { formatNumber } from "./stockUtils";
import { Calendar } from "../../components/ui/calendar";
import { api } from "../../api";

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
  indexValue: number; indexChange: number; selected: null | any;
  holdingsData: Record<string, Holding[]>; onSelectIndex: () => void; onLoadHoldings: () => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [holdingsDate, setHoldingsDate] = useState("");
  const [prices, setPrices] = useState<Record<string, { open: number; close: number }>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [calOpen, setCalOpen] = useState(false);

  const load = useCallback(async () => {
    await onLoadHoldings();
    const ds = Object.keys(holdingsData).sort().reverse();
    if (ds.length) { setHoldingsDate(ds[0]); loadPrices(ds[0]); }
    setModalOpen(true);
  }, [onLoadHoldings, holdingsData]);

  const loadPrices = useCallback(async (date: string) => {
    try {
      const data = await api.get<{ prices: any; names: Record<string, string> }>(
        `/api/stocks/index/holdings/prices?date=${date}`);
      if (data?.prices) setPrices(data.prices);
      if (data?.names) setNames(data.names);
    } catch {}
  }, []);

  const handleCalendarSelect = useCallback((date: Date | undefined) => {
    if (date) {
      const d = formatDate(date);
      if (holdingsData[d]) { setHoldingsDate(d); loadPrices(d); }
      setCalOpen(false);
    }
  }, [holdingsData, loadPrices]);

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
                <Calendar mode="single" selected={parseDate(holdingsDate)} onSelect={handleCalendarSelect} />
              </div>
            )}
            <div className="modal-body">
              <table className="holdings-table">
                <thead><tr><th>名称</th><th>代码</th><th>开盘</th><th>收盘</th><th>涨跌</th><th>权重</th></tr></thead>
                <tbody>
                  {holding.map(h => {
                    const p = prices[h.o];
                    const chg = p && p.open ? ((p.close / p.open - 1) * 100) : 0;
                    return (
                      <tr key={h.o}>
                        <td>{names[h.o] || ""}</td>
                        <td>{h.o}</td>
                        <td>{p?.open ? p.open.toFixed(2) : "--"}</td>
                        <td>{p?.close ? p.close.toFixed(2) : "--"}</td>
                        <td style={{color: chg >= 0 ? '#EF5350' : '#26A69A'}}>
                          {p?.open ? `${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%` : "--"}</td>
                        <td>{(h.w * 100).toFixed(1)}%</td>
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
