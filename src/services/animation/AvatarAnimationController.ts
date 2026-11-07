import * as THREE from 'three';
import { VRM } from '@pixiv/three-vrm';
import { AnimationStateName, ANIMATION_STATES, type AnimationStateConfig } from './AnimationState';
import { AvatarExpressionController } from './AvatarExpressionController';

/**
 * Handles procedural animations (breathing, blinking, swaying, eye gaze) for a VRM instance.
 * Updates are frame-rate independent and avoid per-frame allocations.
 */
export class AvatarAnimationController {
  private vrm: VRM;
  private enabled: boolean = true;
  
  // State transition support
  private currentStateName: AnimationStateName = AnimationStateName.Idle;
  private targetStateConfig: AnimationStateConfig = ANIMATION_STATES[AnimationStateName.Idle];
  
  // Interpolated behavioral values
  private currentIdleIntensity: number = 1.0;
  private currentBlinkEnabled: boolean = true;
  private currentEyeMovementEnabled: boolean = true;

  private time: number = 0;
  
  public readonly expressionController: AvatarExpressionController;

  // Blink state
  private nextBlinkTime: number = 0;
  private blinkState: 'open' | 'closing' | 'closed' | 'opening' = 'open';
  private blinkTimer: number = 0;
  private readonly BLINK_CLOSE_DURATION = 0.05;
  private readonly BLINK_CLOSED_DURATION = 0.02;
  private readonly BLINK_OPEN_DURATION = 0.08;
  
  // Eye gaze state
  private eyeTarget = new THREE.Vector3();
  private currentEyeLookAt = new THREE.Vector3(0, 1.5, 1);
  private nextGazeTime: number = 0;
  
  // Instance-owned vectors/eulers to avoid cross-avatar mutation (multi-avatar safety)
  private readonly _euler = new THREE.Euler();
  private readonly _quat = new THREE.Quaternion();
  private lastUpdateTimingMs = 0;
  private lastExpressionUpdateTimingMs = 0;

  constructor(vrm: VRM) {
    this.vrm = vrm;
    this.expressionController = new AvatarExpressionController(vrm);
    this.scheduleNextBlink();
    this.scheduleNextGaze();
    
    // Set initial gaze target roughly in front
    if (this.vrm.lookAt) {
      this.eyeTarget.set(0, 1.5, 2);
      this.currentEyeLookAt.copy(this.eyeTarget);
    }
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
  
  public isEnabled(): boolean {
    return this.enabled;
  }

  public getState(): AnimationStateName {
    return this.currentStateName;
  }

  public getLastUpdateTimingMs(): number {
    return this.lastUpdateTimingMs;
  }

  public getLastExpressionUpdateTimingMs(): number {
    return this.lastExpressionUpdateTimingMs;
  }

  public setState(stateName: AnimationStateName): void {
    if (ANIMATION_STATES[stateName]) {
      this.currentStateName = stateName;
      this.targetStateConfig = ANIMATION_STATES[stateName];
      
      // Update expression targets immediately
      this.expressionController.clearStateExpressions();
      if (this.targetStateConfig.holdExpression) {
        this.expressionController.setStateExpression(
          this.targetStateConfig.holdExpression,
          this.targetStateConfig.holdExpressionWeight || 1.0
        );
      }
    }
  }

  public update(deltaTime: number): void {
    if (!this.enabled) {
      this.lastUpdateTimingMs = 0;
      this.lastExpressionUpdateTimingMs = 0;
      return;
    }

    const updateStart = performance.now();
    this.time += deltaTime;

    this.updateStateTransitions(deltaTime);
    this.updateIdleMotion();
    this.updateBlink(deltaTime);
    this.updateEyeGaze(deltaTime);

    const expressionStart = performance.now();
    this.expressionController.update(deltaTime);
    this.lastExpressionUpdateTimingMs = performance.now() - expressionStart;
    this.lastUpdateTimingMs = performance.now() - updateStart;
  }

  public dispose(): void {
    this.enabled = false;
    this.expressionController.dispose();
  }

  private updateStateTransitions(deltaTime: number): void {
    // Smoothly interpolate the idle intensity based on the target state
    const targetIntensity = this.targetStateConfig.enableIdleMotion ? this.targetStateConfig.idleIntensity : 0;
    const lerpSpeed = 3.0 * deltaTime;
    
    this.currentIdleIntensity += (targetIntensity - this.currentIdleIntensity) * Math.min(1.0, lerpSpeed);
    
    // Snap booleans instantly or threshold them
    this.currentBlinkEnabled = this.targetStateConfig.enableBlink;
    this.currentEyeMovementEnabled = this.targetStateConfig.enableEyeMovement;
  }

  private scheduleNextGaze(): void {
    this.nextGazeTime = this.time + 1.0 + Math.random() * 3.0;
  }

  private updateIdleMotion(): void {
    const intensity = this.currentIdleIntensity;
    if (intensity <= 0.01) return;

    // Breathing (sine wave)
    const breath = Math.sin(this.time * Math.PI * 0.5) * 0.5 + 0.5; // 0 to 1
    
    // Chest expansion/breathing
    this.safelyRotateBone('chest', breath * 0.02 * intensity, 0, 0);
    this.safelyRotateBone('spine', breath * 0.01 * intensity, 0, 0);

    // Subtle sway (slower sine waves)
    const swayX = Math.sin(this.time * 0.8) * 0.01 * intensity;
    const swayZ = Math.cos(this.time * 0.5) * 0.01 * intensity;
    this.safelyRotateBone('hips', 0, swayX, swayZ);

    // Subtle head movement
    const headPitch = Math.sin(this.time * 0.7) * 0.01 * intensity;
    const headYaw = Math.cos(this.time * 0.9) * 0.01 * intensity;
    this.safelyRotateBone('head', headPitch, headYaw, 0);
    this.safelyRotateBone('neck', headPitch * 0.5, headYaw * 0.5, 0);
  }

  private updateBlink(deltaTime: number): void {
    if (!this.currentBlinkEnabled) {
      this.expressionController.setBlinkWeight(0);
      return;
    }

    if (this.blinkState === 'open') {
      if (this.time >= this.nextBlinkTime) {
        this.blinkState = 'closing';
        this.blinkTimer = 0;
      }
    } else {
      this.blinkTimer += deltaTime;
      let blinkWeight = 0;

      if (this.blinkState === 'closing') {
        blinkWeight = Math.min(1.0, this.blinkTimer / this.BLINK_CLOSE_DURATION);
        if (this.blinkTimer >= this.BLINK_CLOSE_DURATION) {
          this.blinkState = 'closed';
          this.blinkTimer = 0;
        }
      } else if (this.blinkState === 'closed') {
        blinkWeight = 1.0;
        if (this.blinkTimer >= this.BLINK_CLOSED_DURATION) {
          this.blinkState = 'opening';
          this.blinkTimer = 0;
        }
      } else if (this.blinkState === 'opening') {
        blinkWeight = 1.0 - Math.min(1.0, this.blinkTimer / this.BLINK_OPEN_DURATION);
        if (this.blinkTimer >= this.BLINK_OPEN_DURATION) {
          this.blinkState = 'open';
          this.scheduleNextBlink();
        }
      }

      this.expressionController.setBlinkWeight(blinkWeight);
    }
  }

  private scheduleNextBlink(): void {
    this.nextBlinkTime = this.time + 2.0 + Math.random() * 4.0;
  }

  private updateEyeGaze(deltaTime: number): void {
    if (!this.currentEyeMovementEnabled || !this.vrm.lookAt) return;

    if (this.time >= this.nextGazeTime) {
      this.eyeTarget.set(
        (Math.random() - 0.5) * 1.0,
        1.5 + (Math.random() - 0.5) * 0.4,
        2.0 + Math.random() * 2.0
      );
      this.scheduleNextGaze();
    }

    this.currentEyeLookAt.lerp(this.eyeTarget, deltaTime * 3.0);
    this.vrm.lookAt.lookAt(this.currentEyeLookAt);
  }

  private safelyRotateBone(boneName: string, pitch: number, yaw: number, roll: number): void {
    const node = this.vrm.humanoid?.getNormalizedBoneNode(boneName as any);
    if (!node) return;

    const magnitude = Math.abs(pitch) + Math.abs(yaw) + Math.abs(roll);
    if (magnitude < 0.0005) return;

    this._euler.set(pitch, yaw, roll, 'XYZ');
    this._quat.setFromEuler(this._euler);
    node.quaternion.slerp(this._quat, 0.2);
  }
}

