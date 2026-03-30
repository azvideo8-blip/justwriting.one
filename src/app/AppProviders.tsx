import { UIProvider } from '../contexts/UIContext';
import { WritingSettingsProvider } from '../features/writing/contexts/WritingSettingsContext';
import { ErrorBoundary } from '../shared/components/ErrorBoundary';
import { ReactNode } from 'react';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <UIProvider>
      <WritingSettingsProvider>
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
      </WritingSettingsProvider>
    </UIProvider>
  );
}
