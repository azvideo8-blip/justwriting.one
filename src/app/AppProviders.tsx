import { ThemeProvider } from '../core/theme/ThemeProvider';
import { WritingSettingsProvider } from '../features/writing/contexts/WritingSettingsContext';
import { ErrorBoundary } from '../shared/components/ErrorBoundary';
import { ReactNode } from 'react';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <WritingSettingsProvider>
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
      </WritingSettingsProvider>
    </ThemeProvider>
  );
}
