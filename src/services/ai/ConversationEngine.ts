import type { AIConversationRequest, AIMessage, AITutorIntent } from './types';

const MAX_MESSAGE_COUNT = 12;

export class ConversationEngine {
  public static buildRequest(payload: {
    companionId: string;
    companionName: string;
    mode: AIConversationRequest['mode'];
    language: string;
    learningLanguage: string;
    userInput: string;
    interactionType?: AITutorIntent;
    currentTopic?: string;
    currentGoal?: string;
    messages: AIMessage[];
  }): AIConversationRequest {
    const sanitizedInput = this.sanitizeText(payload.userInput, 2000);

    const messages = payload.messages
      .slice(-MAX_MESSAGE_COUNT)
      .map((message) => ({
        ...message,
        content: this.sanitizeText(message.content, 2000),
        language: message.language || payload.language || 'en-US',
      }));

    return {
      companionId: this.sanitizeText(payload.companionId, 128),
      companionName: this.sanitizeText(payload.companionName, 128),
      mode: payload.mode,
      language: payload.language || 'en-US',
      learningLanguage: payload.learningLanguage || payload.language || 'en-US',
      userInput: sanitizedInput,
      interactionType: payload.interactionType,
      currentTopic: payload.currentTopic ? this.sanitizeText(payload.currentTopic, 160) : undefined,
      currentGoal: payload.currentGoal ? this.sanitizeText(payload.currentGoal, 160) : undefined,
      messages,
    };
  }

  private static sanitizeText(value: string, maxLength: number): string {
    return String(value ?? '')
      .replace(/[\u0000-\u001F\u007F]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
  }
}
