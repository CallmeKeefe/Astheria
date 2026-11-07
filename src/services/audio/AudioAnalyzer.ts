import { AudioManager } from './AudioManager';

export interface AudioAnalyzerConfig {
  fftSize?: number;
  smoothingTimeConstant?: number;
  minDecibels?: number;
  maxDecibels?: number;
}

/**
 * AudioAnalyzer calculates volume and frequencies from an AudioNode.
 * Designed to avoid per-frame allocations and be reusable for future lip-sync.
 */
export class AudioAnalyzer {
  private audioManager: AudioManager;
  private analyser: AnalyserNode | null = null;
  private dataArray: Uint8Array<ArrayBuffer> | null = null;
  private floatDataArray: Float32Array<ArrayBuffer> | null = null;
  
  private enabled: boolean = true;
  private currentAmplitude: number = 0;
  private currentPeak: number = 0;
  
  // Threshold above which we consider the audio to contain 'meaningful energy'
  private readonly ENERGY_THRESHOLD = 0.05;

  constructor(audioManager: AudioManager, config?: AudioAnalyzerConfig) {
    this.audioManager = audioManager;
    if (audioManager.contextState !== 'uninitialized' && audioManager.contextState !== 'unsupported') {
      this.initAnalyser(config);
    }
  }

  /**
   * Connects a source node to this analyzer.
   */
  public connectSource(sourceNode: AudioNode): void {
    if (!this.audioManager.isSupported) return;
    if (!this.analyser) {
      this.initAnalyser();
    }
    if (this.analyser) {
      sourceNode.connect(this.analyser);
    }
  }
  
  public getAnalyserNode(): AnalyserNode | null {
    return this.analyser;
  }

  private initAnalyser(config?: AudioAnalyzerConfig): void {
    if (!this.audioManager.isSupported) return;
    const ctx = this.audioManager.getContext();
    this.analyser = ctx.createAnalyser();
    
    this.analyser.fftSize = config?.fftSize ?? 512;
    this.analyser.smoothingTimeConstant = config?.smoothingTimeConstant ?? 0.8;
    
    if (config?.minDecibels !== undefined) this.analyser.minDecibels = config.minDecibels;
    if (config?.maxDecibels !== undefined) this.analyser.maxDecibels = config.maxDecibels;
    
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.floatDataArray = new Float32Array(this.analyser.fftSize);
    
    // Connect analyzer to master gain so analyzed audio passes through to output
    const master = this.audioManager.masterGain;
    if (master) {
      this.analyser.connect(master);
    }
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.currentAmplitude = 0;
      this.currentPeak = 0;
    }
  }

  /**
   * Updates the amplitude data. Should be called in the render loop or on demand.
   * Modifies internal cached values without allocating objects.
   */
  public update(): void {
    if (!this.enabled || !this.analyser || !this.floatDataArray) {
      return;
    }

    // Time domain data for amplitude
    this.analyser.getFloatTimeDomainData(this.floatDataArray);
    
    let sumSquares = 0;
    let peak = 0;
    
    for (let i = 0; i < this.floatDataArray.length; i++) {
      const val = this.floatDataArray[i];
      sumSquares += val * val;
      const absVal = Math.abs(val);
      if (absVal > peak) {
        peak = absVal;
      }
    }
    
    // RMS (Root Mean Square) for average amplitude
    const rms = Math.sqrt(sumSquares / this.floatDataArray.length);
    
    this.currentAmplitude = rms;
    this.currentPeak = peak;
  }

  public get amplitude(): number {
    return this.currentAmplitude;
  }

  public get peak(): number {
    return this.currentPeak;
  }

  public get hasEnergy(): boolean {
    return this.currentAmplitude > this.ENERGY_THRESHOLD;
  }
  
  public get frequencyData(): Uint8Array<ArrayBuffer> | null {
    if (this.analyser && this.dataArray && this.enabled) {
      this.analyser.getByteFrequencyData(this.dataArray);
      return this.dataArray;
    }
    return null;
  }

  public dispose(): void {
    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }
    this.dataArray = null;
    this.floatDataArray = null;
  }
}
