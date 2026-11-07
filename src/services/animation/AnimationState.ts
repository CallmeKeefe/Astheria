/**
 * All possible animation states for the avatar.
 * Only 'idle' is implemented now; others are typed placeholders for future use.
 */
export const AnimationStateName = {
  Idle: 'idle',
  Listening: 'listening',
  Thinking: 'thinking',
  Speaking: 'speaking',
  Happy: 'happy',
  Confused: 'confused',
  Surprised: 'surprised',
} as const;

export type AnimationStateName = typeof AnimationStateName[keyof typeof AnimationStateName];

/**
 * Configuration that each animation state can define.
 * Future states will populate these fields with their own behavior parameters.
 */
export interface AnimationStateConfig {
  /** Human-readable label */
  readonly name: AnimationStateName;

  /** Whether idle procedural animation (breathing, sway) should run */
  readonly enableIdleMotion: boolean;

  /** Whether automatic blinking should run */
  readonly enableBlink: boolean;

  /** Whether subtle eye gaze movement should run */
  readonly enableEyeMovement: boolean;

  /** Intensity multiplier for body idle motion (0 = none, 1 = full) */
  readonly idleIntensity: number;

  /** Optional override expression to hold (e.g. 'happy', 'surprised') */
  readonly holdExpression?: string;

  /** Weight for the held expression (0–1) */
  readonly holdExpressionWeight?: number;
}

/**
 * Pre-defined state configs. Only idle has real behavioral tuning;
 * others are reasonable defaults that future phases will customize.
 */
export const ANIMATION_STATES: Record<AnimationStateName, AnimationStateConfig> = {
  [AnimationStateName.Idle]: {
    name: AnimationStateName.Idle,
    enableIdleMotion: true,
    enableBlink: true,
    enableEyeMovement: true,
    idleIntensity: 1.0,
  },
  [AnimationStateName.Listening]: {
    name: AnimationStateName.Listening,
    enableIdleMotion: true,
    enableBlink: true,
    enableEyeMovement: true,
    idleIntensity: 0.4,
  },
  [AnimationStateName.Thinking]: {
    name: AnimationStateName.Thinking,
    enableIdleMotion: true,
    enableBlink: true,
    enableEyeMovement: true,
    idleIntensity: 0.5,
  },
  [AnimationStateName.Speaking]: {
    name: AnimationStateName.Speaking,
    enableIdleMotion: true,
    enableBlink: true,
    enableEyeMovement: false,
    idleIntensity: 0.3,
  },
  [AnimationStateName.Happy]: {
    name: AnimationStateName.Happy,
    enableIdleMotion: true,
    enableBlink: true,
    enableEyeMovement: true,
    idleIntensity: 0.7,
    holdExpression: 'happy',
    holdExpressionWeight: 0.6,
  },
  [AnimationStateName.Confused]: {
    name: AnimationStateName.Confused,
    enableIdleMotion: true,
    enableBlink: true,
    enableEyeMovement: true,
    idleIntensity: 0.5,
  },
  [AnimationStateName.Surprised]: {
    name: AnimationStateName.Surprised,
    enableIdleMotion: false,
    enableBlink: false,
    enableEyeMovement: false,
    idleIntensity: 0.0,
    holdExpression: 'surprised',
    holdExpressionWeight: 0.8,
  },
};
