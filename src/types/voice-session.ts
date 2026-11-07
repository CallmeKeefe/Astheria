import type { VoiceInfo } from './audio';

export type VoiceSessionState =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'paused'
  | 'stopping'
  | 'error'
  | 'unsupported';

export type VoiceErrorCode =
  | 'unsupported'
  | 'permission-denied'
  | 'no-speech'
  | 'synthesis-error'
  | 'recognition-error'
  | 'audio-error'
  | 'cancelled'
  | 'unknown';

export interface VoiceError {
  code: VoiceErrorCode;
  message: string;
  cause?: unknown;
}

export interface VoiceCapabilities {
  speechSynthesis: { supported: boolean; available: boolean };
  speechRecognition: { supported: boolean; available: boolean };
  audioContext: { supported: boolean; state: 'uninitialized' | AudioContextState | 'unsupported' };
  microphone: { permission: PermissionState | 'unknown' };
  voices: { count: number; loaded: boolean };
}

export interface VoiceSessionSnapshot {
  state: VoiceSessionState;
  transcript: { interim: string; final: string };
  voices: VoiceInfo[];
  capabilities: VoiceCapabilities;
  lastError: VoiceError | null;
}

export interface VoiceSessionEvents {
  'state-changed': { state: VoiceSessionState; previousState: VoiceSessionState };
  'listening-started': { requestId: number };
  'interim-transcript': { text: string; requestId: number };
  'final-transcript': { text: string; requestId: number };
  'listening-ended': { requestId: number };
  'speaking-started': { requestId: number };
  'speaking-paused': { requestId: number };
  'speaking-resumed': { requestId: number };
  'speaking-ended': { requestId: number };
  'speaking-cancelled': { requestId: number };
  error: { error: VoiceError; requestId?: number };
  'support-changed': { capabilities: VoiceCapabilities };
}
