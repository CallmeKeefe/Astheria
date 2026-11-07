import * as THREE from 'three';
import type { IAvatar } from '../../types/avatar';
import type { GpuInfo, SceneFrameSample, SceneManager } from '../SceneManager';

export type PerformanceLabToggle =
  | 'FULL'
  | 'NO_AVATAR'
  | 'NO_SHADOWS'
  | 'NO_LIGHTING'
  | 'NO_ENVIRONMENT'
  | 'EMPTY_SCENE'
  | 'SIMPLE_CUBE'
  | 'AVATAR_STATIC'
  | 'NO_UI'
  /**
   * Diagnostic-only mode: forces shadows ON so the cost of shadow passes can be
   * measured against a baseline whose quality tier keeps them OFF.
   * The application's original shadow state is captured first and restored after.
   */
  | 'SHADOW_DIAGNOSTIC';

export interface PerformanceLabRendererConfig {
  webglVersion: string;
  qualityTier: string;
  antialias: boolean;
  alpha: boolean;
  powerPreference: string;
  pixelRatio: number;
  outputColorSpace: string;
  toneMapping: number;
  toneMappingExposure: number;
  shadowMapEnabled: boolean;
  shadowMapType: number;
  physicallyCorrectLights: boolean;
  localClippingEnabled: boolean;
  stencil: boolean;
  depth: number;
  preserveDrawingBuffer: boolean;
  canvasWidth: number;
  canvasHeight: number;
  drawingBufferWidth: number;
  drawingBufferHeight: number;
}

export interface PerformanceLabSnapshot {
  enabled: boolean;
  mode: PerformanceLabToggle;
  /** Runtime readiness of the live avatar scene. False means the scene is not measurable. */
  avatarReady: boolean;
  avatarLoaded: boolean;
  avatarInScene: boolean;
  avatarVisible: boolean;
  rendererActive: boolean;
  /** Human readable readiness state, e.g. "AVATAR NOT READY — VRM not parsed yet". */
  readinessMessage: string;
  /** True when measurements must be treated as invalid because no avatar scene is live. */
  blocked: boolean;
  fps: number;
  averageFps: number;
  frameMs: number;
  averageFrameMs: number;
  updateMs: number;
  renderMs: number;
  unexplainedMs: number;
  dpr: number;
  canvasWidth: number;
  canvasHeight: number;
  drawingBufferWidth: number;
  drawingBufferHeight: number;
  drawCalls: number;
  triangles: number;
  points: number;
  lines: number;
  geometries: number;
  textures: number;
  cpu: {
    totalFrameMs: number;
    sceneManagerUpdateMs: number;
    avatarUpdateMs: number;
    animationUpdateMs: number;
    expressionUpdateMs: number;
    vrmUpdateMs: number;
    renderMs: number;
    unexplainedMs: number;
  };
  gpuTiming: string;
  /**
   * Measured GPU time in ms, or `null` when `EXT_disjoint_timer_query_webgl2`
   * is unavailable (in which case `gpuTiming` reads "GPU timing unavailable").
   * Never inferred from the renderer CPU duration.
   */
  gpuMs: number | null;
  /**
   * TRUE wall-clock interval between consecutive `requestAnimationFrame`
   * callbacks. Uncapped — never derived from the simulation delta clamp,
   * `THREE.Clock`, or the PerformanceLab polling interval.
   * For a measurement this is the average across the window.
   */
  rawFrameMs: number;
  /**
   * Frames-per-second derived from `rawFrameMs` only.
   * For a measurement it is `(frameCount - 1) / windowSpan * 1000`.
   */
  rawFPS: number;
  /** The app's clamped simulation delta in ms. Reported for contrast; never used for FPS. */
  simulationDeltaMs: number;
  /** Number of raw frame samples aggregated into this snapshot. */
  frameCount: number;
  /** Actual wall-clock length of the measurement window in ms (0 for live snapshots). */
  measureWindowMs: number;
  longTasks: { available: boolean; count: number; totalMs: number; maxMs: number };
  /** Original (application) vs. currently-measured shadow configuration. */
  shadowState: {
    originalEnabled: boolean;
    measuredEnabled: boolean;
    measuredAutoUpdate: boolean;
    lightsTotal: number;
    lightsCastShadow: number;
    meshesCastShadow: number;
    meshesReceiveShadow: number;
  };
  /** WebGL vendor/renderer via `WEBGL_debug_renderer_info` (diagnostic only). */
  gpuInfo: GpuInfo;
  renderer?: PerformanceLabRendererConfig;
  avatar?: {
    totalObjectCount: number;
    meshCount: number;
    skinnedMeshCount: number;
    materialCount: number;
    uniqueMaterialCount: number;
    textureCount: number;
    textureResolutions: string[];
    /** Largest single texture in the VRM, as `WIDTHxHEIGHT`. */
    maxTextureResolution: string;
    /** Total morph target (blend shape) count across all geometries. */
    morphTargetCount: number;
    transparentMaterialCount: number;
    alphaTestMaterialCount: number;
    emissiveMaterialCount: number;
    expressionCount: number;
    springBoneCount: number;
    colliderCount: number;
    humanoidBoneCount: number;
    shadowCastingMeshes: number;
    shadowReceivingMeshes: number;
  };
}

export interface PerformanceLabMeasurement extends PerformanceLabSnapshot {
  readonly label: string;
  /**
   * The raw per-frame samples this measurement was aggregated from:
   * `timestamp`, `rawFrameMs`, `simulationDeltaMs`, `updateMs`, `renderCpuMs`,
   * `drawCalls`, `triangles` — one entry per rendered frame in the window.
   */
  readonly frames: SceneFrameSample[];
}

/** Per-object shadow flags captured before a diagnostic mode is applied. */
interface ShadowFlagSnapshot {
  object: THREE.Object3D;
  castShadow: boolean;
  /** `null` when the object has no `receiveShadow` property (e.g. lights). */
  receiveShadow: boolean | null;
}

/** The application's exact configuration, captured before any diagnostic mode. */
interface PerformanceLabRestoreState {
  avatarVisible: boolean;
  animationEnabled: boolean;
  /** `AvatarInstance.setUpdateEnabled` — gates the whole avatar update. */
  updateEnabled: boolean;
  vrmUpdateEnabled: boolean;
  shadowEnabled: boolean;
  shadowAutoUpdate: boolean;
  backgroundActive: boolean;
  background: THREE.Scene['background'];
  shadowFlags: ShadowFlagSnapshot[];
  lights: Array<{ visible: boolean; intensity: number }>;
  environmentColor: THREE.ColorRepresentation | null;
  temporaryCube: THREE.Mesh | null;
}

const DEFAULT_SNAPSHOT: PerformanceLabSnapshot = {
  enabled: false,
  mode: 'FULL',
  avatarReady: false,
  avatarLoaded: false,
  avatarInScene: false,
  avatarVisible: false,
  rendererActive: false,
  readinessMessage: 'AVATAR NOT READY — load not started',
  blocked: true,
  fps: 0,
  averageFps: 0,
  frameMs: 0,
  averageFrameMs: 0,
  updateMs: 0,
  renderMs: 0,
  unexplainedMs: 0,
  dpr: 1,
  canvasWidth: 0,
  canvasHeight: 0,
  drawingBufferWidth: 0,
  drawingBufferHeight: 0,
  drawCalls: 0,
  triangles: 0,
  points: 0,
  lines: 0,
  geometries: 0,
  textures: 0,
  cpu: {
    totalFrameMs: 0,
    sceneManagerUpdateMs: 0,
    avatarUpdateMs: 0,
    animationUpdateMs: 0,
    expressionUpdateMs: 0,
    vrmUpdateMs: 0,
    renderMs: 0,
    unexplainedMs: 0,
  },
  gpuTiming: 'GPU timing unavailable',
  gpuMs: null,
  rawFrameMs: 0,
  rawFPS: 0,
  simulationDeltaMs: 0,
  frameCount: 0,
  measureWindowMs: 0,
  longTasks: { available: false, count: 0, totalMs: 0, maxMs: 0 },
  shadowState: {
    originalEnabled: false,
    measuredEnabled: false,
    measuredAutoUpdate: false,
    lightsTotal: 0,
    lightsCastShadow: 0,
    meshesCastShadow: 0,
    meshesReceiveShadow: 0,
  },
  gpuInfo: {
    available: false,
    vendor: 'GPU renderer identification unavailable',
    renderer: 'GPU renderer identification unavailable',
  },
};

export class PerformanceLab {
  private readonly sceneManager: SceneManager;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly sampleIntervalMs = 400;
  private readonly warmupDelayMs = 3000;
  private readonly measureWindowMs = 10000;

  private enabled = false;
  private sampleTimer: number | null = null;
  private latestSnapshot: PerformanceLabSnapshot = DEFAULT_SNAPSHOT;
  private readonly modeListeners = new Set<(mode: PerformanceLabToggle) => void>();
  private readonly gpuExtension: EXT_disjoint_timer_query_webgl2 | null;
  private rawLongTaskEntries: Array<{ startTime: number; duration: number }> = [];
  private longTaskStats: { available: boolean; count: number; totalMs: number; maxMs: number } = {
    available: false,
    count: 0,
    totalMs: 0,
    maxMs: 0,
  };
  private longTaskObserver: PerformanceObserver | null = null;
  private statusMessage = 'Idle';
  private readonly gpuInfo: GpuInfo;
  /**
   * Exact snapshot of the application's own configuration, captured before the
   * first diagnostic mode is applied. Every mode restores from this instead of
   * from a hard-coded "diagnostic baseline", which is what previously made FULL
   * produce 76 draws / 224,760 tris instead of the real 19 / 56,190.
   */
  private testRestoreState: PerformanceLabRestoreState | null = null;
  private activeMode: PerformanceLabToggle = 'FULL';

  constructor(sceneManager: SceneManager) {
    this.sceneManager = sceneManager;
    this.renderer = sceneManager.getRenderer();
    const context = this.renderer.getContext();
    this.gpuExtension = context.getExtension('EXT_disjoint_timer_query_webgl2') as EXT_disjoint_timer_query_webgl2 | null;
    this.gpuInfo = sceneManager.getGpuInfo();
    this.latestSnapshot = this.captureSnapshot();

    // Handle so the live lab can be inspected from the browser console
    // and from automated benchmark runs against the same SceneManager/renderer.
    if (typeof window !== 'undefined') {
      (window as unknown as { __performanceLab?: PerformanceLab }).__performanceLab = this;
    }
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) this.startSampling();
    else this.stopSampling();
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public getLatestSnapshot(): PerformanceLabSnapshot {
    if (!this.enabled) this.latestSnapshot = this.captureSnapshot();
    return this.latestSnapshot;
  }

  public getCurrentMode(): PerformanceLabToggle {
    return this.activeMode;
  }

  public getStatusMessage(): string {
    return this.statusMessage;
  }

  /** True when the live scene actually contains a visible, rendered avatar. */
  public isAvatarSceneReady(): boolean {
    return this.sceneManager.getAvatarReadiness().ready;
  }

  /** Readiness text used by the panel to explain a blocked measurement. */
  public getReadinessMessage(): string {
    return this.sceneManager.getAvatarReadiness().message;
  }

  public subscribeToModeChanges(listener: (mode: PerformanceLabToggle) => void): () => void {
    this.modeListeners.add(listener);
    return () => this.modeListeners.delete(listener);
  }

  public async measure(label = 'Measure', test: PerformanceLabToggle = 'FULL', windowMs = this.measureWindowMs): Promise<PerformanceLabMeasurement> {
    // Refuse to produce a convincing-but-meaningless result when the avatar scene is inactive.
    const readiness = this.sceneManager.getAvatarReadiness();
    if (!readiness.ready) {
      this.statusMessage = `MEASUREMENT BLOCKED — AVATAR NOT LOADED. ${readiness.message}`;
      this.latestSnapshot = this.captureSnapshot();
      throw new Error(`MEASUREMENT BLOCKED — AVATAR NOT LOADED. ${readiness.message}`);
    }

    try {
      this.applyTestMode(test);
      this.statusMessage = `Measuring ${test}`;

      // Guarantee a quiet window: no performance -> React snapshots and no lab
      // panel polling are allowed to land inside the measured window.
      this.sceneManager.setPerformanceEmissionPaused(true);
      const pausedSampling = this.sampleTimer !== null;
      if (pausedSampling) this.stopSampling();

      try {
        await this.delay(this.warmupDelayMs);

        // Long tasks are captured across the measurement window and strictly window-scoped.
        this.startLongTaskCapture();
        // Everything recorded after this cursor belongs to the measurement window.
        let cursor = this.sceneManager.getFrameSampleCursor();
        const frames: SceneFrameSample[] = [];
        const wallStart = performance.now();

        while (performance.now() - wallStart < windowMs) {
          const batch = this.sceneManager.collectFrameSamples(cursor);
          if (batch.length > 0) {
            cursor = batch[batch.length - 1].seq;
            frames.push(...batch);
          }
          // Collection cadence only — frame intervals come from the samples,
          // never from this delay.
          await this.delay(100);
        }

        const tail = this.sceneManager.collectFrameSamples(cursor);
        frames.push(...tail);
        const wallEnd = performance.now();
        const wallMs = wallEnd - wallStart;

        // Wait for observer delivery after the measurement window closes before aggregating.
        await this.delay(150);
        this.aggregateLongTasks(wallStart, wallEnd);

        const summary = this.aggregateFrames(frames, wallMs, test);
        const result: PerformanceLabMeasurement = {
          ...summary,
          label,
          enabled: this.enabled,
          mode: test,
          frames,
        };
        this.latestSnapshot = result;
        this.statusMessage = `Complete ${test}`;
        return result;
      } finally {
        this.sceneManager.setPerformanceEmissionPaused(false);
        if (pausedSampling) this.startSampling();
        this.stopLongTaskCapture();
      }
    } catch (error) {
      this.statusMessage = `Test failed: ${test}`;
      throw error;
    } finally {
      this.restoreFullState();
      this.activeMode = 'FULL';
      this.emitModeChange('FULL');
      this.latestSnapshot = this.captureSnapshot();
    }
  }

  public async runAllTests(): Promise<Record<PerformanceLabToggle, PerformanceLabMeasurement | string>> {
    const tests: PerformanceLabToggle[] = ['FULL', 'NO_AVATAR', 'EMPTY_SCENE', 'SIMPLE_CUBE', 'AVATAR_STATIC', 'NO_SHADOWS'];
    const results: Record<PerformanceLabToggle, PerformanceLabMeasurement | string> = {} as Record<PerformanceLabToggle, PerformanceLabMeasurement | string>;

    for (const test of tests) {
      try {
        const result = await this.measure(`RunAll:${test}`, test);
        results[test] = result;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown test failure';
        results[test] = `TEST FAILED: ${message}`;
      }
      await this.delay(250);
    }

    this.restoreFullState();
    this.activeMode = 'FULL';
    this.statusMessage = 'Restored: FULL';
    this.emitModeChange('FULL');
    this.latestSnapshot = this.captureSnapshot();
    return results;
  }

  public getGpuTimingStatus(): string {
    return this.gpuExtension
      ? 'GPU timer extension available (no query executed — GPU time not measured)'
      : 'GPU timer unavailable';
  }

  public getLongTaskStats(): { available: boolean; count: number; totalMs: number; maxMs: number } {
    return { ...this.longTaskStats };
  }

  public dispose(): void {
    this.stopSampling();
    this.restoreFullState();
    this.enabled = false;
  }

  /**
   * Applies a diagnostic scene configuration.
   *
   * IMPORTANT: every mode starts from the application's own captured baseline.
   * The previous implementation unconditionally called
   * `setShadowsEnabled(true)` first, which flipped `castShadow` on all three
   * directional lights and turned the 19-draw baseline into a 76-draw
   * diagnostic scene — so "FULL" was never actually the normal application.
   */
  public applyTestMode(test: PerformanceLabToggle): void {
    // Return to the real application state first, then re-capture it, so a
    // chained test can never snapshot an already-perturbed scene.
    if (this.testRestoreState) this.restoreCapturedState();
    this.captureRestoreState();

    this.activeMode = test;
    this.statusMessage = `Applying ${test}`;
    const scene = this.sceneManager.getScene();

    if (test === 'FULL') {
      this.statusMessage = 'FULL (application baseline preserved, no extra shadow passes)';
      this.emitModeChange(test);
      this.latestSnapshot = this.captureSnapshot();
      return;
    }

    if (test === 'NO_AVATAR') {
      this.sceneManager.setAvatarEnabled(false);
      this.statusMessage = 'AVATAR removed from render contribution';
      this.emitModeChange(test);
      this.latestSnapshot = this.captureSnapshot();
      return;
    }

    if (test === 'NO_SHADOWS') {
      this.sceneManager.setShadowsEnabled(false);
      this.statusMessage = 'SHADOWS DISABLED for this test only';
      this.emitModeChange(test);
      this.latestSnapshot = this.captureSnapshot();
      return;
    }

    if (test === 'NO_LIGHTING') {
      this.sceneManager.setSceneLightsEnabled(false);
      this.statusMessage = 'LIGHTS DISABLED for this test only';
      this.emitModeChange(test);
      this.latestSnapshot = this.captureSnapshot();
      return;
    }

    if (test === 'NO_ENVIRONMENT') {
      this.sceneManager.setEnvironmentEnabled(false);
      this.statusMessage = 'ENVIRONMENT / BACKGROUND removed for this test only';
      this.emitModeChange(test);
      this.latestSnapshot = this.captureSnapshot();
      return;
    }

    if (test === 'EMPTY_SCENE') {
      this.sceneManager.setSceneEmpty();
      this.statusMessage = 'EMPTY SCENE (renderer + camera + loop only)';
      this.emitModeChange(test);
      this.latestSnapshot = this.captureSnapshot();
      return;
    }

    if (test === 'SIMPLE_CUBE') {
      this.sceneManager.setSceneEmpty();
      const cube = new THREE.Mesh(
        new THREE.BoxGeometry(0.75, 0.75, 0.75),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      cube.position.set(0, 1.1, 0.25);
      scene.add(cube);
      if (this.testRestoreState) this.testRestoreState.temporaryCube = cube;
      this.statusMessage = 'SIMPLE CUBE (1 mesh, 1 cheap material)';
      this.emitModeChange(test);
      this.latestSnapshot = this.captureSnapshot();
      return;
    }

    if (test === 'AVATAR_STATIC') {
      // Real VRM, static: no animation/expression/gaze/spring-bone/VRM update.
      // Shadow, light and environment state stay exactly as the application had them.
      const avatar = this.sceneManager.getActiveAvatar();
      if (avatar) {
        avatar.visible = true;
        avatar.animationController.setEnabled(false);
        (avatar as unknown as { setUpdateEnabled?: (enabled: boolean) => void }).setUpdateEnabled?.(false);
        (avatar as unknown as { setVrmUpdateEnabled?: (enabled: boolean) => void }).setVrmUpdateEnabled?.(false);
      }
      this.statusMessage = 'AVATAR STATIC (animation, expressions, gaze, spring bones, VRM update disabled)';
      this.emitModeChange(test);
      this.latestSnapshot = this.captureSnapshot();
      return;
    }

    if (test === 'SHADOW_DIAGNOSTIC') {
      // Diagnostic only: measures what shadow passes would cost if they were on.
      this.sceneManager.setShadowsEnabled(true);
      this.statusMessage = 'SHADOW DIAGNOSTIC (shadows forced ON for measurement only)';
      this.emitModeChange(test);
      this.latestSnapshot = this.captureSnapshot();
      return;
    }

    if (test === 'NO_UI') {
      this.statusMessage = 'UI HIDDEN for this test';
      this.emitModeChange(test);
      this.latestSnapshot = this.captureSnapshot();
    }
  }

  /**
   * Restores the application's exact captured configuration: renderer shadow
   * flags, per-object cast/receive flags (including lights), light
   * visibility/intensity, background, avatar visibility/animation state, and any
   * temporary diagnostic geometry. Safe to call when nothing was captured.
   */
  public restoreFullState(): void {
    this.restoreCapturedState();
    this.testRestoreState = null;
    this.activeMode = 'FULL';
    this.statusMessage = 'Restored: FULL';
    this.emitModeChange('FULL');
    this.latestSnapshot = this.captureSnapshot();
  }

  private restoreCapturedState(): void {
    const state = this.testRestoreState;
    if (!state) return;

    const scene = this.sceneManager.getScene();

    // Renderer-level shadow switches.
    this.renderer.shadowMap.enabled = state.shadowEnabled;
    this.renderer.shadowMap.autoUpdate = state.shadowAutoUpdate;

    // Exact per-object shadow flags (setShadowsEnabled rewrites them on every
    // mesh AND on every directional light, which is what quadrupled the draws).
    for (const flag of state.shadowFlags) {
      const target = flag.object as THREE.Object3D & { castShadow: boolean; receiveShadow?: boolean };
      target.castShadow = flag.castShadow;
      if (flag.receiveShadow !== null) target.receiveShadow = flag.receiveShadow;
    }

    // Lights — restored verbatim (setSceneLightsEnabled(true) clamps intensity to 0.001).
    const lights = this.sceneManager.getSceneLights();
    state.lights.forEach((entry, index) => {
      const light = lights[index];
      if (!light) return;
      light.visible = entry.visible;
      light.intensity = entry.intensity;
    });

    // Background / environment.
    scene.background = state.background;

    // Avatar visibility and update switches.
    const avatar = this.sceneManager.getActiveAvatar();
    if (avatar) {
      avatar.visible = state.avatarVisible;
      avatar.animationController.setEnabled(state.animationEnabled);
      (avatar as unknown as { setUpdateEnabled?: (enabled: boolean) => void }).setUpdateEnabled?.(state.updateEnabled);
      (avatar as unknown as { setVrmUpdateEnabled?: (enabled: boolean) => void }).setVrmUpdateEnabled?.(state.vrmUpdateEnabled);
    }

    // Temporary diagnostic geometry.
    if (state.temporaryCube && state.temporaryCube.parent) {
      scene.remove(state.temporaryCube);
      state.temporaryCube.geometry.dispose();
      if (Array.isArray(state.temporaryCube.material)) {
        state.temporaryCube.material.forEach((material) => material.dispose());
      } else {
        state.temporaryCube.material.dispose();
      }
      state.temporaryCube = null;
    }
  }

  private emitModeChange(mode: PerformanceLabToggle): void {
    for (const listener of this.modeListeners) {
      listener(mode);
    }
  }

  private startLongTaskCapture(): void {
    this.stopLongTaskCapture();
    this.rawLongTaskEntries = [];
    this.longTaskStats = { available: false, count: 0, totalMs: 0, maxMs: 0 };

    if (typeof PerformanceObserver === 'undefined') return;
    const supported = PerformanceObserver.supportedEntryTypes;
    if (Array.isArray(supported) && !supported.includes('longtask')) {
      // Unsupported is reported as unavailable — never as an implied zero.
      return;
    }

    try {
      this.longTaskObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        for (const entry of entries) {
          this.rawLongTaskEntries.push({
            startTime: entry.startTime,
            duration: entry.duration,
          });
        }
      });
      this.longTaskObserver.observe({ type: 'longtask', buffered: false });
      this.longTaskStats.available = true;
    } catch {
      this.longTaskObserver = null;
      this.longTaskStats = { available: false, count: 0, totalMs: 0, maxMs: 0 };
    }
  }

  /**
   * Correctly window-scopes long tasks:
   * Only includes tasks that overlap [windowStart, windowEnd].
   * Overlap duration is max(0, min(taskEnd, windowEnd) - max(taskStart, windowStart)).
   * Clamped by window duration sanity check.
   */
  private aggregateLongTasks(windowStart: number, windowEnd: number): void {
    if (!this.longTaskStats.available) return;

    let overlappingCount = 0;
    let totalOverlapMs = 0;
    let maxOverlapMs = 0;
    const windowDuration = windowEnd - windowStart;

    for (const entry of this.rawLongTaskEntries) {
      const taskStart = entry.startTime;
      const taskEnd = entry.startTime + entry.duration;
      const overlap = Math.max(0, Math.min(taskEnd, windowEnd) - Math.max(taskStart, windowStart));

      if (overlap > 0) {
        overlappingCount += 1;
        totalOverlapMs += overlap;
        maxOverlapMs = Math.max(maxOverlapMs, overlap);
      }
    }

    // Sanity check: total measured overlap must not exceed the measurement window duration.
    if (totalOverlapMs > windowDuration) {
      console.warn(`[PerformanceLab] Long-task total overlap (${totalOverlapMs.toFixed(1)} ms) exceeded window duration (${windowDuration.toFixed(1)} ms). Clamping.`);
      totalOverlapMs = windowDuration;
    }

    this.longTaskStats = {
      available: true,
      count: overlappingCount,
      totalMs: totalOverlapMs,
      maxMs: maxOverlapMs,
    };
  }

  /** Human readable long-task status; never reports an unsupported API as zero. */
  public getLongTaskStatus(): string {
    if (!this.longTaskStats.available) return 'Long-task API unavailable';
    return `${this.longTaskStats.count} long tasks, ${this.longTaskStats.totalMs.toFixed(1)} ms total, ${this.longTaskStats.maxMs.toFixed(1)} ms max`;
  }

  private stopLongTaskCapture(): void {
    if (this.longTaskObserver) {
      this.longTaskObserver.disconnect();
      this.longTaskObserver = null;
    }
  }

  private startSampling(): void {
    if (this.sampleTimer !== null) return;
    this.sampleTimer = window.setInterval(() => {
      this.latestSnapshot = this.captureSnapshot();
    }, this.sampleIntervalMs);
  }

  private stopSampling(): void {
    if (this.sampleTimer !== null) {
      window.clearInterval(this.sampleTimer);
      this.sampleTimer = null;
    }
  }

  /**
   * Captures the application's exact live configuration — once — so that every
   * diagnostic mode can be rolled back to precisely what the user's app was doing.
   */
  private captureRestoreState(): void {
    if (this.testRestoreState) return;

    const scene = this.sceneManager.getScene();
    const avatar = this.sceneManager.getActiveAvatar();
    const lights = this.sceneManager.getSceneLights();

    const shadowFlags: ShadowFlagSnapshot[] = [];
    scene.traverse((object) => {
      const target = object as THREE.Object3D & { castShadow?: unknown; receiveShadow?: unknown };
      if (typeof target.castShadow !== 'boolean') return;
      shadowFlags.push({
        object,
        castShadow: target.castShadow,
        receiveShadow: typeof target.receiveShadow === 'boolean' ? target.receiveShadow : null,
      });
    });

    this.testRestoreState = {
      avatarVisible: avatar ? avatar.visible : false,
      animationEnabled: avatar ? avatar.animationController.isEnabled() : true,
      updateEnabled: (avatar as unknown as { updateEnabled?: boolean } | null)?.updateEnabled ?? true,
      vrmUpdateEnabled: (avatar as unknown as { vrmUpdateEnabled?: boolean } | null)?.vrmUpdateEnabled ?? true,
      shadowEnabled: this.renderer.shadowMap.enabled,
      shadowAutoUpdate: this.renderer.shadowMap.autoUpdate,
      backgroundActive: scene.background !== null,
      background: scene.background,
      shadowFlags,
      environmentColor: this.sceneManager.getBackgroundColor(),
      lights: lights.map((light) => ({ visible: light.visible, intensity: light.intensity })),
      temporaryCube: null,
    };
  }

  private getRendererConfig(): PerformanceLabRendererConfig {
    const context = this.renderer.getContext();
    const canvas = this.renderer.domElement as HTMLCanvasElement;
    return {
      webglVersion: this.renderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1',
      qualityTier: this.sceneManager.getQualityTier(),
      antialias: Boolean((this.renderer as any).capabilities?.antialias ?? false),
      alpha: Boolean((this.renderer as any).alpha ?? this.renderer.getClearAlpha() < 1),
      powerPreference: 'high-performance',
      pixelRatio: this.renderer.getPixelRatio(),
      outputColorSpace: this.renderer.outputColorSpace?.toString() ?? 'unknown',
      toneMapping: this.renderer.toneMapping,
      toneMappingExposure: this.renderer.toneMappingExposure,
      shadowMapEnabled: this.renderer.shadowMap.enabled,
      shadowMapType: this.renderer.shadowMap.type,
      physicallyCorrectLights: Boolean((this.renderer as unknown as { physicallyCorrectLights?: boolean }).physicallyCorrectLights),
      localClippingEnabled: this.renderer.localClippingEnabled,
      stencil: Boolean((context.getParameter(context.STENCIL_BITS) as number) > 0),
      depth: Number(context.getParameter(context.DEPTH_BITS) as number ?? 0),
      preserveDrawingBuffer: Boolean((this.renderer as any).preserveDrawingBuffer ?? false),
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      drawingBufferWidth: context.drawingBufferWidth,
      drawingBufferHeight: context.drawingBufferHeight,
    };
  }

  private captureSnapshot(): PerformanceLabSnapshot {
    const info = this.renderer.info;
    const renderInfo = info.render ?? { calls: 0, triangles: 0, points: 0, lines: 0 };
    const memoryInfo = info.memory ?? { geometries: 0, textures: 0 };
    const diagnostics = this.sceneManager.getFrameDiagnostics();
    const avatar = this.sceneManager.getActiveAvatar();
    const readiness = this.sceneManager.getAvatarReadiness();
    const canvas = this.renderer.domElement;
    const gpuTiming = this.gpuExtension
      ? 'GPU timer extension available (no query executed — GPU time not measured)'
      : 'GPU timer unavailable';

    const snapshot: PerformanceLabSnapshot = {
      enabled: this.enabled,
      mode: this.activeMode,
      avatarReady: readiness.ready,
      avatarLoaded: readiness.avatarLoaded,
      avatarInScene: readiness.avatarInScene,
      avatarVisible: readiness.avatarVisible,
      rendererActive: readiness.rendererActive,
      readinessMessage: readiness.message,
      blocked: !readiness.ready,
      fps: Number.isFinite(this.sceneManager.getLatestFps()) ? this.sceneManager.getLatestFps() : 0,
      averageFps: Number.isFinite(this.sceneManager.getAverageFps()) ? this.sceneManager.getAverageFps() : 0,
      frameMs: Number.isFinite(this.sceneManager.getLatestFrameTime()) ? this.sceneManager.getLatestFrameTime() : 0,
      averageFrameMs: Number.isFinite(this.sceneManager.getAverageFrameTime()) ? this.sceneManager.getAverageFrameTime() : 0,
      updateMs: diagnostics.sceneManagerUpdateMs,
      renderMs: diagnostics.renderMs,
      unexplainedMs: diagnostics.unexplainedMs,
      dpr: this.renderer.getPixelRatio(),
      canvasWidth: canvas.clientWidth,
      canvasHeight: canvas.clientHeight,
      drawingBufferWidth: canvas.width,
      drawingBufferHeight: canvas.height,
      drawCalls: renderInfo.calls ?? 0,
      triangles: renderInfo.triangles ?? 0,
      points: renderInfo.points ?? 0,
      lines: renderInfo.lines ?? 0,
      geometries: memoryInfo.geometries ?? 0,
      textures: memoryInfo.textures ?? 0,
      cpu: {
        totalFrameMs: diagnostics.totalFrameMs,
        sceneManagerUpdateMs: diagnostics.sceneManagerUpdateMs,
        avatarUpdateMs: diagnostics.avatarUpdateMs,
        animationUpdateMs: diagnostics.animationUpdateMs,
        expressionUpdateMs: diagnostics.expressionUpdateMs,
        vrmUpdateMs: diagnostics.vrmUpdateMs,
        renderMs: diagnostics.renderMs,
        unexplainedMs: diagnostics.unexplainedMs,
      },
      gpuTiming,
      gpuMs: null,
      // Live (non-windowed) raw frame metrics straight from the render loop.
      rawFrameMs: diagnostics.frameIntervalMs,
      rawFPS: diagnostics.frameIntervalMs > 0 ? 1000 / diagnostics.frameIntervalMs : 0,
      simulationDeltaMs: diagnostics.simulationDeltaMs,
      frameCount: 0,
      measureWindowMs: 0,
      longTasks: { ...this.longTaskStats },
      shadowState: this.buildShadowState(),
      gpuInfo: this.gpuInfo,
      renderer: this.getRendererConfig(),
      avatar: this.buildAvatarMetadata(avatar),
    };

    this.latestSnapshot = snapshot;
    return snapshot;
  }

  /** Original (application) shadow state vs. the state currently being measured. */
  private buildShadowState(): PerformanceLabSnapshot['shadowState'] {
    const diagnostics = this.sceneManager.getShadowDiagnostics();
    return {
      originalEnabled: this.testRestoreState ? this.testRestoreState.shadowEnabled : diagnostics.shadowMapEnabled,
      measuredEnabled: diagnostics.shadowMapEnabled,
      measuredAutoUpdate: diagnostics.shadowMapAutoUpdate,
      lightsTotal: diagnostics.lightsTotal,
      lightsCastShadow: diagnostics.lightsCastShadow,
      meshesCastShadow: diagnostics.meshesCastShadow,
      meshesReceiveShadow: diagnostics.meshesReceiveShadow,
    };
  }

  private buildAvatarMetadata(activeAvatar: IAvatar | null): PerformanceLabSnapshot['avatar'] {
    if (!activeAvatar) return undefined;

    const scene = activeAvatar.vrm.scene;
    if (!scene) return undefined;

    const objectCount = { total: 0, meshes: 0, skinned: 0 };
    const materialSet = new Set<THREE.Material>();
    const textureSet = new Set<THREE.Texture>();
    const resolutions = new Set<string>();
    let transparentMaterials = 0;
    let alphaTestMaterials = 0;
    let emissiveMaterials = 0;
    let morphTargetCount = 0;
    let maxTextureWidth = 0;
    let maxTextureHeight = 0;

    const recordTexture = (texture: THREE.Texture | undefined) => {
      if (!texture) return;
      textureSet.add(texture);
      const image = texture.image as { width?: number; height?: number } | undefined;
      const width = image?.width ?? 0;
      const height = image?.height ?? 0;
      maxTextureWidth = Math.max(maxTextureWidth, width);
      maxTextureHeight = Math.max(maxTextureHeight, height);
      resolutions.add(`${width}x${height}`);
    };

    scene.traverse((obj) => {
      objectCount.total += 1;
      const mesh = obj as THREE.Mesh;
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
        objectCount.skinned += 1;
      }
      if ('geometry' in mesh && mesh.geometry) {
        objectCount.meshes += 1;
        const morphPositions = mesh.geometry.morphAttributes?.position;
        if (Array.isArray(morphPositions)) morphTargetCount += morphPositions.length;
      }

      const material = mesh.material;
      if (Array.isArray(material)) {
        material.forEach((entry) => {
            if (!entry) return;
            materialSet.add(entry);
            if ('transparent' in entry && entry.transparent) transparentMaterials += 1;
            if ('alphaTest' in entry && typeof entry.alphaTest === 'number' && entry.alphaTest > 0) alphaTestMaterials += 1;
            if ('emissive' in entry && (entry as THREE.MeshStandardMaterial).emissive) emissiveMaterials += 1;
            const materialRecord = entry as unknown as Record<string, THREE.Texture | undefined>;
            ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'].forEach((key) => {
              recordTexture(materialRecord[key] as THREE.Texture | undefined);
            });
        });
      } else if (material) {
        materialSet.add(material);
        if ('transparent' in material && material.transparent) transparentMaterials += 1;
        if ('alphaTest' in material && typeof material.alphaTest === 'number' && material.alphaTest > 0) alphaTestMaterials += 1;
        if ('emissive' in material && (material as THREE.MeshStandardMaterial).emissive) emissiveMaterials += 1;
        const materialRecord = material as unknown as Record<string, THREE.Texture | undefined>;
        ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'].forEach((key) => {
          recordTexture(materialRecord[key] as THREE.Texture | undefined);
        });
      }
    });

    const expressionManager = activeAvatar.vrm.expressionManager as { expressions?: unknown[] } | undefined;
    const expressionCount = expressionManager && Array.isArray(expressionManager.expressions) ? expressionManager.expressions.length : 0;
    const humanoidBones = activeAvatar.vrm.humanoid as unknown as { humanBones?: Record<string, unknown> } | undefined;
    // three-vrm v3 exposes `humanBones` as a name -> node record, not an array.
    const humanoidBoneCount = humanoidBones && humanoidBones.humanBones && typeof humanoidBones.humanBones === 'object'
      ? Object.keys(humanoidBones.humanBones).length
      : 0;
    const springBoneManager = activeAvatar.vrm.springBoneManager as unknown as {
      springBones?: Set<unknown>;
      colliders?: unknown;
    } | undefined;
    const springBoneCount = springBoneManager && springBoneManager.springBones ? springBoneManager.springBones.size : 0;
    // three-vrm v3 exposes `colliders` as an array (older builds used a Set).
    const colliders = springBoneManager ? springBoneManager.colliders : null;
    const colliderCount = Array.isArray(colliders)
      ? colliders.length
      : (colliders && typeof (colliders as { size?: number }).size === 'number' ? (colliders as { size: number }).size : 0);

    let shadowCastingMeshes = 0;
    let shadowReceivingMeshes = 0;
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if ('castShadow' in mesh && mesh.castShadow) shadowCastingMeshes += 1;
      if ('receiveShadow' in mesh && mesh.receiveShadow) shadowReceivingMeshes += 1;
    });

    return {
      totalObjectCount: objectCount.total,
      meshCount: objectCount.meshes,
      skinnedMeshCount: objectCount.skinned,
      materialCount: objectCount.meshes,
      uniqueMaterialCount: materialSet.size,
      textureCount: textureSet.size,
      textureResolutions: Array.from(resolutions).slice(0, 16),
      maxTextureResolution: `${maxTextureWidth}x${maxTextureHeight}`,
      morphTargetCount,
      transparentMaterialCount: transparentMaterials,
      alphaTestMaterialCount: alphaTestMaterials,
      emissiveMaterialCount: emissiveMaterials,
      expressionCount,
      springBoneCount: springBoneCount,
      colliderCount,
      humanoidBoneCount,
      shadowCastingMeshes,
      shadowReceivingMeshes,
    };
  }

  /**
   * Aggregates raw per-frame samples collected directly from the render loop.
   *
   * - `rawFrameMs` / `rawFPS` come from `performance.now()` RAF gaps only.
   * - `simulationDeltaMs` is reported separately and NEVER used for FPS.
   * - FPS is derived from the window: `(frameCount - 1) / span * 1000`.
   */
  private aggregateFrames(frames: SceneFrameSample[], wallMs: number, test: PerformanceLabToggle): PerformanceLabSnapshot {
    const snapshot = this.captureSnapshot();
    const avg = (values: number[]): number => (values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length);
    const max = (values: number[]): number => (values.length === 0 ? 0 : Math.max(...values));

    const frameCount = frames.length;
    const spanMs = frameCount > 1 ? frames[frameCount - 1].timestamp - frames[0].timestamp : wallMs;
    const rawFrameMs = avg(frames.map((frame) => frame.rawFrameMs));
    const rawFPS = frameCount > 1 && spanMs > 0
      ? ((frameCount - 1) / spanMs) * 1000
      : (rawFrameMs > 0 ? 1000 / rawFrameMs : 0);
    const simulationDeltaMs = avg(frames.map((frame) => frame.simulationDeltaMs));
    const updateMs = avg(frames.map((frame) => frame.updateMs));
    const renderCpuMs = avg(frames.map((frame) => frame.renderCpuMs));
    const measuredFrameMs = updateMs + renderCpuMs;
    const unexplainedMs = rawFrameMs > 0 ? Math.max(0, rawFrameMs - measuredFrameMs) : snapshot.unexplainedMs;

    return {
      ...snapshot,
      mode: test,
      enabled: this.enabled,
      // Raw frame metrics replace the clamped values for reported FPS/frame time.
      rawFrameMs,
      rawFPS,
      simulationDeltaMs,
      frameCount,
      measureWindowMs: wallMs,
      fps: rawFPS,
      averageFps: rawFPS,
      frameMs: rawFrameMs,
      averageFrameMs: rawFrameMs,
      updateMs,
      renderMs: renderCpuMs,
      unexplainedMs,
      drawCalls: max(frames.map((frame) => frame.drawCalls)) || snapshot.drawCalls,
      triangles: max(frames.map((frame) => frame.triangles)) || snapshot.triangles,
      cpu: {
        ...snapshot.cpu,
        totalFrameMs: measuredFrameMs,
        sceneManagerUpdateMs: updateMs,
        avatarUpdateMs: avg(frames.map((frame) => frame.avatarUpdateMs)),
        animationUpdateMs: avg(frames.map((frame) => frame.animationUpdateMs)),
        expressionUpdateMs: avg(frames.map((frame) => frame.expressionUpdateMs)),
        vrmUpdateMs: avg(frames.map((frame) => frame.vrmUpdateMs)),
        renderMs: renderCpuMs,
        unexplainedMs,
      },
      longTasks: { ...this.longTaskStats },
      // Never inferred from CPU time: only a real timer query could fill this.
      gpuMs: null,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

type EXT_disjoint_timer_query_webgl2 = {
  queryCounterEXT(): void;
  beginQueryEXT(): void;
  endQueryEXT(): void;
};
