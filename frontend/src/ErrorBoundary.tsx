import { Component, type ErrorInfo, type ReactNode } from "react";
import { clearAllLocalChatSessions } from "./chatStorage";

interface ErrorBoundaryState {
  error: Error | null;
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("React render failed", error, errorInfo);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="auth-screen">
        <div className="error">
          页面渲染失败：{this.state.error.message}
          <br />
          <button onClick={() => {
            clearAllLocalChatSessions();
            window.location.reload();
          }}>
            清理本地对话并刷新
          </button>
        </div>
      </main>
    );
  }
}
