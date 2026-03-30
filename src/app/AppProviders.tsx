import { UIProvider } from '../contexts/UIContext';
import { ErrorBoundary } from '../shared/components/ErrorBoundary';
import { ReactNode } from 'react';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <UIProvider>
      <ErrorBoundary>
        {children}
      </ErrorBoundary>
    </UIProvider>
  );
}
