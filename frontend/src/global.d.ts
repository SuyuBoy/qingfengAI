/// <reference types="vite/client" />
export {};

declare global {
  interface Window {
    __API_BASE__?: string;
    __debugMessages?: ChatMessage[];
    __debugLog?: DebugLogEntry[];
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
