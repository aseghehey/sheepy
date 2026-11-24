import { Component, type ReactNode } from "react";

// A part of the window that fails to draw shows what went wrong, with a way
// to try again, instead of taking the whole window down.
export class ErrorBoundary extends Component<{ children: ReactNode; label: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error(`${this.props.label}:`, error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <div className="crash-title">The {this.props.label} hit a problem</div>
        <pre className="output">{String(this.state.error?.stack ?? this.state.error)}</pre>
        <button className="link" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}
