import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

function formatBoundaryMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as { error?: string; path?: string | null };
      if (parsed && typeof parsed.error === 'string' && parsed.error.trim()) {
        return parsed.error.trim();
      }
    } catch {
      // Fall back to raw message
    }
  }
  return raw || 'An unexpected interface fault occurred.';
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: formatBoundaryMessage(error),
    };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    console.error('ULTRON UI ErrorBoundary caught error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#06070A] px-4 text-slate-100">
          <div className="w-full max-w-md rounded-2xl border border-red-500/35 bg-[#0D1017] p-6 text-center shadow-2xl">
            <h1 className="font-display text-xl font-semibold text-white">
              Neural Interface Interrupted
            </h1>
            <p className="mt-2 text-xs leading-relaxed text-slate-300">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="ultron-accent-bg mt-5 inline-flex min-h-[42px] items-center justify-center rounded-lg px-5 py-2 text-xs font-semibold text-white transition-colors"
            >
              Reload Terminal
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
