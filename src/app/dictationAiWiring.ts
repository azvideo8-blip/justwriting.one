import { isDictationNoteHidden, punctuateDictation, willPunctuate } from '../features/ai/services/punctuateDictation';
import { registerDictationAi } from '../features/writing/hooks/useDictation';

// D-4: мостик features/writing → features/ai.
//
// Writing не имеет права импортировать другой фичевый модуль (eslint-зона
// no-restricted-paths, ARCHITECTURE.md), а диктовке нужна пунктуация из ai.
// Разрешение собирается здесь, в app-слое, где такие связи и положены: панель ИИ
// в редакторе точно так же подключается снаружи. Импорт этого модуля из
// WritingPage происходит ради побочного эффекта — до первого рендера кнопок.
registerDictationAi({
  punctuate: punctuateDictation,
  willPunctuate,
  noteHidden: isDictationNoteHidden,
});
