/// <reference types="vite/client" />
export {};

declare global {
  interface KLineChartsNamespace {
    init: (target: HTMLElement | string, options?: unknown) => KLineChartInstance | null;
    dispose: (target: HTMLElement | string | KLineChartInstance) => void;
    version?: () => string;
  }

  interface KLineChartInstance {
    applyNewData: (data: unknown[]) => void;
    createIndicator?: (name: string, isStack?: boolean, paneOptions?: { id?: string; height?: number }) => string | null;
    setBarSpace?: (space: number) => void;
    setPeriod?: (period: { span: number; type: string }) => void;
    setSymbol?: (symbol: { ticker: string; pricePrecision?: number; volumePrecision?: number }) => void;
    setStyles?: (styles: unknown) => void;
    scrollToRealTime?: (animationDuration?: number) => void;
    resize?: () => void;
  }

  interface Window {
    __API_BASE__?: string;
    __debugMessages?: ChatMessage[];
    __debugLog?: DebugLogEntry[];
    klinecharts?: KLineChartsNamespace;
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            auto_select?: boolean;
          }) => void;
          renderButton: (
            element: HTMLElement,
            options: { theme: string; size: string; text: string; shape: string }
          ) => void;
          prompt: () => void;
        };
      };
    };
  }
}

type ChatMessage = import("./types").ChatMessage;
type DebugLogEntry = import("./types").DebugLogEntry;
