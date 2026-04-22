import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

/** App-wide error boundary. Prevents a component crash from turning the whole
 *  UI blank. Logs the error so the developer can inspect in DevTools.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Intentionally console.error — no remote reporting wired yet.
    console.error('rd-console ErrorBoundary caught:', error, info);
  }

  private reset = () => this.setState({ error: null });

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className="rd-center">
        <div
          className="rd-error-card"
          role="alert"
          style={{ maxWidth: 480 }}
        >
          <div>
            <h3>Something went wrong.</h3>
            <p style={{ color: 'var(--fg-muted)', marginTop: 4, fontSize: 13 }}>
              {error.message}
            </p>
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button type="button" className="rd-btn rd-btn--primary rd-btn--sm" onClick={this.reset}>
                Try again
              </button>
              <button
                type="button"
                className="rd-btn rd-btn--secondary rd-btn--sm"
                onClick={() => window.location.assign('/')}
              >
                Go home
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
