/**
 * AudioManager handles Web Audio API infrastructure.
 * Responsible for the AudioContext, master gain, and overall routing.
 */
export class AudioManager {
  private _context: AudioContext | null = null;
  private _masterGain: GainNode | null = null;
  
  /**
   * Lazily initializes the AudioContext to respect browser autoplay policies.
   * Call this from a user interaction event.
   */
  public get isSupported(): boolean {
    return typeof window !== 'undefined' && Boolean(window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  }

  public getContext(): AudioContext {
    if (!this.isSupported) {
      throw new Error('Web Audio API is not supported in this browser.');
    }
    if (!this._context) {
      // Use standard AudioContext, fallback to webkitAudioContext for older Safari
      const browserWindow = window as Window & { webkitAudioContext?: typeof AudioContext };
      const AudioContextClass = window.AudioContext || browserWindow.webkitAudioContext;
      this._context = new AudioContextClass();
      this._masterGain = this._context.createGain();
      this._masterGain.connect(this._context.destination);
    }
    return this._context;
  }

  /**
   * Resumes the AudioContext if it was suspended (e.g., due to autoplay policies).
   */
  public async resumeContext(): Promise<void> {
    if (!this.isSupported) return;
    const ctx = this.getContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
  }

  public get contextState(): AudioContextState | 'uninitialized' | 'unsupported' {
    if (!this.isSupported) return 'unsupported';
    return this._context ? this._context.state : 'uninitialized';
  }

  public get masterGain(): GainNode | null {
    return this._masterGain;
  }

  /**
   * Sets the master volume for all audio routed through this manager.
   */
  public setVolume(volume: number): void {
    if (this._masterGain && this._context) {
      this._masterGain.gain.setTargetAtTime(volume, this._context.currentTime, 0.05);
    }
  }

  /**
   * Disposes of the AudioContext and all its nodes.
   */
  public dispose(): void {
    if (this._context) {
      this._masterGain?.disconnect();
      this._context.close().catch(console.error);
      this._context = null;
      this._masterGain = null;
    }
  }
}

export const audioManager = new AudioManager();
