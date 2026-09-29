/** Название и дата заметки для правила строгого хода: «Аскеза», «29 сентября 2026 г.». */
export function noteMetaFor(doc: { title?: string | undefined; lastSessionAt?: number | undefined; firstSessionAt?: number | undefined }): { title: string; date: string } {
  const ts = doc.lastSessionAt ?? doc.firstSessionAt;
  return {
    title: doc.title || 'Без названия',
    // Дата заметки, а не дата отправки: иначе разбор «от 29 июля» у записи от 29 сентября.
    date: ts ? new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '',
  };
}
