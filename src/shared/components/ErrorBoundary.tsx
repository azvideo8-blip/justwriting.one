import React, { Component, ErrorInfo, ReactNode } from 'react';
import { reportError } from '../../core/errors/reportError';
import { translations } from '../../core/i18n';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorKey: number;
  errorMessage: string;
  errorStack: string;
  showStack: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorKey: 0,
    errorMessage: '',
    errorStack: '',
    showStack: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorKey: Date.now(), errorMessage: error.message, errorStack: error.stack || '', showStack: false };
  }

  private handleRetry = () => {
    this.setState({ hasError: false, errorKey: Date.now(), showStack: false });
  };

  private toggleStack = () => {
    this.setState(prev => ({ showStack: !prev.showStack }));
  };

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    reportError(error, { componentStack: errorInfo.componentStack });
  }

  public render() {
    if (this.state.hasError) {
      const lang = (localStorage.getItem('app_language') as 'ru' | 'en') || 'ru';
      return (
        <div key={this.state.errorKey} className="min-h-screen flex items-center justify-center bg-surface-base p-6">
          <div className="max-w-md w-full bg-surface-card p-8 rounded-3xl border border-border-subtle shadow-xl text-center space-y-6">
            <div className="w-16 h-16 bg-red-500/10 text-red-400 rounded-full flex items-center justify-center mx-auto">
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            </div>
            <h2 className="text-2xl font-bold text-text-main">{translations['error_generic'][lang]}</h2>
            <button onClick={this.toggleStack} className="text-[11px] text-text-main/30 hover:text-text-main/60 transition-colors">{this.state.showStack ? (lang === 'ru' ? 'Скрыть детали' : 'Hide details') : (lang === 'ru' ? 'Показать детали' : 'Show details')}</button>
            {this.state.showStack && <pre className="text-left text-red-400 text-[12px] whitespace-pre-wrap break-all max-h-40 overflow-auto bg-black/30 p-3 rounded-lg">{this.state.errorMessage}\n\n{this.state.errorStack?.slice(0, 500)}</pre>}
            <div className="space-y-3">
              <button
                onClick={this.handleRetry}
                className="w-full bg-text-main text-surface-base py-3 rounded-xl font-bold hover:scale-[1.02] transition-transform"
              >
                {lang === 'ru' ? 'Попробовать снова' : 'Try again'}
              </button>
              <button
                onClick={() => window.location.reload()}
                className="w-full py-3 rounded-xl font-bold border border-border-subtle text-text-main hover:bg-white/5 transition-all"
              >
                {translations['error_reload'][lang]}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
