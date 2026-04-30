// Root component. Hands off to the shell <Layout/> which owns route
// state, auth gate, theme, sidebar, topbar, command palette and
// renders the active page via <Router/>.
import { Component, type ReactNode } from "react";
import { ToastProvider } from "./components/primitives";
import { Layout } from "./shell/Layout";

interface BoundaryState {
  error: Error | null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };
  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }
  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // Surface the message + stack so the migration debugger sees it
    // — React only logs the component stack by default.
    // eslint-disable-next-line no-console
    console.error("[App ErrorBoundary]", error.message, "\n", error.stack, "\n", info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: "var(--font-mono)", color: "#e11d48", whiteSpace: "pre-wrap" }}>
          <strong>Render error:</strong> {this.state.error.message}
          {"\n\n"}
          {this.state.error.stack}
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <Layout />
      </ToastProvider>
    </ErrorBoundary>
  );
}
