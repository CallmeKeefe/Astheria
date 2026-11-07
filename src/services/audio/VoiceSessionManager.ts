import type { VoiceInfo, SpeechSynthesisOptions, SpeechRecognitionOptions } from '../../types/audio';
import type {
  VoiceCapabilities,
  VoiceError,
  VoiceErrorCode,
  VoiceSessionEvents,
  VoiceSessionSnapshot,
  VoiceSessionState,
} from '../../types/voice-session';
import { audioManager } from './AudioManager';
import { speechInputService } from './SpeechInputService';
import { speechOutputService } from './SpeechOutputService';

type EventName = keyof VoiceSessionEvents;
type Listener<K extends EventName> = (payload: VoiceSessionEvents[K]) => void;

export class VoiceSessionManager {
  private readonly listeners = new Map<EventName, Set<(payload: never) => void>>();
  private state: VoiceSessionState = 'idle';
  private transcript = { interim: '', final: '' };
  private voices: VoiceInfo[] = [];
  private lastError: VoiceError | null = null;
  private requestId = 0;
  private listeningRequest = 0;
  private speakingRequest = 0;

  public get snapshot(): VoiceSessionSnapshot {
    return {
      state: this.state,
      transcript: { ...this.transcript },
      voices: [...this.voices],
      capabilities: this.getCapabilities(),
      lastError: this.lastError,
    };
  }

  public on<K extends EventName>(event: K, listener: Listener<K>): () => void {
    let listeners = this.listeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(event, listeners);
    }
    const typedListener = listener as (payload: never) => void;
    listeners.add(typedListener);
    return () => listeners?.delete(typedListener);
  }

  public async loadVoices(): Promise<VoiceInfo[]> {
    this.voices = await speechOutputService.getVoices();
    this.emit('support-changed', { capabilities: this.getCapabilities() });
    return [...this.voices];
  }

  public getCapabilities(): VoiceCapabilities {
    const audioState = audioManager.contextState;
    return {
      speechSynthesis: {
        supported: speechOutputService.isSupported,
        available: speechOutputService.isSupported && this.voices.length > 0,
      },
      speechRecognition: {
        supported: speechInputService.isSupported,
        available: speechInputService.isSupported,
      },
      audioContext: {
        supported: audioManager.isSupported,
        state: audioState,
      },
      microphone: { permission: this.getMicrophonePermission() },
      voices: { count: this.voices.length, loaded: this.voices.length > 0 },
    };
  }

  public async startListening(language?: string): Promise<void> {
    const id = ++this.requestId;
    this.listeningRequest = id;
    this.transcript = { interim: '', final: '' };
    this.lastError = null;
    if (!speechInputService.isSupported) {
      this.setError('unsupported', 'Speech recognition is not supported in this browser.', id);
      this.setState('unsupported');
      return;
    }

    this.setState('listening');
    speechInputService.startListening(this.createRecognitionOptions(id, language));
  }

  public stopListening(): void {
    const id = this.listeningRequest;
    this.listeningRequest = ++this.requestId;
    speechInputService.stopListening();
    if (this.state === 'listening') {
      this.setState('idle');
      this.emit('listening-ended', { requestId: id });
    }
  }

  public async speak(text: string, options?: SpeechSynthesisOptions): Promise<void> {
    const id = ++this.requestId;
    this.speakingRequest = id;
    this.lastError = null;
    if (!speechOutputService.isSupported) {
      this.setError('unsupported', 'Speech synthesis is not supported in this browser.', id);
      this.setState('unsupported');
      return;
    }

    try {
      await speechOutputService.speak(text, {
        ...options,
        onStart: () => {
          if (this.speakingRequest !== id) return;
          this.setState('speaking');
          this.emit('speaking-started', { requestId: id });
          options?.onStart?.();
        },
        onEnd: () => {
          if (this.speakingRequest !== id) return;
          this.setState('idle');
          this.emit('speaking-ended', { requestId: id });
          options?.onEnd?.();
        },
        onError: (error) => {
          if (this.speakingRequest !== id) return;
          const code: VoiceErrorCode = error?.error === 'canceled' ? 'cancelled' : 'synthesis-error';
          this.setError(code, code === 'cancelled' ? 'Speech was cancelled.' : 'Speech synthesis failed.', id, error);
          options?.onError?.(error);
        },
      });
    } catch (error) {
      if (this.speakingRequest === id) {
        this.setError('synthesis-error', 'Speech synthesis failed.', id, error);
      }
    }
  }

  public pauseSpeech(): void {
    if (this.state === 'speaking') {
      speechOutputService.pause();
      this.setState('paused');
      this.emit('speaking-paused', { requestId: this.speakingRequest });
    }
  }

  public resumeSpeech(): void {
    if (this.state === 'paused') {
      speechOutputService.resume();
      this.setState('speaking');
      this.emit('speaking-resumed', { requestId: this.speakingRequest });
    }
  }

  public cancelSpeech(): void {
    const id = this.speakingRequest;
    this.speakingRequest = ++this.requestId;
    speechOutputService.stop();
    if (this.state === 'speaking' || this.state === 'paused') {
      this.setState('idle');
      this.emit('speaking-cancelled', { requestId: id });
    }
  }

  public dispose(): void {
    this.requestId++;
    this.listeners.clear();
    speechInputService.dispose();
    speechOutputService.dispose();
  }

  private createRecognitionOptions(id: number, language?: string): SpeechRecognitionOptions {
    return {
      language,
      interimResults: true,
      onStart: () => {
        if (this.listeningRequest === id) {
          this.setState('listening');
          this.emit('listening-started', { requestId: id });
        }
      },
      onResult: (text, isFinal) => {
        if (this.listeningRequest !== id) return;
        if (isFinal) {
          this.transcript = { interim: '', final: `${this.transcript.final} ${text}`.trim() };
          this.emit('final-transcript', { text, requestId: id });
        } else {
          this.transcript = { ...this.transcript, interim: text };
          this.emit('interim-transcript', { text, requestId: id });
        }
      },
      onEnd: () => {
        if (this.listeningRequest !== id) return;
        this.setState('idle');
        this.emit('listening-ended', { requestId: id });
      },
      onError: (error) => {
        if (this.listeningRequest !== id) return;
        const code: VoiceErrorCode = error?.error === 'not-allowed' ? 'permission-denied' : error?.error === 'no-speech' ? 'no-speech' : 'recognition-error';
        this.setError(code, code === 'permission-denied' ? 'Microphone permission was denied.' : 'Speech recognition failed.', id, error);
      },
    };
  }

  private setState(state: VoiceSessionState): void {
    if (this.state === state) return;
    const previousState = this.state;
    this.state = state;
    this.emit('state-changed', { state, previousState });
  }

  private setError(code: VoiceErrorCode, message: string, requestId: number, cause?: unknown): void {
    this.lastError = { code, message, cause };
    this.setState('error');
    this.emit('error', { error: this.lastError, requestId });
  }

  private getMicrophonePermission(): PermissionState | 'unknown' {
    if (typeof navigator === 'undefined' || !navigator.permissions) return 'unknown';
    return 'unknown';
  }

  private emit<K extends EventName>(event: K, payload: VoiceSessionEvents[K]): void {
    this.listeners.get(event)?.forEach((listener) => listener(payload as never));
  }
}

export const voiceSessionManager = new VoiceSessionManager();
