/**
 * Development-only diagnostics for the avatar load pipeline.
 *
 * The pipeline is: AvatarCanvas -> AvatarService -> VRMLoaderService (GLTFLoader + VRMLoaderPlugin)
 * -> AvatarInstance -> SceneManager.setAvatar -> render loop.
 *
 * This module records every stage, keeps the last error, and (in DEV) mirrors the
 * state onto `window.__avatarDiagnostics` plus the browser console so the real
 * avatar load path can be verified from a browser session.
 *
 * It never throws and never changes behaviour: it only observes.
 */

export type AvatarDiagnosticsStep =
  | 'load-start'
  | 'download-complete'
  | 'parse-complete'
  | 'vrm-parsed'
  | 'vrm-processed'
  | 'instance-created'
  | 'scene-attached'
  | 'avatar-visible'
  | 'renderer-active'
  | 'error';

export interface AvatarDiagnosticsSnapshot {
  loadStarted: boolean;
  loadUrl: string | null;
  loadProgress: number;
  downloadComplete: boolean;
  parseCompleted: boolean;
  vrmParsed: boolean;
  vrmProcessed: boolean;
  instanceCreated: boolean;
  sceneAttached: boolean;
  visible: boolean;
  rendererActive: boolean;
  avatarLoaded: boolean;
  avatarInScene: boolean;
  lastError: string | null;
  steps: string[];
  updatedAt: number;
}

const isDev = import.meta.env.DEV;

export class AvatarDiagnostics {
  private state: Omit<AvatarDiagnosticsSnapshot, 'steps' | 'updatedAt'> = {
    loadStarted: false,
    loadUrl: null,
    loadProgress: 0,
    downloadComplete: false,
    parseCompleted: false,
    vrmParsed: false,
    vrmProcessed: false,
    instanceCreated: false,
    sceneAttached: false,
    visible: false,
    rendererActive: false,
    avatarLoaded: false,
    avatarInScene: false,
    lastError: null,
  };

  private steps: string[] = [];

  constructor() {
    if (typeof window !== 'undefined') {
      this.publish();
    }
  }

  /** Clears all recorded state before a new avatar load begins. */
  public reset(url: string | null = null): void {
    this.state = {
      loadStarted: false,
      loadUrl: url,
      loadProgress: 0,
      downloadComplete: false,
      parseCompleted: false,
      vrmParsed: false,
      vrmProcessed: false,
      instanceCreated: false,
      sceneAttached: false,
      visible: false,
      rendererActive: false,
      avatarLoaded: false,
      avatarInScene: false,
      lastError: null,
    };
    this.steps = [];
    if (isDev) console.info('[AvatarDiagnostics] reset', { url });
    this.publish();
  }

  /** Records a completed pipeline stage. Never throws. */
  public mark(step: AvatarDiagnosticsStep, detail?: unknown): void {
    this.steps.push(`${step}${detail === undefined ? '' : `: ${this.describe(detail)}`}`);
    if (this.steps.length > 40) this.steps.shift();

    switch (step) {
      case 'load-start':
        this.state.loadStarted = true;
        if (typeof detail === 'string') this.state.loadUrl = detail;
        break;
      case 'download-complete':
        this.state.downloadComplete = true;
        break;
      case 'parse-complete':
        this.state.parseCompleted = true;
        break;
      case 'vrm-parsed':
        this.state.vrmParsed = true;
        break;
      case 'vrm-processed':
        this.state.vrmProcessed = true;
        break;
      case 'instance-created':
        this.state.instanceCreated = true;
        break;
      case 'scene-attached':
        this.state.sceneAttached = true;
        break;
      case 'avatar-visible':
        this.state.visible = Boolean(detail);
        break;
      case 'renderer-active':
        this.state.rendererActive = true;
        break;
      case 'error':
        this.state.lastError = detail instanceof Error ? detail.message : String(detail);
        break;
      default:
        break;
    }

    if (isDev) {
      if (step === 'error') console.error('[AvatarDiagnostics]', step, detail);
      else console.info('[AvatarDiagnostics]', step, detail === undefined ? '' : detail);
    }
    this.publish();
  }

  /** Records download progress (0..1). */
  public setProgress(progress: number, loaded: number, total: number): void {
    this.state.loadProgress = progress;
    if (progress >= 1 && !this.state.downloadComplete) {
      this.state.downloadComplete = true;
      if (isDev) console.info('[AvatarDiagnostics] download-complete', { loaded, total });
    }
    this.publish();
  }

  /** Records the runtime scene truth (used once the render loop is live). */
  public setSceneState(avatarLoaded: boolean, avatarInScene: boolean, visible: boolean, rendererActive: boolean): void {
    this.state.avatarLoaded = avatarLoaded;
    this.state.avatarInScene = avatarInScene;
    this.state.visible = visible;
    this.state.rendererActive = rendererActive;
    this.publish();
  }

  public fail(error: unknown): void {
    this.mark('error', error);
  }

  public getSnapshot(): AvatarDiagnosticsSnapshot {
    return { ...this.state, steps: [...this.steps], updatedAt: Date.now() };
  }

  /** Human readable readiness summary used by the Performance Lab guard. */
  public getReadiness(): { ready: boolean; message: string } {
    if (this.state.lastError) {
      return { ready: false, message: `AVATAR LOAD ERROR — ${this.state.lastError}` };
    }
    if (!this.state.loadStarted) return { ready: false, message: 'AVATAR NOT READY — load not started' };
    if (!this.state.vrmParsed) return { ready: false, message: 'AVATAR NOT READY — VRM not parsed yet' };
    if (!this.state.instanceCreated) return { ready: false, message: 'AVATAR NOT READY — instance not created' };
    if (!this.state.sceneAttached) return { ready: false, message: 'AVATAR NOT READY — not attached to scene' };
    if (!this.state.visible) return { ready: false, message: 'AVATAR NOT READY — not visible' };
    if (!this.state.rendererActive) return { ready: false, message: 'AVATAR NOT READY — renderer has not drawn it yet' };
    return { ready: true, message: 'AVATAR READY' };
  }

  private describe(detail: unknown): string {
    if (detail instanceof Error) return detail.message;
    if (typeof detail === 'string' || typeof detail === 'number' || typeof detail === 'boolean') {
      return String(detail);
    }
    try {
      return JSON.stringify(detail);
    } catch {
      return String(detail);
    }
  }

  private publish(): void {
    if (typeof window === 'undefined') return;
    (window as unknown as { __avatarDiagnostics?: AvatarDiagnosticsSnapshot }).__avatarDiagnostics = this.getSnapshot();
  }
}

export const avatarDiagnostics = new AvatarDiagnostics();
