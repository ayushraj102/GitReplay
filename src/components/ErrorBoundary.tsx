import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'An unexpected rendering error occurred.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('GitReplay UI ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[var(--gr-bg)] text-[var(--gr-text)] flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-xl bg-[var(--gr-surface)] border border-[var(--gr-border)] p-6 space-y-4">
            <div className="text-[12px] font-medium text-[var(--gr-accent-text)]">
              GitReplay Recovery
            </div>
            <h1 className="text-[16px] font-semibold text-[var(--gr-text)]">
              Something went wrong rendering this view
            </h1>
            <p className="text-[12px] text-[var(--gr-muted)] font-mono break-words bg-[var(--gr-bg)] p-3 rounded-lg border border-[var(--gr-border)]">
              {this.state.message}
            </p>
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => this.setState({ hasError: false, message: '' })}
                className="h-9 px-4 rounded-lg bg-[#E0A458] hover:bg-[#E8B46E] text-[#141414] text-[12px] font-semibold cursor-pointer transition-colors duration-150"
              >
                Retry view
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="h-9 px-4 rounded-lg border border-[var(--gr-border)] bg-[var(--gr-bg)] hover:bg-[var(--gr-surface-elevated)] text-[var(--gr-text)] text-[12px] font-medium cursor-pointer transition-colors duration-150"
              >
                Reload app
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
