import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { IAvatar } from '../types/avatar';
import { detectQualityTier, getQualityProfile, resolveDpr, type QualityTier } from './performance/QualitySystem';
import { avatarDiagnostics } from './avatar/AvatarDiagnostics';

export interface ScenePerformanceSnapshot {
  fps: number;
  frameTime: number;
  dpr: number;
  qualityTier: QualityTier;
  avatarLoaded: boolean;
  avatarInScene?: boolean;
  avatarVisible?: boolean;
  avatarAnimationState: string;
  jsUpdateTime?: number;
  renderTime?: number;
  drawCalls?: number;
  triangles?: number;
  geometries?: number;
  textures?: number;
  hidden?: boolean;
}

export interface SceneFrameDiagnostics {
  /** LEGACY NAME — this is the raw, UNCAPPED wall-clock gap between rAF callbacks. */
  frameIntervalMs: number;
  /**
   * Clamped simulation delta in milliseconds (0.001s..0.1s).
   * NEVER use this to derive FPS: a 100 ms value here is the clamp ceiling,
   * not a measurement.
   */
  simulationDeltaMs: number;
  totalFrameMs: number;
  sceneManagerUpdateMs: number;
  avatarUpdateMs: number;
  animationUpdateMs: number;
  expressionUpdateMs: number;
  vrmUpdateMs: number;
  renderMs: number;
  unexplainedMs: number;
}

/**
 * One frame of wall-clock timing recorded inside the render loop itself.
 *
 * `rawFrameMs` comes straight from `performance.now()` deltas between consecutive
 * `requestAnimationFrame` callbacks — it is never clamped, never derived from
 * `THREE.Clock`, and never derived from the PerformanceLab polling interval.
 */
export interface SceneFrameSample {
  /** Monotonic sequence number; use as a cursor with `collectFrameSamples`. */
  seq: number;
  /** `performance.now()` at the start of the frame. */
  timestamp: number;
  /** True wall-clock interval since the previous RAF callback (uncapped). */
  rawFrameMs: number;
  /** The app's clamped simulation delta (ms). Reported for contrast only. */
  simulationDeltaMs: number;
  /** JavaScript update duration for this frame (ms). */
  updateMs: number;
  /** `renderer.render(scene, camera)` duration for this frame (ms). */
  renderCpuMs: number;
  /** `AvatarInstance.update()` duration for this frame (ms). */
  avatarUpdateMs: number;
  /** Animation controller update duration for this frame (ms). */
  animationUpdateMs: number;
  /** Expression controller update duration for this frame (ms). */
  expressionUpdateMs: number;
  /** VRM internal update (spring bones / lookAt / expressions) duration (ms). */
  vrmUpdateMs: number;
  /** `renderer.info.render.calls` for this frame (includes shadow passes). */
  drawCalls: number;
  /** `renderer.info.render.triangles` for this frame. */
  triangles: number;
}

export interface GpuInfo {
  available: boolean;
  vendor: string;
  renderer: string;
}

export interface ShadowDiagnostics {
  shadowMapEnabled: boolean;
  shadowMapAutoUpdate: boolean;
  lightsTotal: number;
  lightsCastShadow: number;
  meshesCastShadow: number;
  meshesReceiveShadow: number;
}

export interface SceneManagerOptions {
  container: HTMLElement;
  backgroundColor?: number;
}

/**
 * Runtime truth about whether the live scene is actually showing a loaded avatar.
 * Used to block false "healthy" performance readings when no avatar is active.
 */
export interface AvatarReadiness {
  avatarLoaded: boolean;
  avatarInScene: boolean;
  avatarVisible: boolean;
  rendererActive: boolean;
  ready: boolean;
  message: string;
}

/**
 * Manages the Three.js scene, camera, studio lighting, OrbitControls,
 * dynamic avatar framing for desktop & mobile, resize events, and the render loop.
 */
export class SceneManager {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private clock: THREE.Clock;
  private qualityTier: QualityTier;
  private performanceListener: ((snapshot: ScenePerformanceSnapshot) => void) | null = null;
  private lastPerformanceSample = 0;
  private lastFrameMs = 0;
  private lastFps = 0;
  private readonly performanceSampleEveryMs = 250;
  private framesRendered = 0;
  private lastPublishedDiagnosticsKey = '';
  private diagnosticsRendererActive = false;

  private activeAvatar: IAvatar | null = null;
  private animationFrameId: number | null = null;
  private isRunning: boolean = false;
  private resizeObserver: ResizeObserver | null = null;
  private isDocumentHidden = document.visibilityState === 'hidden';
  private jsUpdateDuration = 0;
  private renderDuration = 0;
  /**
   * Work measured during the current loop iteration.
   *
   * It can only be published once the NEXT `requestAnimationFrame` fires,
   * because only then is `frameIntervalMs` known for the wall-clock interval
   * that actually contained this work. Pairing iteration N's CPU work with
   * iteration N's `frameIntervalMs` would attribute it to the interval that
   * *preceded* it, producing rows where `updateMs > rawFrameMs`.
   */
  private pendingFrameWork: {
    timestamp: number;
    updateMs: number;
    renderCpuMs: number;
    avatarUpdateMs: number;
    animationUpdateMs: number;
    expressionUpdateMs: number;
    vrmUpdateMs: number;
    drawCalls: number;
    triangles: number;
  } | null = null;
  private lastFrameDiagnostics: SceneFrameDiagnostics = {
    frameIntervalMs: 0,
    simulationDeltaMs: 0,
    totalFrameMs: 0,
    sceneManagerUpdateMs: 0,
    avatarUpdateMs: 0,
    animationUpdateMs: 0,
    expressionUpdateMs: 0,
    vrmUpdateMs: 0,
    renderMs: 0,
    unexplainedMs: 0,
  };
  private lastFrameTimestamp: number | null = null;
  private averageFps = 0;
  private averageFrameTime = 0;
  private frameSamples: number[] = [];

  /**
   * Ring of raw per-frame samples captured inside the render loop.
   * The Performance Lab aggregates these over its measurement window instead of
   * sampling a timer and pretending the poll interval is a frame interval.
   */
  private frameSampleBuffer: SceneFrameSample[] = [];
  private frameSampleSeq = 0;
  private readonly maxFrameSamples = 3000;
  /**
   * While true the periodic performance snapshot is not pushed to React, so the
   * measurement window itself is not perturbed by UI reconciliation work.
   * Raw frame sampling keeps running.
   */
  private performanceEmissionPaused = false;
  private cachedGpuInfo: GpuInfo | null = null;
  private sceneBackgroundColor: THREE.ColorRepresentation | null = null;
  private sceneLights: THREE.Light[] = [];
  private renderScale: number | null = null;

  constructor(options: SceneManagerOptions) {
    this.container = options.container;
    this.qualityTier = detectQualityTier();

    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);

    this.scene = new THREE.Scene();
    this.sceneBackgroundColor = options.backgroundColor ?? 0xf5f6f8;
    if (this.sceneBackgroundColor !== undefined) {
      this.scene.background = new THREE.Color(this.sceneBackgroundColor);
    } else {
      this.scene.background = new THREE.Color(0xf5f6f8);
    }

    this.camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 50);
    this.camera.position.set(0, 1.35, 2.6);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });

    const profile = getQualityProfile(this.qualityTier);
    this.renderer.shadowMap.enabled = profile.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = profile.shadows;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.setSize(width, height);
    this.applyRendererQuality();
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.container.appendChild(this.renderer.domElement);

    this.setupLighting();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.enablePan = false;
    this.controls.enableRotate = true;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 0.8;
    this.controls.maxDistance = 5.2;
    this.controls.maxPolarAngle = Math.PI * 0.52;
    this.controls.target.set(0, 1.3, 0);
    this.controls.update();

    this.clock = new THREE.Clock();

    this.handleResize = this.handleResize.bind(this);
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    this.setupResizeHandling();
    this.setupVisibilityHandling();
    if (typeof window !== 'undefined') {
      (window as unknown as { __sceneManager?: SceneManager }).__sceneManager = this;
    }
    this.start();
  }

  public getQualityTier(): QualityTier {
    return this.qualityTier;
  }

  /**
   * Cursor identifying the newest raw frame sample. Pass the value returned
   * before a measurement window to `collectFrameSamples` afterwards.
   */
  public getFrameSampleCursor(): number {
    return this.frameSampleSeq;
  }

  /**
   * Raw per-frame samples recorded after `fromSeq`.
   * These come from the render loop itself — not from a polling timer — so their
   * `rawFrameMs` values are the true browser frame intervals.
   */
  public collectFrameSamples(fromSeq: number): SceneFrameSample[] {
    if (this.frameSampleBuffer.length === 0) return [];
    if (fromSeq <= 0) return [...this.frameSampleBuffer];
    return this.frameSampleBuffer.filter((sample) => sample.seq > fromSeq);
  }

  /** Number of raw frame samples currently buffered. */
  public getFrameSampleCount(): number {
    return this.frameSampleBuffer.length;
  }

  /**
   * Freezes (or unfreezes) the periodic performance -> React snapshot so the
   * Performance Lab can guarantee a measurement window free of panel updates.
   */
  public setPerformanceEmissionPaused(paused: boolean): void {
    this.performanceEmissionPaused = paused;
  }

  public isPerformanceEmissionPaused(): boolean {
    return this.performanceEmissionPaused;
  }

  /**
   * WebGL vendor/renderer strings via `WEBGL_debug_renderer_info`.
   * Diagnostic only — reports `available: false` when the extension is missing.
   */
  public getGpuInfo(): GpuInfo {
    if (this.cachedGpuInfo) return { ...this.cachedGpuInfo };

    const unavailable: GpuInfo = {
      available: false,
      vendor: 'GPU renderer identification unavailable',
      renderer: 'GPU renderer identification unavailable',
    };

    try {
      const context = this.renderer.getContext();
      const extension = context.getExtension('WEBGL_debug_renderer_info');
      if (!extension) {
        this.cachedGpuInfo = unavailable;
        return { ...unavailable };
      }
      const vendor = String(context.getParameter(extension.UNMASKED_VENDOR_WEBGL) ?? '');
      const rendererName = String(context.getParameter(extension.UNMASKED_RENDERER_WEBGL) ?? '');
      if (!vendor && !rendererName) {
        this.cachedGpuInfo = unavailable;
        return { ...unavailable };
      }
      this.cachedGpuInfo = { available: true, vendor: vendor || 'unknown', renderer: rendererName || 'unknown' };
      return { ...this.cachedGpuInfo };
    } catch {
      this.cachedGpuInfo = unavailable;
      return { ...unavailable };
    }
  }

  /**
   * Counts of the *current* shadow configuration, so a diagnostic mode can be
   * compared against the application's original state.
   */
  public getShadowDiagnostics(): ShadowDiagnostics {
    let lightsTotal = 0;
    let lightsCastShadow = 0;
    let meshesCastShadow = 0;
    let meshesReceiveShadow = 0;

    this.scene.traverse((object) => {
      const target = object as THREE.Object3D & { castShadow?: boolean; receiveShadow?: boolean; isLight?: boolean };
      const isLight = Boolean(target.isLight);
      if (isLight) {
        lightsTotal += 1;
        if (target.castShadow) lightsCastShadow += 1;
      } else if (target.castShadow) {
        meshesCastShadow += 1;
      }
      if (target.receiveShadow) meshesReceiveShadow += 1;
    });

    return {
      shadowMapEnabled: this.renderer.shadowMap.enabled,
      shadowMapAutoUpdate: this.renderer.shadowMap.autoUpdate,
      lightsTotal,
      lightsCastShadow,
      meshesCastShadow,
      meshesReceiveShadow,
    };
  }

  public getQualityProfile(): ReturnType<typeof getQualityProfile> {
    return getQualityProfile(this.qualityTier);
  }

  public getRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  public getActiveAvatar(): IAvatar | null {
    return this.activeAvatar;
  }

  /** True when an avatar instance has been handed to this scene. */
  public isAvatarLoaded(): boolean {
    return this.activeAvatar !== null;
  }

  /** True when the active avatar root is actually a child of this scene graph. */
  public isAvatarInScene(): boolean {
    const avatar = this.activeAvatar;
    return avatar !== null && avatar.vrm.scene.parent === this.scene;
  }

  /** True when the avatar is attached to this scene and flag-visible. */
  public isAvatarVisible(): boolean {
    const avatar = this.activeAvatar;
    return this.isAvatarInScene() && avatar !== null && avatar.visible;
  }

  /** True when this scene has actually been drawn at least once with the avatar attached. */
  public isRendererActive(): boolean {
    return this.framesRendered > 0 && this.isAvatarInScene();
  }

  /**
   * Combines the scene graph truth with the avatar load pipeline diagnostics so the
   * Performance Lab can refuse to report measurements for an inactive scene.
   */
  public getAvatarReadiness(): AvatarReadiness {
    const avatarLoaded = this.isAvatarLoaded();
    const avatarInScene = this.isAvatarInScene();
    const avatarVisible = this.isAvatarVisible();
    const rendererActive = this.isRendererActive();
    const pipeline = avatarDiagnostics.getReadiness();

    const ready = avatarLoaded && avatarInScene && avatarVisible && rendererActive;
    let message = 'AVATAR READY';
    if (!ready) {
      if (!pipeline.ready && !avatarLoaded) {
        message = pipeline.message;
      } else if (!avatarLoaded) {
        message = 'AVATAR NOT READY — no avatar instance in the scene manager';
      } else if (!avatarInScene) {
        message = 'AVATAR NOT READY — avatar root is not attached to the active scene';
      } else if (!avatarVisible) {
        message = 'AVATAR NOT READY — avatar is not visible';
      } else {
        message = 'AVATAR NOT READY — renderer has not drawn the avatar yet';
      }
    }

    return { avatarLoaded, avatarInScene, avatarVisible, rendererActive, ready, message };
  }

  public getLatestFrameTime(): number {
    return this.lastFrameMs;
  }

  public getLatestFps(): number {
    return this.lastFps;
  }

  public getAverageFrameTime(): number {
    return this.averageFrameTime;
  }

  public getAverageFps(): number {
    return this.averageFps;
  }

  public getFrameDiagnostics(): SceneFrameDiagnostics {
    return { ...this.lastFrameDiagnostics };
  }

  public getRendererConfig(): Record<string, unknown> {
    const context = this.renderer.getContext();
    const canvas = this.renderer.domElement as HTMLCanvasElement;
    return {
      webglVersion: this.renderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1',
      antialias: Boolean((this.renderer as any).capabilities?.antialias ?? false),
      alpha: Boolean((this.renderer as any).alpha ?? this.renderer.getClearAlpha() < 1),
      powerPreference: 'high-performance',
      pixelRatio: this.renderer.getPixelRatio(),
      renderScale: this.getRenderScale(),
      outputColorSpace: this.renderer.outputColorSpace?.toString?.() ?? 'unknown',
      toneMapping: this.renderer.toneMapping,
      toneMappingExposure: this.renderer.toneMappingExposure,
      shadowMapEnabled: this.renderer.shadowMap.enabled,
      shadowMapType: this.renderer.shadowMap.type,
      physicallyCorrectLights: false,
      localClippingEnabled: this.renderer.localClippingEnabled,
      stencil: Boolean(context.getParameter(context.STENCIL_BITS) as number > 0),
      depth: Number(context.getParameter(context.DEPTH_BITS) as number ?? 0),
      preserveDrawingBuffer: Boolean((this.renderer as any).preserveDrawingBuffer ?? false),
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      drawingBufferWidth: context.drawingBufferWidth,
      drawingBufferHeight: context.drawingBufferHeight,
    };
  }

  public setPerformanceListener(listener: ((snapshot: ScenePerformanceSnapshot) => void) | null): void {
    this.performanceListener = listener;
  }

  public getPerformanceSnapshot(): ScenePerformanceSnapshot {
    return {
      fps: this.lastFps,
      frameTime: this.lastFrameMs,
      dpr: this.renderer.getPixelRatio(),
      qualityTier: this.qualityTier,
      avatarLoaded: this.isAvatarLoaded(),
      avatarInScene: this.isAvatarInScene(),
      avatarVisible: this.isAvatarVisible(),
      avatarAnimationState: this.activeAvatar?.animationController.getState() ?? 'idle',
      jsUpdateTime: this.jsUpdateDuration,
      renderTime: this.renderDuration,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      hidden: this.isDocumentHidden,
    };
  }

  public setRenderScale(scale: number | null): void {
    this.renderScale = scale !== null ? Math.max(0.1, Math.min(scale, 2.0)) : null;
    this.applyRendererQuality();
  }

  public getRenderScale(): number {
    return this.renderScale ?? 1.0;
  }

  private applyRendererQuality(): void {
    const baseDpr = resolveDpr(this.qualityTier, window.devicePixelRatio || 1);
    const effectiveDpr = this.renderScale !== null ? baseDpr * this.renderScale : baseDpr;
    this.renderer.setPixelRatio(effectiveDpr);

    const profile = getQualityProfile(this.qualityTier);
    this.renderer.shadowMap.enabled = profile.shadows && !this.isDocumentHidden;
    this.renderer.shadowMap.autoUpdate = profile.shadows && !this.isDocumentHidden;
  }

  private emitPerformanceSnapshot(frameMs: number): void {
    if (!this.performanceListener) return;
    // Frozen while a Performance Lab measurement window is open so that React
    // reconciliation cannot land inside the window being measured.
    if (this.performanceEmissionPaused) return;

    const now = performance.now();
    if (now - this.lastPerformanceSample < this.performanceSampleEveryMs) {
      return;
    }

    this.lastFrameMs = frameMs;
    this.lastFps = Math.min(120, 1000 / Math.max(frameMs, 1));
    this.lastPerformanceSample = now;
    this.performanceListener(this.getPerformanceSnapshot());
  }

  private setupLighting(): void {
    const profile = getQualityProfile(this.qualityTier);
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.68 * profile.lightIntensity);
    this.scene.add(ambientLight);
    this.sceneLights.push(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xf6f8fc, 0xdfe2e8, 0.52 * profile.lightIntensity);
    hemiLight.position.set(0, 10, 0);
    this.scene.add(hemiLight);
    this.sceneLights.push(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff8ee, 0.9 * profile.lightIntensity);
    keyLight.position.set(1.4, 2.4, 2.4);
    keyLight.castShadow = profile.shadows;
    if (profile.shadows) {
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.bias = -0.0001;
      keyLight.shadow.normalBias = 0.02;
    }
    this.scene.add(keyLight);
    this.sceneLights.push(keyLight);

    const fillLight = new THREE.DirectionalLight(0xe8f0fe, 0.42 * profile.lightIntensity);
    fillLight.position.set(-1.4, 1.6, 1.3);
    this.scene.add(fillLight);
    this.sceneLights.push(fillLight);

    if (!profile.shadows) {
      const rimLight = new THREE.DirectionalLight(0xffffff, 0.55 * profile.lightIntensity);
      rimLight.position.set(0, 2.2, -2.2);
      this.scene.add(rimLight);
      this.sceneLights.push(rimLight);
    }
  }

  public setSceneLightsEnabled(enabled: boolean): void {
    this.sceneLights.forEach((light) => {
      light.visible = enabled;
      light.intensity = enabled ? Math.max(light.intensity, 0.001) : 0;
    });
  }

  public setShadowsEnabled(enabled: boolean): void {
    this.renderer.shadowMap.enabled = enabled;
    this.renderer.shadowMap.autoUpdate = enabled;
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if ('castShadow' in mesh) {
        mesh.castShadow = enabled;
      }
      if ('receiveShadow' in mesh) {
        mesh.receiveShadow = enabled;
      }
    });
  }

  public setEnvironmentEnabled(enabled: boolean): void {
    if (enabled) {
      this.scene.background = this.sceneBackgroundColor !== null ? new THREE.Color(this.sceneBackgroundColor) : null;
      return;
    }
    this.scene.background = null;
  }

  public getScene(): THREE.Scene {
    return this.scene;
  }

  public getSceneLights(): THREE.Light[] {
    return [...this.sceneLights];
  }

  public getBackgroundColor(): THREE.ColorRepresentation | null {
    return this.sceneBackgroundColor;
  }

  public setAvatarEnabled(enabled: boolean): void {
    if (this.activeAvatar) {
      this.activeAvatar.visible = enabled;
    }
  }

  public setAvatarAnimationEnabled(enabled: boolean): void {
    if (this.activeAvatar) {
      this.activeAvatar.animationController.setEnabled(enabled);
    }
  }

  public setAvatarVrmUpdateEnabled(enabled: boolean): void {
    if (this.activeAvatar) {
      (this.activeAvatar as unknown as { setVrmUpdateEnabled?: (enabled: boolean) => void }).setVrmUpdateEnabled?.(enabled);
    }
  }

  public setSceneEmpty(): void {
    const avatar = this.activeAvatar;
    if (avatar) {
      avatar.visible = false;
    }
    this.setSceneLightsEnabled(false);
    this.setShadowsEnabled(false);
    this.setEnvironmentEnabled(false);
  }

  public restoreSceneState(): void {
    if (this.activeAvatar) {
      this.activeAvatar.visible = true;
    }
    this.setSceneLightsEnabled(true);
    this.setShadowsEnabled(this.getQualityProfile().shadows);
    this.setEnvironmentEnabled(true);
  }

  private setupResizeHandling(): void {
    window.addEventListener('resize', this.handleResize);

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.handleResize();
      });
      this.resizeObserver.observe(this.container);
    }
  }

  private setupVisibilityHandling(): void {
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  private handleVisibilityChange(): void {
    this.isDocumentHidden = document.visibilityState === 'hidden';
    this.applyRendererQuality();
    if (this.isDocumentHidden) {
      this.renderDuration = 0;
      this.jsUpdateDuration = 0;
      this.pendingFrameWork = null;
    }
  }

  public handleResize(): void {
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.applyRendererQuality();
    this.renderer.setSize(width, height);

    if (this.activeAvatar) {
      this.frameAvatar(this.activeAvatar);
    }
  }

  public frameAvatar(avatar: IAvatar): void {
    const bounds = avatar.getBounds();
    const aspect = this.camera.aspect;

    let targetY = 1.3;
    if (bounds.headPosition) {
      targetY = bounds.headPosition.y - 0.1;
    } else if (bounds.height > 0) {
      targetY = bounds.center.y + bounds.height * 0.25;
    }

    const targetX = bounds.center.x;
    const targetZ = bounds.center.z;

    this.controls.target.set(targetX, targetY, targetZ);

    const characterHeight = bounds.height > 0 ? bounds.height : 1.6;
    let baseDistance = characterHeight * 0.95;

    if (aspect < 1.0) {
      const portraitFactor = Math.min(1.0 / Math.max(aspect, 0.45), 1.6);
      baseDistance *= portraitFactor;
    }

    this.camera.position.set(targetX, targetY + 0.05, targetZ + baseDistance);
    this.controls.update();
  }

  public setAvatar(avatar: IAvatar): void {
    if (this.activeAvatar && this.activeAvatar !== avatar) {
      this.scene.remove(this.activeAvatar.vrm.scene);
    }

    this.activeAvatar = avatar;
    this.scene.add(avatar.vrm.scene);
    this.frameAvatar(avatar);

    const attached = avatar.vrm.scene.parent === this.scene;
    avatarDiagnostics.mark('scene-attached', {
      attached,
      visible: avatar.visible,
      modelUrl: avatar.modelUrl,
    });
    if (avatar.visible) {
      avatarDiagnostics.mark('avatar-visible', true);
    }
    this.publishSceneDiagnostics();
  }

  /**
   * Mirrors the live readiness of the avatar scene onto the diagnostics channel.
   * Cheap by design: only publishes when the readiness tuple actually changes.
   */
  private publishSceneDiagnostics(): void {
    const readiness = this.getAvatarReadiness();
    const key = `${readiness.avatarLoaded}|${readiness.avatarInScene}|${readiness.avatarVisible}|${readiness.rendererActive}`;
    if (key === this.lastPublishedDiagnosticsKey) return;
    this.lastPublishedDiagnosticsKey = key;

    avatarDiagnostics.setSceneState(
      readiness.avatarLoaded,
      readiness.avatarInScene,
      readiness.avatarVisible,
      readiness.rendererActive,
    );

    if (readiness.rendererActive) {
      avatarDiagnostics.mark('renderer-active', { framesRendered: this.framesRendered });
    }
  }

  public removeAvatar(): void {
    if (this.activeAvatar) {
      this.scene.remove(this.activeAvatar.vrm.scene);
      this.activeAvatar = null;
    }
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.clock.start();
    this.pendingFrameWork = null;
    this.lastFrameTimestamp = null;

    const loop = () => {
      if (!this.isRunning) return;

      const now = performance.now();
      const previousFrameTimestamp = this.lastFrameTimestamp ?? now;
      const frameIntervalMs = now - previousFrameTimestamp;
      this.lastFrameTimestamp = now;

      const frameStart = now;
      const rawDelta = this.clock.getDelta();
      const delta = Number.isFinite(rawDelta)
        ? Math.min(Math.max(rawDelta, 0.001), 0.1)
        : 1 / 60;
      const frameMs = delta * 1000;

      const jsTickStart = performance.now();
      const sceneUpdateStart = performance.now();
      if (!this.isDocumentHidden && this.activeAvatar) {
        this.activeAvatar.update(delta);
      }
      this.lastFrameDiagnostics.sceneManagerUpdateMs = performance.now() - sceneUpdateStart;
      this.controls.update();
      this.jsUpdateDuration = performance.now() - jsTickStart;
      this.lastFrameDiagnostics.avatarUpdateMs = this.activeAvatar?.getLastUpdateTimingMs() ?? 0;
      this.lastFrameDiagnostics.animationUpdateMs = this.activeAvatar?.animationController.getLastUpdateTimingMs() ?? 0;
      this.lastFrameDiagnostics.expressionUpdateMs = this.activeAvatar?.animationController.getLastExpressionUpdateTimingMs() ?? 0;
      this.lastFrameDiagnostics.vrmUpdateMs = this.activeAvatar?.getLastVrmUpdateTimingMs() ?? 0;

      const renderStart = performance.now();
      if (!this.isDocumentHidden) {
        this.renderer.render(this.scene, this.camera);
      }
      this.renderDuration = performance.now() - renderStart;
      this.lastFrameDiagnostics.frameIntervalMs = frameIntervalMs;
      this.lastFrameDiagnostics.simulationDeltaMs = frameMs;
      this.lastFrameDiagnostics.renderMs = this.renderDuration;
      this.lastFrameDiagnostics.totalFrameMs = performance.now() - frameStart;
      this.lastFrameDiagnostics.unexplainedMs = Math.max(
        0,
        this.lastFrameDiagnostics.totalFrameMs - this.jsUpdateDuration - this.renderDuration
      );
      this.lastFrameDiagnostics.sceneManagerUpdateMs = Math.max(this.lastFrameDiagnostics.sceneManagerUpdateMs, 0);

      // Publish the PREVIOUS frame's measured work against the wall-clock
      // interval in which it actually ran. `frameIntervalMs` /
      // `simulationDeltaMs` are both measured at the top of this iteration, so
      // they describe [previous RAF -> this RAF] — the interval that contained
      // the pending work, not the work computed below.
      if (!this.isDocumentHidden && frameIntervalMs > 0 && this.pendingFrameWork) {
        const work = this.pendingFrameWork;
        this.frameSampleBuffer.push({
          seq: ++this.frameSampleSeq,
          timestamp: previousFrameTimestamp,
          rawFrameMs: frameIntervalMs,
          simulationDeltaMs: frameMs,
          updateMs: work.updateMs,
          renderCpuMs: work.renderCpuMs,
          avatarUpdateMs: work.avatarUpdateMs,
          animationUpdateMs: work.animationUpdateMs,
          expressionUpdateMs: work.expressionUpdateMs,
          vrmUpdateMs: work.vrmUpdateMs,
          drawCalls: work.drawCalls,
          triangles: work.triangles,
        });
        if (this.frameSampleBuffer.length > this.maxFrameSamples) {
          this.frameSampleBuffer.splice(0, this.frameSampleBuffer.length - this.maxFrameSamples);
        }
        this.pendingFrameWork = null;
      }

      if (!this.isDocumentHidden) {
        this.framesRendered += 1;
        // One-shot: record that the renderer has really drawn the avatar scene.
        if (!this.diagnosticsRendererActive && this.isAvatarInScene()) {
          this.publishSceneDiagnostics();
          this.diagnosticsRendererActive = this.isRendererActive();
        }
      }

      // Hold this frame's work until the next RAF tells us the interval it ran in.
      if (this.isDocumentHidden) {
        this.pendingFrameWork = null;
      } else {
        const renderInfo = this.renderer.info.render;
        this.pendingFrameWork = {
          timestamp: now,
          updateMs: this.jsUpdateDuration,
          renderCpuMs: this.renderDuration,
          avatarUpdateMs: this.lastFrameDiagnostics.avatarUpdateMs,
          animationUpdateMs: this.lastFrameDiagnostics.animationUpdateMs,
          expressionUpdateMs: this.lastFrameDiagnostics.expressionUpdateMs,
          vrmUpdateMs: this.lastFrameDiagnostics.vrmUpdateMs,
          drawCalls: renderInfo.calls ?? 0,
          triangles: renderInfo.triangles ?? 0,
        };
      }

      this.frameSamples.push(frameMs);
      if (this.frameSamples.length > 120) {
        this.frameSamples.shift();
      }
      const averageFrameMs = this.frameSamples.reduce((sum, value) => sum + value, 0) / this.frameSamples.length;
      this.averageFrameTime = averageFrameMs;
      this.lastFrameMs = frameMs;
      this.lastFps = Math.min(120, 1000 / Math.max(frameMs, 1));
      this.averageFps = this.frameSamples.length > 0 ? 1000 / averageFrameMs : this.lastFps;
      this.emitPerformanceSnapshot(frameMs);

      this.animationFrameId = requestAnimationFrame(loop);
    };

    this.animationFrameId = requestAnimationFrame(loop);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.clock.stop();
  }

  public dispose(): void {
    this.stop();

    window.removeEventListener('resize', this.handleResize);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    this.controls.dispose();

    if (this.activeAvatar) {
      this.removeAvatar();
    }

    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) {
        mesh.geometry.dispose();
      }
      if (mesh.material) {
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose());
        } else {
          mesh.material.dispose();
        }
      }
    });

    this.renderer.dispose();

    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}
