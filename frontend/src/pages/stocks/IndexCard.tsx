import { useState, useCallback } from "react";
import { BarChart3 } from "lucide-react";
import { formatNumber } from "./stockUtils";
import { HoldingsScorePanel, type Holding } from "./HoldingsScorePanel";

export function IndexCard({
  indexValue, indexChange, selected, holdingsData, onSelectIndex, onLoadHoldings,
}: {
  indexValue: number; indexChange: number; selected: null | any;
  holdingsData: Record<string, Holding[]>; onSelectIndex: () => void; onLoadHoldings: () => void;
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
          <button type="button" title="查看持仓" onClick={(e) => { e.stopPropagation(); load(); }}>
            <BarChart3 size={14} /></button>
        </div>
      </div>

      {modalOpen && (
        <HoldingsScorePanel holdingsData={holdingsData} onClose={() => setModalOpen(false)} />
      )}
    </div>
  );
}
