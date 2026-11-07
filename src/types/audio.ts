export interface VoiceInfo {
  id: string;
  name: string;
  language: string; // e.g. 'en-US'
  baseLanguage: string; // e.g. 'en'
  localService: boolean;
  default: boolean;
  isDefault?: boolean;
  provider: string; // e.g. 'browser-synthesis'
}

export interface SpeechSynthesisOptions {
  voice?: VoiceInfo;
  language?: string;
  rate?: number; // 0.1 to 10
  pitch?: number; // 0 to 2
  volume?: number; // 0 to 1
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: any) => void;
}

export interface ISpeechSynthesisProvider {
  isSupported: boolean;
  getVoices(): Promise<VoiceInfo[]>;
  speak(text: string, options?: SpeechSynthesisOptions): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  isSpeaking(): boolean;
  dispose(): void;
}

export interface SpeechRecognitionOptions {
  language?: string;
  interimResults?: boolean;
  maxAlternatives?: number;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: any) => void;
  onResult?: (text: string, isFinal: boolean) => void;
}

export interface ISpeechRecognitionProvider {
  isSupported: boolean;
  start(options?: SpeechRecognitionOptions): void;
  stop(): void;
  abort(): void;
  isListening(): boolean;
  dispose(): void;
}
