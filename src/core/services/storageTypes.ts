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
  mood?: string | undefined;
}
