import { Component, type ErrorInfo, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('HomeShield UI error', error, info); }
  render() {
    if (this.state.failed) return <main className="fatal-error"><span className="brand-mark">H</span><h1>HomeShield could not load</h1><p>Your demonstration data is still stored locally. Reload the page to try again.</p><button className="button button--primary" onClick={() => window.location.reload()}>Reload</button></main>;
    return this.props.children;
  }
}
