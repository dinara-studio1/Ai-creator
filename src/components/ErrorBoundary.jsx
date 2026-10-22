import { Component } from "react";

function reportClientError(message, stack, source) {
  console.error(JSON.stringify({
    time: new Date().toISOString(),
    level: "error",
    route: source || "client",
    status: "",
    message: String(message || "Ошибка интерфейса"),
    stack: String(stack || ""),
  }));
}

export function installClientErrorHandlers() {
  window.onerror = (message, source, line, col, error) => {
    reportClientError(message, error?.stack || `${source || ""}:${line || 0}:${col || 0}`, "window.onerror");
  };
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    reportClientError(reason?.message || reason, reason?.stack || "", "unhandledrejection");
  });
}

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    reportClientError(error?.message, `${error?.stack || ""}${info?.componentStack || ""}`, this.props.name || "app");
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="app-crash" role="alert">
        <p>Что-то пошло не так. Обновите страницу.</p>
        <button type="button" onClick={() => window.location.reload()}>Обновить</button>
      </div>
    );
  }
}
