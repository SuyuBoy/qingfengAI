import { useState, useCallback } from "react";
import { BarChart3 } from "lucide-react";
import { formatNumber } from "./stockUtils";
import { HoldingsScorePanel, type Holding } from "./HoldingsScorePanel";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../../components/ui/select";

const TOP_N_OPTIONS = [3, 5, 10, 15, 20];

export function IndexCard({
  indexValue, indexChange, selected, holdingsData, onSelectIndex, onLoadHoldings, isPro,
  topN, onTopNChange,
}: {
  indexValue: number; indexChange: number; selected: null | any;
  holdingsData: Record<string, Holding[]>; onSelectIndex: () => void; onLoadHoldings: () => void;
  isPro?: boolean;
  topN: number;
  onTopNChange: (n: number) => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    setModalOpen(true);
    await onLoadHoldings();
  }, [onLoadHoldings]);

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
          <Select value={String(topN)} onValueChange={(v) => onTopNChange(Number(v))}>
            <SelectTrigger className="index-topn-trigger" title="选择成分股数量">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {TOP_N_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>Top {n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button type="button" title="查看持仓" onClick={(e) => { e.stopPropagation(); load(); }}>
            <BarChart3 size={14} /></button>
        </div>
      </div>

      {modalOpen && (
        <HoldingsScorePanel holdingsData={holdingsData} onClose={() => setModalOpen(false)} isPro={isPro} />
      )}
    </div>
  );
}
