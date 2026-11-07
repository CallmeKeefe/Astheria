import { BrowserSpeechSynthesisProvider } from './providers/BrowserSpeechSynthesisProvider';
import type { ISpeechSynthesisProvider, SpeechSynthesisOptions, VoiceInfo } from '../../types/audio';

/**
 * High-level orchestration for speech output.
 */
export class SpeechOutputService {
  private provider: ISpeechSynthesisProvider;

  constructor() {
    this.provider = new BrowserSpeechSynthesisProvider();
  }

  public get isSupported(): boolean {
    return this.provider.isSupported;
  }

  public async getVoices(): Promise<VoiceInfo[]> {
    return this.provider.getVoices();
  }

  /**
   * Speaks text using the underlying provider and automatically updates avatar state.
   */
  public async speak(text: string, options?: SpeechSynthesisOptions): Promise<void> {
    if (!this.provider.isSupported) {
      return Promise.reject(new Error('Speech Synthesis not supported'));
    }

    return this.provider.speak(text, options);
  }

  public pause(): void {
    this.provider.pause();
  }

  public resume(): void {
    this.provider.resume();
  }

  public stop(): void {
    this.provider.stop();
  }

  public isSpeaking(): boolean {
    return this.provider.isSpeaking();
  }

  public dispose(): void {
    this.provider.dispose();
  }
}

export const speechOutputService = new SpeechOutputService();
