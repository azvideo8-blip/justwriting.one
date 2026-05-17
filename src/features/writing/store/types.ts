export type TimerStatus = 'idle' | 'writing' | 'paused';
export type SessionType = 'free' | 'stopwatch' | 'timer' | 'words' | 'finish-by';
export interface WordSnapshot { timestamp: number; wordCount: number; }
