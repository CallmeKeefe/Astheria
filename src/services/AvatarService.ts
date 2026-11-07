import { VRM } from '@pixiv/three-vrm';
import type { AvatarLoadProgress, AvatarProgressCallback, AvatarTransform } from '../types/avatar';
import { vrmLoaderService, VRMLoaderService } from './VRMLoaderService';
import { AvatarInstance } from './AvatarInstance';
import { avatarDiagnostics } from './avatar/AvatarDiagnostics';

/** Dev-only watchdog: a stalled parse must surface an explicit error, never an endless spinner. */
const LOAD_WATCHDOG_MS = import.meta.env.DEV ? 120_000 : 0;

/**
 * High-level Avatar service responsible for avatar lifecycle management:
 * loading, positioning, scaling, rotation, visibility, and disposal.
 * Leverages VRMLoaderService so characters like avatar.vrm, character2.vrm, character3.vrm
 * can be loaded dynamically without rewriting the renderer.
 */
export class AvatarService {
  private loader: VRMLoaderService;
  private currentAvatar: AvatarInstance | null = null;

  // Single-flight bookkeeping. React StrictMode double-invokes mount effects, which asks
  // for the same (large) VRM twice. Reusing the in-flight load keeps exactly one download
  // and one parse in the avatar load path instead of two competing ones.
  private inFlightUrl: string | null = null;
  private inFlightPromise: Promise<AvatarInstance> | null = null;
  private inFlightProgress: AvatarLoadProgress | null = null;
  private inFlightListeners: Set<AvatarProgressCallback> = new Set();

  constructor(loader: VRMLoaderService = vrmLoaderService) {
    this.loader = loader;
  }

  /**
   * Returns the active Avatar instance.
   */
  public get avatar(): AvatarInstance | null {
    return this.currentAvatar;
  }

  /**
   * Returns the raw VRM object if available (for backwards compatibility).
   */
  public get currentVrm(): VRM | null {
    return this.currentAvatar?.vrm ?? null;
  }

  /**
   * Loads a VRM avatar from URL, with optional initial transforms and progress callback.
   * Disposes of any previously loaded avatar managed by this service.
   */
  public async loadAvatar(
    url: string,
    onProgress?: AvatarProgressCallback,
    transform?: AvatarTransform
  ): Promise<AvatarInstance> {
    // Reuse an identical in-flight load instead of downloading/parsing the model again.
    if (this.inFlightPromise && this.inFlightUrl === url) {
      if (onProgress) {
        this.inFlightListeners.add(onProgress);
        if (this.inFlightProgress) onProgress(this.inFlightProgress);
      }
      return this.inFlightPromise;
    }

    // Dispose previous avatar to avoid memory leaks
    if (this.currentAvatar) {
      this.dispose();
    }

    avatarDiagnostics.reset(url);

    const listeners = new Set<AvatarProgressCallback>();
    if (onProgress) listeners.add(onProgress);
    this.inFlightListeners = listeners;
    this.inFlightProgress = null;
    this.inFlightUrl = url;

    const promise = (async () => {
      const vrm = await this.loader.load(url, (progressInfo) => {
        this.inFlightProgress = progressInfo;
        for (const listener of listeners) {
          try {
            listener(progressInfo);
          } catch (error) {
            if (import.meta.env.DEV) console.warn('[AvatarService] progress listener failed', error);
          }
        }
      });

      const avatar = new AvatarInstance(vrm, url);
      avatarDiagnostics.mark('instance-created', { modelUrl: url });

      if (transform) {
        if (transform.position) {
          avatar.setPosition(...transform.position);
        }
        if (transform.rotation) {
          avatar.setRotation(...transform.rotation);
        }
        if (transform.scale !== undefined) {
          avatar.setScale(transform.scale);
        }
      }

      this.currentAvatar = avatar;
      return avatar;
    })();

    this.inFlightPromise = promise;

    if (LOAD_WATCHDOG_MS > 0) {
      const watchdog = new Promise<never>((_, reject) => {
        setTimeout(() => {
          const snapshot = avatarDiagnostics.getSnapshot();
          if (snapshot.vrmProcessed) return;
          const checkpoint = snapshot.steps[snapshot.steps.length - 1] ?? 'no stage recorded';
          reject(
            new Error(
              `Avatar load watchdog: "${url}" did not finish within ${LOAD_WATCHDOG_MS / 1000}s ` +
                `(last stage: ${checkpoint}).`
            )
          );
        }, LOAD_WATCHDOG_MS);
      });
      // The watchdog only needs to reject the caller when the real load is still pending.
      promise.catch(() => undefined);
      try {
        return await Promise.race([promise, watchdog]);
      } catch (error) {
        avatarDiagnostics.fail(error);
        throw error;
      } finally {
        this.clearInFlight(promise);
      }
    }

    try {
      return await promise;
    } catch (error) {
      avatarDiagnostics.fail(error);
      throw error;
    } finally {
      this.clearInFlight(promise);
    }
  }

  private clearInFlight(promise: Promise<AvatarInstance>): void {
    if (this.inFlightPromise === promise) {
      this.inFlightUrl = null;
      this.inFlightPromise = null;
      this.inFlightProgress = null;
      this.inFlightListeners = new Set();
    }
  }


  /**
   * Sets the position of the current avatar.
   */
  public setPosition(x: number, y: number, z: number): void {
    this.currentAvatar?.setPosition(x, y, z);
  }

  /**
   * Sets the rotation (euler radians) of the current avatar.
   */
  public setRotation(x: number, y: number, z: number): void {
    this.currentAvatar?.setRotation(x, y, z);
  }

  /**
   * Sets the scale of the current avatar.
   */
  public setScale(scale: number | [number, number, number]): void {
    this.currentAvatar?.setScale(scale);
  }

  /**
   * Toggles visibility of the current avatar.
   */
  public setVisible(visible: boolean): void {
    this.currentAvatar?.setVisible(visible);
  }

  /**
   * Updates avatar physics and bones.
   */
  public update(deltaTime: number): void {
    this.currentAvatar?.update(deltaTime);
  }

  /**
   * Completely disposes of the current avatar's resources.
   */
  public dispose(): void {
    if (this.currentAvatar) {
      this.currentAvatar.dispose();
      this.currentAvatar = null;
    }
  }
}

export const avatarService = new AvatarService();
