import { createContext, useContext } from 'react';

/**
 * Право человека на мобильный макет (MB-1).
 *
 * Отвечает база: `public.mobile_layout_allowed()` из миграции 0041 — true для
 * админа и для uid из `public.service_accounts`. Значение читает один провайдер
 * (`src/app/MobileLayoutAccessProvider.tsx`) и раздаёт контекстом, чтобы 15
 * потребителей `useLayoutMode` не сделали по RPC на каждый.
 *
 * Хранится только в памяти: ответ принадлежит аккаунту, а не устройству, и при
 * смене аккаунта (F-3) прежний ответ не должен переехать вместе с localStorage.
 * По умолчанию false — гость, отказ RPC и «ещё не прочитано» дают десктопный
 * макет.
 */
export const MobileLayoutAccessContext = createContext(false);

export function useMobileLayoutAccess(): boolean {
  return useContext(MobileLayoutAccessContext);
}
