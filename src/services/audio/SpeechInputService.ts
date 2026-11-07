import { BrowserSpeechRecognitionProvider } from './providers/BrowserSpeechRecognitionProvider';
import type { ISpeechRecognitionProvider, SpeechRecognitionOptions } from '../../types/audio';

/**
 * High-level orchestration for speech input/listening.
 */
export class SpeechInputService {
  private provider: ISpeechRecognitionProvider;

  constructor() {
    this.provider = new BrowserSpeechRecognitionProvider();
  }

  public get isSupported(): boolean {
    return this.provider.isSupported;
  }

  public startListening(options?: SpeechRecognitionOptions): void {
    if (!this.provider.isSupported) {
      options?.onError?.(new Error('Speech Recognition not supported'));
      return;
    }

    this.provider.start(options);
  }

  public stopListening(): void {
    this.provider.stop();
  }

  public abortListening(): void {
    this.provider.abort();
  }

  public isListening(): boolean {
    return this.provider.isListening();
  }

  public dispose(): void {
    this.provider.dispose();
  }
}

export const speechInputService = new SpeechInputService();
