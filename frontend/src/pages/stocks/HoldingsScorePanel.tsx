import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, X } from "lucide-react";
import { Calendar } from "../../components/ui/calendar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../../components/ui/select";

export interface Holding {
  o: string;
  n?: string;
  symbol?: string;
  sc: number;
  w: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
}

const TOP_N_OPTIONS = [3, 5, 10, 15, 20];

interface HoldingsScorePanelProps {
  holdingsData: Record<string, Holding[]>;
  onClose: () => void;
  isPro?: boolean;
  topN: number;
  onTopNChange: (n: number) => void;
}

function formatDate(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatPrice(value?: number) {
  return value == null ? "--" : value.toFixed(2);
}

function getScoreClass(score: number) {
  if (score >= 0.7) return "score-high";
  if (score >= 0.5) return "score-mid";
  return "score-low";
}

function getChange(open?: number, close?: number) {
  if (open == null || close == null || open === 0) return null;
  return (close / open - 1) * 100;
}

function HoldingsScoreRow({ holding }: { holding: Holding }) {
  const change = getChange(holding.open, holding.close);
  const changeClass = change == null ? "" : change >= 0 ? "is-up" : "is-down";

  return (
    <tr>
      <td>
        <div className="holding-name-cell">
          <strong>{holding.n || "--"}</strong>
          <span>{holding.o}</span>
        </div>
      </td>
      <td>
        <span className={`holdings-score-value ${getScoreClass(holding.sc)}`}>
          {(holding.sc * 10).toFixed(1)}
        </span>
      </td>
      <td>{formatPrice(holding.open)}</td>
      <td>{formatPrice(holding.close)}</td>
      <td>
        <span className={`holdings-change ${changeClass}`}>
          {change == null ? "--" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`}
        </span>
      </td>
    </tr>
  );
}

export function HoldingsScorePanel({ holdingsData, onClose, isPro, topN, onTopNChange }: HoldingsScorePanelProps) {
  const [selectedDate, setSelectedDate] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(false);

  const availableDates = useMemo(() => Object.keys(holdingsData).sort().reverse(), [holdingsData]);
  const holdings = holdingsData[selectedDate] || [];

  useEffect(() => {
    if (!availableDates.length) {
      setSelectedDate("");
      return;
    }
    setSelectedDate(current => (current && holdingsData[current] ? current : availableDates[0]));
  }, [availableDates, holdingsData]);

  const handleCalendarSelect = useCallback((date: Date | undefined) => {
    if (!date) return;
    const nextDate = formatDate(date);
    if (holdingsData[nextDate]) setSelectedDate(nextDate);
    setCalendarOpen(false);
  }, [holdingsData]);

  return createPortal(
    <div className="modal-overlay holdings-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box holdings-modal">
        <div className="modal-header holdings-modal-header">
          <div className="holdings-title-row">
            <h3>{selectedDate || "暂无日期"} 持仓评分</h3>
            <button
              className="holdings-date-trigger"
              type="button"
              title="切换日期"
              aria-label="切换日期"
              onClick={() => setCalendarOpen(open => !open)}
            >
              <CalendarDays size={15} />
            </button>
            <Select value={String(topN)} onValueChange={(v) => onTopNChange(Number(v))}>
              <SelectTrigger className="holdings-topn-trigger" title="选择成分股数量">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end" className="holdings-select-content">
                {TOP_N_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>Top {n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {calendarOpen && (
              <div className="holdings-calendar-panel">
                <Calendar
                  mode="single"
                  selected={selectedDate ? new Date(`${selectedDate}T00:00:00+08:00`) : undefined}
                  onSelect={handleCalendarSelect}
                />
              </div>
            )}
          </div>
          <button className="modal-close" type="button" onClick={onClose} title="关闭">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body holdings-modal-body">
          {holdings.length === 0 ? (
            <div className="holdings-empty">
              {isPro ? "暂无持仓数据" : "升级 Pro 查看持仓明细"}
            </div>
          ) : (
            <div className="holdings-table-wrap">
              <table className="holdings-score-table">
                <thead>
                  <tr>
                    <th>名称 / 代码</th>
                    <th>评分</th>
                    <th>开盘</th>
                    <th>收盘</th>
                    <th>涨跌</th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.map(holding => <HoldingsScoreRow key={holding.o} holding={holding} />)}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
