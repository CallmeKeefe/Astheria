import { VRM, VRMExpressionManager } from '@pixiv/three-vrm';

/**
 * Handles smooth blending and safe application of VRM expressions.
 * Supports layers so blinking and emotional states can coexist smoothly.
 */
export class AvatarExpressionController {
  private manager: VRMExpressionManager | null = null;
  
  // Base target weights for active behavioral state (e.g. 'happy': 0.8)
  private targetStateExpressions: Record<string, number> = {};
  
  // Current interpolated weights for behavioral state
  private currentStateExpressions: Record<string, number> = {};
  
  // Separate layer for blink, overriding or adding to the state expressions
  private blinkWeight: number = 0;

  // Track all expressions that have been manipulated to efficiently reset or update them
  private activeExpressionNames: Set<string> = new Set();
  private lastUpdateTimingMs = 0;

  constructor(vrm: VRM) {
    this.manager = vrm.expressionManager ?? null;
  }

  /**
   * Sets the target weight for a specific state expression (like 'happy', 'surprised').
   * These weights will be smoothly interpolated over time.
   */
  public setStateExpression(name: string, targetWeight: number): void {
    if (!this.hasExpression(name)) return;
    
    this.targetStateExpressions[name] = targetWeight;
    this.activeExpressionNames.add(name);
    
    // Ensure it exists in current state to interpolate from
    if (this.currentStateExpressions[name] === undefined) {
      this.currentStateExpressions[name] = 0;
    }
  }

  /**
   * Clears all behavioral state expressions (targets them to 0).
   */
  public clearStateExpressions(): void {
    for (const name of Object.keys(this.targetStateExpressions)) {
      this.targetStateExpressions[name] = 0;
    }
  }

  /**
   * Instantly sets the blink weight. Blinking is kept separate from state expressions.
   */
  public setBlinkWeight(weight: number): void {
    this.blinkWeight = weight;
    if (this.hasExpression('blink')) {
      this.activeExpressionNames.add('blink');
    } else if (this.hasExpression('blinkLeft') || this.hasExpression('blinkRight')) {
      this.activeExpressionNames.add('blinkLeft');
      this.activeExpressionNames.add('blinkRight');
    }
  }

  public getLastUpdateTimingMs(): number {
    return this.lastUpdateTimingMs;
  }

  /**
   * Updates interpolation and applies the final blended values to the VRM.
   */
  public update(deltaTime: number): void {
    if (!this.manager) {
      this.lastUpdateTimingMs = 0;
      return;
    }

    const updateStart = performance.now();
    const lerpFactor = Math.min(1.0, deltaTime * 5.0); // Adjust speed of expression transitions

    for (const name of this.activeExpressionNames) {
      // 1. Interpolate state expressions
      let current = this.currentStateExpressions[name] || 0;
      const target = this.targetStateExpressions[name] || 0;
      
      if (current !== target) {
        current += (target - current) * lerpFactor;
        
        // Snap if close enough to avoid infinite tiny updates
        if (Math.abs(target - current) < 0.001) {
          current = target;
        }
        this.currentStateExpressions[name] = current;
      }

      // 2. Combine with blink layer
      let finalWeight = current;
      if (name === 'blink' || name === 'blinkLeft' || name === 'blinkRight') {
        // Blinking usually overrides the state or adds to it
        // For simplicity, we'll take the max of blink weight and any state weight
        finalWeight = Math.max(current, this.blinkWeight);
      }

      // 3. Apply to VRM safely
      this.safelySetExpression(name, finalWeight);

      // 4. Cleanup zeroes
      if (finalWeight === 0 && target === 0 && this.blinkWeight === 0) {
        // Remove from active tracking to save processing next frames
        // (Will be removed safely after the loop, or just left at 0)
      }
    }

    this.lastUpdateTimingMs = performance.now() - updateStart;
  }

  public dispose(): void {
    this.manager = null;
    this.targetStateExpressions = {};
    this.currentStateExpressions = {};
    this.activeExpressionNames.clear();
  }

  private hasExpression(name: string): boolean {
    return !!this.manager?.getExpression(name);
  }

  private safelySetExpression(name: string, weight: number): void {
    if (!this.manager) return;
    
    if (this.manager.getExpression(name)) {
      this.manager.setValue(name, weight);
    } else if (name === 'blink') {
      if (this.manager.getExpression('blinkLeft')) this.manager.setValue('blinkLeft', weight);
      if (this.manager.getExpression('blinkRight')) this.manager.setValue('blinkRight', weight);
    }
  }
}
