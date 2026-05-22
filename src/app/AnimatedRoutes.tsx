import { useLayoutKeyboardShortcut } from './useLayoutKeyboardShortcut';
import { AppShell } from './AppShell';

export function AnimatedRoutes() {
  useLayoutKeyboardShortcut();
  return <AppShell />;
}
