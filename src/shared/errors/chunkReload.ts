/**
 * vite:preloadError: перезагрузка страницы лечит только одно — выкатка сменила
 * имена чанков, и старого файла на сервере больше нет (404). Сбой сети (VPN, не
 * пропускающий до сервера, обрыв связи) перезагрузкой не лечится: фоновый проход
 * повторял импорт каждые две минуты, и страница перезагружалась посреди письма.
 */
export async function chunkIsGone(message: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  const url = /https?:\/\/\S+?\.js\b/.exec(message)?.[0];
  if (!url) return true; // не знаем, какой чанк, — прежнее поведение: перезагрузить
  try {
    const res = await fetchFn(url, { method: 'HEAD', cache: 'no-store' });
    return res.status === 404;
  } catch {
    return false; // сеть недоступна — это не выкатка
  }
}
