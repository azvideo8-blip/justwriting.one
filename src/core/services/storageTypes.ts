export interface StorageState {
  local: boolean;
  cloud: boolean;
}

export interface SaveDocumentData {
  title: string;
  content: string;
  wordCount: number;
  documentWordCount?: number | undefined;
  duration: number;
  wpm: number;
  tags: string[];
  labelId?: string | undefined;
  goalWords?: number | undefined;
  goalTime?: number | undefined;
  goalReached?: boolean | undefined;
  sessionStartedAt: Date;
  /**
   * Явная дата самой заметки. Отличается от sessionStartedAt: это не «когда
   * начался подход», а «когда была написана заметка» — импорту старого
   * дневника её неоткуда взять, кроме как из файла. saveNew пишет ею
   * firstSessionAt/lastSessionAt документа и savedAt первой версии; список
   * заметок, календарь, стрик и «в этот день» считаются по этим полям.
   */
  documentDate?: Date | undefined;
  mood?: string | undefined;
}
