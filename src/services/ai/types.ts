export type AIMessageRole = 'user' | 'assistant' | 'system';
export type AITutorIntent =
  | 'explain'
  | 'solve'
  | 'hint'
  | 'practice'
  | 'quiz'
  | 'summarize'
  | 'review'
  | 'translate'
  | 'grammar'
  | 'vocabulary'
  | 'writing'
  | 'reading'
  | 'speaking'
  | 'concept-check';

export type AIAvatarState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'happy' | 'confused' | 'surprised';
export type AICompanionMode = 'Teacher' | 'Companion' | 'Coach';

export interface AIMessage {
  id: string;
  role: AIMessageRole;
  content: string;
  timestamp: number;
  language: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface AIConversationRequest {
  companionId: string;
  companionName: string;
  mode: AICompanionMode;
  language: string;
  learningLanguage: string;
  userInput: string;
  interactionType?: AITutorIntent;
  currentTopic?: string;
  currentGoal?: string;
  messages: AIMessage[];
}

export interface AIResponse {
  text: string;
  language: string;
  educationalIntent: AITutorIntent;
  suggestedAvatarState: AIAvatarState;
  suggestedAction?: string;
  provider?: string;
  mock?: boolean;
}

export const SAFE_AVATAR_STATES: ReadonlySet<AIAvatarState> = new Set([
  'idle',
  'listening',
  'thinking',
  'speaking',
  'happy',
  'confused',
  'surprised',
]);
