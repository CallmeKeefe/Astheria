import { CompanionEngine } from './CompanionEngine';
import { ConversationEngine } from './ConversationEngine';
import { TutorEngine } from './TutorEngine';
import type { AIConversationRequest, AIMessage, AIResponse, AIAvatarState } from './types';
import { SAFE_AVATAR_STATES } from './types';

export class AIService {
  private activeAbort: AbortController | null = null;

  public async sendMessage(request: {
    companionId: string;
    companionName: string;
    mode: AIConversationRequest['mode'];
    language: string;
    learningLanguage: string;
    userInput: string;
    interactionType?: AIConversationRequest['interactionType'];
    currentTopic?: string;
    currentGoal?: string;
    messages: AIMessage[];
  }): Promise<AIResponse> {
    const requestPayload = ConversationEngine.buildRequest(request);
    this.activeAbort?.abort();
    const controller = new AbortController();
    this.activeAbort = controller;

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(errorBody || 'AI request failed.');
      }

      const data = (await response.json()) as Partial<AIResponse> & { response?: Partial<AIResponse> };
      const safeResponse = this.validateResponse(data.response ?? data);
      if (!safeResponse) {
        throw new Error('AI response validation failed.');
      }

      return safeResponse;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('cancelled');
      }
      const fallback = TutorEngine.buildMockResponse(requestPayload);
      fallback.text = `${fallback.text} (development fallback)`;
      fallback.provider = 'mock';
      fallback.mock = true;
      return fallback;
    } finally {
      if (this.activeAbort?.signal === controller.signal) {
        this.activeAbort = null;
      }
    }
  }

  public cancel(): void {
    this.activeAbort?.abort();
    this.activeAbort = null;
  }

  private validateResponse(data: Partial<AIResponse>): AIResponse | null {
    if (!data || typeof data !== 'object') return null;

    const text = typeof data.text === 'string' ? data.text.trim() : '';
    if (!text) return null;

    const language = typeof data.language === 'string' && data.language.trim() ? data.language : 'en-US';
    const educationalIntent = typeof data.educationalIntent === 'string' ? data.educationalIntent : 'explain';
    const suggestedAvatarState = typeof data.suggestedAvatarState === 'string' && SAFE_AVATAR_STATES.has(data.suggestedAvatarState as AIAvatarState)
      ? (data.suggestedAvatarState as AIAvatarState)
      : 'speaking';

    return {
      text,
      language,
      educationalIntent: educationalIntent as AIResponse['educationalIntent'],
      suggestedAvatarState,
      suggestedAction: typeof data.suggestedAction === 'string' ? data.suggestedAction : undefined,
      provider: typeof data.provider === 'string' ? data.provider : 'mock',
      mock: Boolean(data.mock),
    };
  }
}

export const aiService = new AIService();
export const companionModeTone = CompanionEngine.getModeTone;
