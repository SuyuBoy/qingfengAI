import { createRoot } from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./ErrorBoundary";
import "./styles/base.css";
import "./styles/assistant-ui.css";
import "./styles/login.css";
import "./styles/dynamics.css";
import "./styles/chat.css";
import "@klinecharts/pro/dist/klinecharts-pro.css";
import "./styles/stocks.css";
import "./styles/wiki.css";

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
