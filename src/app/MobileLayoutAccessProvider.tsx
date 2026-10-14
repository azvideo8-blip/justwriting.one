import { useEffect, useState, type ReactNode } from 'react';
import { getSupabase } from '../core/supabase/client';
import { useAuth } from '../features/auth/contexts/AuthContext';
import { MobileLayoutAccessContext, MobileLayoutAccessAnsweredContext } from '../shared/hooks/useMobileLayoutAccess';
import { reportError } from '../shared/errors/reportError';

/**
 * MB-1: читает право на мобильный макет один раз на вошедшего пользователя.
 *
 * Ответ привязан к uid в state, а не хранится отдельно: при смене аккаунта
 * прежний ответ перестаёт совпадать с текущим uid и трактуется как «неизвестно»,
 * то есть десктоп. Перегрузка не нужна.
 *
 * Неизвестно, отказ, гость — desktop. Прав на чтение `service_accounts` у клиента
 * нет (0040, deny-all), поэтому спрашиваем функцию, а не таблицу.
 */
export function MobileLayoutAccessProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [answer, setAnswer] = useState<{ uid: string; allowed: boolean } | null>(null);

  useEffect(() => {
    if (uid === null) return;
    let discarded = false;

    const read = async (): Promise<void> => {
      try {
        const { data, error } = await getSupabase().rpc('mobile_layout_allowed');
        if (discarded) return;
        if (error != null) {
          reportError(error, { action: 'mobileLayoutAccess_rpc', uid }, 'warning');
          setAnswer({ uid, allowed: false });
          return;
        }
        setAnswer({ uid, allowed: data === true });
      } catch (e) {
        if (discarded) return;
        reportError(e, { action: 'mobileLayoutAccess_rpc', uid }, 'warning');
        setAnswer({ uid, allowed: false });
      }
    };
    void read();

    return () => { discarded = true; };
  }, [uid]);

  const allowed = uid !== null && answer !== null && answer.uid === uid && answer.allowed;
  // MC-6: «ответа ещё нет» и «ответа нет, потому что отказано» — разные
  // состояния. Окно первого входа держит паузу ровно до первого из них.
  const answered = uid === null || (answer !== null && answer.uid === uid);

  return (
    <MobileLayoutAccessAnsweredContext.Provider value={answered}>
      <MobileLayoutAccessContext.Provider value={allowed}>
        {children}
      </MobileLayoutAccessContext.Provider>
    </MobileLayoutAccessAnsweredContext.Provider>
  );
}
