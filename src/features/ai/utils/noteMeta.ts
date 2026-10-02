import { NOTE_SCOPE_TITLE_MAX, type NoteScope } from '../../../shared/ai/buildChatPrompt';

/** Название и дата заметки для правила строгого хода: «Аскеза», «29 сентября 2026 г.». */
export function noteMetaFor(doc: { title?: string | undefined; lastSessionAt?: number | undefined; firstSessionAt?: number | undefined }): { title: string; date: string } {
  const ts = doc.lastSessionAt ?? doc.firstSessionAt;
  return {
    title: doc.title || 'Без названия',
    // Дата заметки, а не дата отправки: иначе разбор «от 29 июля» у записи от 29 сентября.
    date: ts ? new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '',
  };
}

/**
 * S-56: правило строгого хода для сервера. Название режется до предела схемы:
 * импортированное название в 301–500 знаков или три склеенных по 100 давали
 * 400 на каждом строгом ходе.
 */
export function noteScopeFor(mode: NoteScope['mode'], note: { title?: string | undefined; date?: string | undefined } | null | undefined): NoteScope {
  return {
    mode,
    title: (note?.title ?? 'приложенная заметка').slice(0, NOTE_SCOPE_TITLE_MAX),
    date: (note?.date ?? '').slice(0, 60),
  };
}
