import { avatarService } from '../AvatarService';
import { AnimationStateName } from '../animation/AnimationState';
import type { VoiceSessionManager } from '../audio/VoiceSessionManager';

export class AvatarVoiceBridge {
  private readonly unsubscribe: () => void;

  constructor(session: VoiceSessionManager) {
    const onEvent = (event: 'listening-started' | 'speaking-started' | 'speaking-ended' | 'speaking-cancelled' | 'error') => {
      if (event === 'listening-started') {
        this.setState(AnimationStateName.Listening);
      } else if (event === 'speaking-started') {
        this.setState(AnimationStateName.Speaking);
      } else {
        this.setState(AnimationStateName.Idle);
      }
    };

    const unsubscribers = [
      session.on('listening-started', () => onEvent('listening-started')),
      session.on('speaking-started', () => onEvent('speaking-started')),
      session.on('speaking-ended', () => onEvent('speaking-ended')),
      session.on('speaking-cancelled', () => onEvent('speaking-cancelled')),
      session.on('error', () => onEvent('error')),
    ];
    this.unsubscribe = () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }

  public dispose(): void {
    this.unsubscribe();
  }

  private setState(state: AnimationStateName): void {
    const controller = avatarService.avatar?.animationController;
    if (controller?.isEnabled()) {
      controller.setState(state);
    }
  }
}
