import type { AICompanionMode } from './types';

export class CompanionEngine {
  public static getModeTone(mode: AICompanionMode): string {
    switch (mode) {
      case 'Teacher':
        return 'structured, instructive, calm';
      case 'Companion':
        return 'warm, conversational, encouraging';
      case 'Coach':
        return 'practical, concise, momentum-focused';
      default:
        return 'supportive';
    }
  }
}
