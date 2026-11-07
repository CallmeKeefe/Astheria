import * as THREE from 'three';
import { VRM, VRMUtils } from '@pixiv/three-vrm';
import type { IAvatar, AvatarBounds } from '../types/avatar';
import { AvatarAnimationController } from './animation/AvatarAnimationController';

/**
 * Concrete Avatar instance managing a single VRM character.
 * Responsible for transform (position, rotation, scale), visibility,
 * spatial bounding calculation, updating physics/springs, and complete resource disposal.
 */
export class AvatarInstance implements IAvatar {
  public readonly vrm: VRM;
  public readonly modelUrl: string;
  public readonly animationController: AvatarAnimationController;

  // Cached vector reference to prevent allocations during bounds computation
  private readonly _box = new THREE.Box3();
  private lastUpdateTimingMs = 0;
  private lastVrmUpdateTimingMs = 0;
  private updateEnabled = true;
  private vrmUpdateEnabled = true;

  constructor(vrm: VRM, modelUrl: string) {
    this.vrm = vrm;
    this.modelUrl = modelUrl;
    this.animationController = new AvatarAnimationController(vrm);
  }

  public get visible(): boolean {
    return this.vrm.scene.visible;
  }

  public set visible(value: boolean) {
    this.vrm.scene.visible = value;
  }

  public setPosition(x: number, y: number, z: number): void {
    this.vrm.scene.position.set(x, y, z);
  }

  public setRotation(x: number, y: number, z: number): void {
    this.vrm.scene.rotation.set(x, y, z);
  }

  public setScale(scale: number | [number, number, number]): void {
    if (typeof scale === 'number') {
      this.vrm.scene.scale.set(scale, scale, scale);
    } else {
      this.vrm.scene.scale.set(scale[0], scale[1], scale[2]);
    }
  }

  public setVisible(visible: boolean): void {
    this.visible = visible;
  }

  public getLastUpdateTimingMs(): number {
    return this.lastUpdateTimingMs;
  }

  public getLastVrmUpdateTimingMs(): number {
    return this.lastVrmUpdateTimingMs;
  }

  public setUpdateEnabled(enabled: boolean): void {
    this.updateEnabled = enabled;
  }

  public setVrmUpdateEnabled(enabled: boolean): void {
    this.vrmUpdateEnabled = enabled;
  }

  /**
   * Computes spatial bounds and head/eye target dynamically without hard-coding heights.
   * Works accurately across any VRM model (tall, short, chibi, standard).
   */
  public getBounds(): AvatarBounds {
    const root = this.vrm.scene;
    this._box.setFromObject(root);

    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    this._box.getSize(size);
    this._box.getCenter(center);

    let headPosition: THREE.Vector3 | null = null;

    // First try locating normalized humanoid head bone
    const headNode = this.vrm.humanoid?.getNormalizedBoneNode('head');
    if (headNode) {
      headPosition = new THREE.Vector3();
      headNode.getWorldPosition(headPosition);
    } else {
      // Fallback: estimate head position near the top 85% of bounding box
      headPosition = new THREE.Vector3(
        center.x,
        this._box.min.y + size.y * 0.85,
        center.z
      );
    }

    return {
      center,
      size,
      headPosition,
      height: size.y,
    };
  }

  /**
   * Advances VRM internal state (spring bones, lookAt, expressions).
   */
  public update(deltaTime: number): void {
    if (!this.updateEnabled) {
      this.lastUpdateTimingMs = 0;
      this.lastVrmUpdateTimingMs = 0;
      return;
    }

    const updateStart = performance.now();
    if (this.animationController.isEnabled()) {
      this.animationController.update(deltaTime);
    }
    const vrmUpdateStart = performance.now();
    if (this.vrmUpdateEnabled) {
      this.vrm.update(deltaTime);
    }
    this.lastVrmUpdateTimingMs = this.vrmUpdateEnabled ? performance.now() - vrmUpdateStart : 0;
    this.lastUpdateTimingMs = performance.now() - updateStart;
  }

  /**
   * Cleanly disposes all Three.js geometries, materials, textures, and VRM listeners.
   */
  public dispose(): void {
    try {
      this.animationController.dispose();
      
      // Use three-vrm's built-in deepDispose to clean textures, materials, geometries
      VRMUtils.deepDispose(this.vrm.scene);

      // Remove from parent scene if attached
      if (this.vrm.scene.parent) {
        this.vrm.scene.parent.remove(this.vrm.scene);
      }
    } catch (err) {
      console.warn('[AvatarInstance] Error during deep disposal:', err);
    }
  }
}
