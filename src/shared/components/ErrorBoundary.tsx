import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      let displayMessage = 'Something went wrong.';
      
      try {
        if (this.state.error?.message) {
          const parsed = JSON.parse(this.state.error.message);
          if (parsed.error && parsed.operationType) {
            displayMessage = `Firestore Error (${parsed.operationType}): ${parsed.error}`;
          }
        }
      } catch (e) {
        // Not a JSON error message
        displayMessage = this.state.error?.message || displayMessage;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-surface-base p-6">
          <div className="max-w-md w-full bg-surface-card p-8 rounded-3xl border border-border-subtle shadow-xl text-center space-y-6">
            <div className="w-16 h-16 bg-red-500/10 text-red-400 rounded-full flex items-center justify-center mx-auto">
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            </div>
            <h2 className="text-2xl font-bold text-text-main">Oops! An error occurred</h2>
            <p className="text-text-main/70 text-sm break-words">
              {displayMessage}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-text-main text-surface-base py-3 rounded-xl font-bold hover:scale-[1.02] transition-transform"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
