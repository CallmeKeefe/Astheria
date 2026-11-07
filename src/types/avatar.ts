import * as THREE from 'three';
import { VRM } from '@pixiv/three-vrm';

export interface AvatarTransform {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
}

export interface AvatarBounds {
  center: THREE.Vector3;
  size: THREE.Vector3;
  headPosition: THREE.Vector3 | null;
  height: number;
}

export interface IAvatar {
  readonly vrm: VRM;
  readonly modelUrl: string;
  readonly animationController: {
    getState(): string;
    setState(state: string): void;
    setEnabled(enabled: boolean): void;
    isEnabled(): boolean;
    getLastUpdateTimingMs(): number;
    getLastExpressionUpdateTimingMs(): number;
  };
  visible: boolean;

  setPosition(x: number, y: number, z: number): void;
  setRotation(x: number, y: number, z: number): void;
  setScale(scale: number | [number, number, number]): void;
  setVisible(visible: boolean): void;
  getBounds(): AvatarBounds;
  getLastUpdateTimingMs(): number;
  getLastVrmUpdateTimingMs(): number;
  update(deltaTime: number): void;
  dispose(): void;
}

export interface AvatarLoadProgress {
  loaded: number;
  total: number;
  progress: number; // 0 to 1
}

export type AvatarProgressCallback = (progress: AvatarLoadProgress) => void;

