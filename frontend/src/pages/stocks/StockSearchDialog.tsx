import { Check } from "lucide-react";
import type { StockSummary } from "../../types";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "../../components/ui/command";

export function StockSearchDialog({
  open,
  stocks,
  selected,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  stocks: StockSummary[];
  selected: StockSummary | null;
  onOpenChange: (open: boolean) => void;
  onSelect: (stock: StockSummary) => void;
}) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="股票搜索"
      description="输入股票名称或代码搜索"
      className="stock-search-command-dialog"
    >
      <div className="stock-search-command-title">股票搜索</div>
      <CommandInput placeholder="股票代码 / 名称" autoFocus />
      <CommandList className="stock-search-command-list">
        <CommandEmpty>没有匹配的股票</CommandEmpty>
        <CommandGroup>
          {stocks.map(stock => {
            const isSelected = selected?.order_book_id === stock.order_book_id;
            return (
              <CommandItem
                key={stock.order_book_id}
                value={`${stock.order_book_id} ${stock.symbol} ${stock.industry_name || ""}`}
                onSelect={() => {
                  onSelect(stock);
                  onOpenChange(false);
                }}
                className="stock-search-command-item"
              >
                <div className="stock-search-command-main">
                  <span className="stock-search-command-symbol">{stock.symbol}</span>
                  <span className="stock-search-command-meta">
                    活跃 {stock.active_mentions} / 总 {stock.mention_count}
                  </span>
                </div>
                <CommandShortcut>{stock.order_book_id}</CommandShortcut>
                {isSelected && <Check className="stock-search-command-check" />}
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
