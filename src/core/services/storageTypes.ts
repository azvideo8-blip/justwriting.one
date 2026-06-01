export interface StorageState {
  local: boolean;
  cloud: boolean;
}

export interface SaveDocumentData {
  title: string;
  content: string;
  wordCount: number;
  documentWordCount?: number;
  duration: number;
  wpm: number;
  tags: string[];
  labelId?: string;
  goalWords?: number;
  goalTime?: number;
  goalReached?: boolean;
  sessionStartedAt: Date;
  mood?: string;
}
