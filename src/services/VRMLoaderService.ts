import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRM, VRMUtils } from '@pixiv/three-vrm';
import type { AvatarProgressCallback } from '../types/avatar';
import { avatarDiagnostics } from './avatar/AvatarDiagnostics';

/**
 * Service dedicated to loading VRM files.
 * Provides a clean abstraction that can load any VRM file (avatar.vrm, character2.vrm, etc.)
 * without coupling to Three.js scenes or renderers.
 */
export class VRMLoaderService {
  private loader: GLTFLoader;

  constructor() {
    this.loader = new GLTFLoader();

    // Register VRM plugin to parse VRM metadata, humanoid, expressions, springs, etc.
    this.loader.register((parser) => {
      return new VRMLoaderPlugin(parser);
    });
  }

  /**
   * Loads a VRM model from a given URL with progress tracking.
   */
  public async load(url: string, onProgress?: AvatarProgressCallback): Promise<VRM> {
    avatarDiagnostics.mark('load-start', url);

    return new Promise<VRM>((resolve, reject) => {
      this.loader.load(
        url,
        (gltf) => {
          avatarDiagnostics.mark('parse-complete', { hasUserData: Boolean(gltf.userData) });
          const vrm = gltf.userData.vrm as VRM | undefined;

          if (!vrm) {
            const error = new Error(`No VRM data found in asset: ${url}`);
            avatarDiagnostics.fail(error);
            reject(error);
            return;
          }

          avatarDiagnostics.mark('vrm-parsed', {
            metaVersion: (vrm.meta as { metaVersion?: string } | undefined)?.metaVersion ?? 'unknown',
          });

          try {
            // Disable frustum culling so mesh parts do not clip unexpectedly during head/arm movement
            vrm.scene.traverse((obj) => {
              obj.frustumCulled = false;
            });

            // Optimize geometry and joints
            VRMUtils.removeUnnecessaryVertices(gltf.scene);
            VRMUtils.removeUnnecessaryJoints(gltf.scene);

            // Rotate VRM0 models to face +Z (towards standard camera facing)
            VRMUtils.rotateVRM0(vrm);

            avatarDiagnostics.mark('vrm-processed');
            resolve(vrm);
          } catch (err) {
            const wrapped = new Error(`Failed to process VRM model: ${err instanceof Error ? err.message : String(err)}`);
            avatarDiagnostics.fail(wrapped);
            reject(wrapped);
          }
        },
        (event: ProgressEvent) => {
          const total = event.total > 0 ? event.total : 0;
          const loaded = event.loaded;
          const progress = total > 0 ? loaded / total : 0;
          avatarDiagnostics.setProgress(progress, loaded, total);
          onProgress?.({ loaded, total, progress });
        },
        (error) => {
          const detail = error instanceof Error ? error.message : String(error);
          const wrapped = new Error(`Unable to load VRM model from "${url}". Please ensure the file exists and is accessible. (${detail})`);
          avatarDiagnostics.fail(wrapped);
          reject(wrapped);
        }
      );
    });
  }
}

export const vrmLoaderService = new VRMLoaderService();

