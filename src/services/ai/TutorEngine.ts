import type { AIAvatarState, AICompanionMode, AIConversationRequest, AIResponse, AITutorIntent } from './types';

export class TutorEngine {
  public static resolveModeTone(mode: AICompanionMode): string {
    switch (mode) {
      case 'Teacher':
        return 'clear and structured';
      case 'Companion':
        return 'warm and conversational';
      case 'Coach':
        return 'motivating and action-oriented';
      default:
        return 'supportive';
    }
  }

  public static inferIntent(userInput: string): AITutorIntent {
    const input = userInput.toLowerCase();

    if (/explain|what is|why does|how does|describe/.test(input)) return 'explain';
    if (/solve|calculate|answer|equation|problem/.test(input)) return 'solve';
    if (/hint|clue|nudge|start with/.test(input)) return 'hint';
    if (/practice|quiz|test me|exercise|drill/.test(input)) return 'practice';
    if (/summarize|summary|wrap up/.test(input)) return 'summarize';
    if (/review|recap|go over/.test(input)) return 'review';
    if (/translate|translation|in .*language|meaning of/.test(input)) return 'translate';
    if (/grammar|sentence|verb|tense|correct/.test(input)) return 'grammar';
    if (/vocabulary|word|phrase|meaning/.test(input)) return 'vocabulary';
    if (/write|essay|paragraph|draft/.test(input)) return 'writing';
    if (/read|passage|reading/.test(input)) return 'reading';
    if (/speak|pronounce|conversation|talk/.test(input)) return 'speaking';
    if (/check|understand|concept/.test(input)) return 'concept-check';
    return 'explain';
  }

  public static buildMockResponse(request: AIConversationRequest): AIResponse {
    const mode = request.mode;
    const intent = request.interactionType ?? this.inferIntent(request.userInput);
    const shortPrompt = request.userInput.trim() || 'the current lesson';
    const modeIntro =
      mode === 'Teacher'
        ? 'I’ll teach this clearly and check the key idea first.'
        : mode === 'Companion'
          ? 'Let’s make this feel natural and supportive while we work through it.'
          : 'Here’s a practical next step we can act on together.';

    const responseText = [
      `${modeIntro}`,
      `For “${shortPrompt.slice(0, 120)}”, the best next step is to focus on the core idea before the detail.`,
      'I’d break this into one clear explanation, one example, and one quick check for understanding.',
      'If you want, I can turn this into a short practice prompt, a hint, or a worked example.',
    ].join(' ');

    const suggestedAvatarState: AIAvatarState =
      intent === 'practice' || intent === 'quiz' ? 'happy' :
      intent === 'concept-check' ? 'confused' :
      'speaking';

    return {
      text: responseText,
      language: request.language || 'en-US',
      educationalIntent: intent,
      suggestedAvatarState,
      suggestedAction: 'Continue with a follow-up prompt',
      provider: 'mock',
      mock: true,
    };
  }
}
