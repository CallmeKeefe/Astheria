import type { ISpeechSynthesisProvider, SpeechSynthesisOptions, VoiceInfo } from '../../../types/audio';

/**
 * Provider for browser-based text-to-speech using window.speechSynthesis.
 */
export class BrowserSpeechSynthesisProvider implements ISpeechSynthesisProvider {
  private synth: SpeechSynthesis | null = null;
  private voices: VoiceInfo[] = [];
  private voicesLoadedPromise: Promise<VoiceInfo[]> | null = null;
  
  // Track active utterance to manage cleanup
  private currentUtterance: SpeechSynthesisUtterance | null = null;

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.synth = window.speechSynthesis;
      
      // Some browsers load voices asynchronously
      if (this.synth.onvoiceschanged !== undefined) {
        this.synth.onvoiceschanged = () => this.loadVoices();
      }
      this.loadVoices(); // Try to load immediately as well
    }
  }

  public get isSupported(): boolean {
    return this.synth !== null;
  }

  private loadVoices(): VoiceInfo[] {
    if (!this.synth) return [];
    
    const browserVoices = this.synth.getVoices();
    this.voices = browserVoices.map((v) => ({
      id: v.voiceURI,
      name: v.name,
      language: v.lang,
      baseLanguage: v.lang.split('-')[0],
      localService: v.localService,
      default: v.default,
      isDefault: v.default,
      provider: 'browser-synthesis'
    }));
    return this.voices;
  }

  public async getVoices(): Promise<VoiceInfo[]> {
    if (!this.synth) return [];
    
    // If voices are already loaded, return them
    if (this.voices.length > 0) return this.voices;

    // Wait for voices to load if they aren't available yet
    if (!this.voicesLoadedPromise) {
      this.voicesLoadedPromise = new Promise((resolve) => {
        let attempts = 0;
        const checkInterval = setInterval(() => {
          const loaded = this.loadVoices();
          if (loaded.length > 0 || attempts > 20) { // Timeout after ~2s
            clearInterval(checkInterval);
            resolve(loaded);
          }
          attempts++;
        }, 100);
      });
    }

    return this.voicesLoadedPromise;
  }

  public async speak(text: string, options?: SpeechSynthesisOptions): Promise<void> {
    if (!this.synth) {
      options?.onError?.(new Error('SpeechSynthesis not supported'));
      return Promise.reject('Not supported');
    }

    // Cancel any ongoing speech
    this.stop();

    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);
      this.currentUtterance = utterance;

      if (options?.volume !== undefined) utterance.volume = options.volume;
      if (options?.rate !== undefined) utterance.rate = options.rate;
      if (options?.pitch !== undefined) utterance.pitch = options.pitch;
      
      if (options?.language) utterance.lang = options.language;

      if (options?.voice) {
        const browserVoice = this.synth!.getVoices().find(v => v.voiceURI === options.voice!.id);
        if (browserVoice) {
          utterance.voice = browserVoice;
        }
      }

      utterance.onstart = () => {
        options?.onStart?.();
      };

      utterance.onend = () => {
        if (this.currentUtterance === utterance) {
          this.currentUtterance = null;
        }
        options?.onEnd?.();
        resolve();
      };

      utterance.onerror = (event) => {
        if (this.currentUtterance === utterance) {
          this.currentUtterance = null;
        }
        // Don't treat cancellation as an error necessarily, but notify
        if (event.error !== 'canceled') {
          options?.onError?.(event);
          reject(event);
        } else {
          // If canceled, resolve normally but early
          options?.onEnd?.(); 
          resolve();
        }
      };

      this.synth!.speak(utterance);
    });
  }

  public pause(): void {
    if (this.synth && this.synth.speaking && !this.synth.paused) {
      this.synth.pause();
    }
  }

  public resume(): void {
    if (this.synth && this.synth.paused) {
      this.synth.resume();
    }
  }

  public stop(): void {
    if (this.synth) {
      this.synth.cancel();
    }
    this.currentUtterance = null;
  }

  public isSpeaking(): boolean {
    return this.synth !== null && (this.synth.speaking || this.synth.pending);
  }

  public dispose(): void {
    this.stop();
    if (this.synth && this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = null;
    }
    this.synth = null;
    this.voices = [];
  }
}
