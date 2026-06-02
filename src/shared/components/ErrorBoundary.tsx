import { Component, ErrorInfo, ReactNode } from 'react';
import { reportError } from '../../shared/errors/reportError';
import { translations } from '../../shared/i18n';
import { Button } from './Button';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorKey: number;
  errorMessage: string;
  errorStack: string;
  showStack: boolean;
  error: Error | null;
}

function errorCode(message: string): string {
  let hash = 0;
  for (let i = 0; i < message.length; i++) {
    hash = (hash << 5) - hash + message.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).slice(0, 6).toUpperCase();
}

function buildMailto(error: Error, code: string): string {
  const subject = encodeURIComponent(`Error ERR-${code}`);
  const body = encodeURIComponent(
    `Code: ERR-${code}\n` +
    `Time: ${new Date().toISOString()}\n` +
    `URL: ${window.location.pathname}\n\n` +
    `Message:\n${error.message.slice(0, 200)}\n`
  );
  return `mailto:support@justwriting.one?subject=${subject}&body=${body}`;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorKey: 0,
    errorMessage: '',
    errorStack: '',
    showStack: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorKey: Date.now(), errorMessage: error.message, errorStack: error.stack || '', showStack: false, error };
  }

  private handleRetry = () => {
    this.setState({ hasError: false, errorKey: Date.now(), showStack: false, error: null });
  };

  private toggleStack = () => {
    this.setState(prev => ({ showStack: !prev.showStack }));
  };

  private handleReload = () => {
    window.location.reload();
  };

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    reportError(error, { componentStack: errorInfo.componentStack });
  }

  public render() {
    if (this.state.hasError) {
      const lang = (() => { try { return (localStorage.getItem('app_language') as 'ru' | 'en') || 'ru'; } catch { return 'ru'; } })();
      const code = errorCode(this.state.errorMessage || 'unknown');
      const _mailtoLink = this.state.error ? buildMailto(this.state.error, code) : '#';
      const t = (key: string) => translations[key as keyof typeof translations]?.[lang] ?? key;
      return (
        <div key={this.state.errorKey} className="min-h-screen flex items-center justify-center bg-surface-base p-6">
          <div className="max-w-md w-full bg-surface-card p-8 rounded-3xl border border-border-subtle shadow-xl text-center space-y-6">
            <div className="w-16 h-16 bg-accent-danger/10 text-accent-danger rounded-full flex items-center justify-center mx-auto">
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            </div>
            <h2 className="text-2xl font-bold text-text-main">{t('error_generic')}</h2>
            <p className="font-mono text-xs text-text-muted">ERR-{code}</p>
            <Button type="button" onClick={this.toggleStack} className="text-label-sm text-text-main/30 hover:text-text-main/60 transition-colors">{this.state.showStack ? (lang === 'ru' ? 'Скрыть детали' : 'Hide details') : (lang === 'ru' ? 'Показать детали' : 'Show details')}</Button>
            {this.state.showStack && import.meta.env.DEV && <pre className="text-left text-accent-danger text-[12px] whitespace-pre-wrap break-all max-h-40 overflow-auto bg-black/30 p-3 rounded-lg">{this.state.errorMessage}

{this.state.errorStack?.slice(0, 500)}</pre>}
            <div className="space-y-3">
              <Button
                type="button"
                onClick={this.handleRetry}
                className="w-full bg-text-main text-surface-base py-3 rounded-xl font-bold hover:scale-[1.02] transition-transform"
              >
                {t('error_retry')}
              </Button>
              <Button
                type="button"
                onClick={this.handleReload}
                className="w-full border border-border-subtle text-text-main py-3 rounded-xl font-bold hover:bg-white/5 transition-colors"
              >
                {t('error_reload')}
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
