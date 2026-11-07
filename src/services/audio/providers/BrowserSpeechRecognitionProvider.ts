import type { ISpeechRecognitionProvider, SpeechRecognitionOptions } from '../../../types/audio';

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}

interface RecognitionEvent {
  resultIndex: number;
  results: { length: number; [index: number]: RecognitionResult };
}

interface RecognitionErrorEvent {
  error?: string;
}

interface RecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionConstructor = new () => RecognitionInstance;

/**
 * Browser SpeechRecognition owns its microphone stream internally. This provider
 * controls recognition, but it does not claim ownership of raw MediaStream tracks.
 */
export class BrowserSpeechRecognitionProvider implements ISpeechRecognitionProvider {
  private recognition: RecognitionInstance | null = null;
  private listening = false;
  private RecognitionClass: RecognitionConstructor | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      const browserWindow = window as Window & {
        SpeechRecognition?: RecognitionConstructor;
        webkitSpeechRecognition?: RecognitionConstructor;
      };
      this.RecognitionClass = browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition || null;
    }
  }

  public get isSupported(): boolean {
    return this.RecognitionClass !== null;
  }

  public start(options?: SpeechRecognitionOptions): void {
    if (!this.RecognitionClass) {
      options?.onError?.(new Error('SpeechRecognition not supported in this browser.'));
      return;
    }

    if (this.listening) this.stop();
    const recognition = new this.RecognitionClass();
    this.recognition = recognition;
    recognition.continuous = true;
    recognition.interimResults = options?.interimResults ?? true;
    recognition.maxAlternatives = options?.maxAlternatives ?? 1;
    if (options?.language) recognition.lang = options.language;

    recognition.onstart = () => {
      this.listening = true;
      options?.onStart?.();
    };
    recognition.onresult = (event) => {
      let finalTranscript = '';
      let interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalTranscript += result[0].transcript;
        else interimTranscript += result[0].transcript;
      }
      if (finalTranscript) options?.onResult?.(finalTranscript.trim(), true);
      if (interimTranscript) options?.onResult?.(interimTranscript.trim(), false);
    };
    recognition.onerror = (event) => {
      if (event.error !== 'no-speech') options?.onError?.(event);
    };
    recognition.onend = () => {
      this.listening = false;
      options?.onEnd?.();
    };

    try {
      recognition.start();
    } catch (error) {
      this.listening = false;
      options?.onError?.(error);
    }
  }

  public stop(): void {
    if (this.recognition && this.listening) this.recognition.stop();
    this.listening = false;
  }

  public abort(): void {
    if (this.recognition && this.listening) this.recognition.abort();
    this.listening = false;
  }

  public isListening(): boolean {
    return this.listening;
  }

  public dispose(): void {
    this.abort();
    this.recognition = null;
  }
}
