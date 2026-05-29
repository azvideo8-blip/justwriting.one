import { reportError } from './reportError';

type LogLevel = 'error' | 'warn' | 'info';

function log(level: LogLevel, context: string, message: string, data?: Record<string, unknown>): void {
  if (import.meta.env.DEV) {
    if (level === 'error') console.error(`[${context}] ${message}`, data ?? '');
    else if (level === 'warn') console.warn(`[${context}] ${message}`, data ?? '');
    else console.info(`[${context}] ${message}`, data ?? '');
  }

  if (level === 'error') {
    reportError(new Error(message), { context, ...data });
  }
}

export const logger = {
  error: (context: string, message: string, data?: Record<string, unknown>) => log('error', context, message, data),
  warn: (context: string, message: string, data?: Record<string, unknown>) => log('warn', context, message, data),
  info: (context: string, message: string, data?: Record<string, unknown>) => log('info', context, message, data),
};
