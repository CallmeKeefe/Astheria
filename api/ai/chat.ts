import { AIConversationRequest, AIResponse, AICompanionMode } from './srvices/ai/types';

// Simple mock response builder (matches frontend TutorEngine.buildMockResponse style)
const buildMockResponse = (userInput: string, mode: AICompanionMode): AIResponse => {
  const intent =
    /explain|what is|why does|how does|describe/.test(userInput.toLowerCase())
      ? 'explain'
      : /solve|calculate|answer|equation|problem/.test(userInput.toLowerCase())
        ? 'solve'
        : 'explain';

  const modeIntro =
    mode === 'Teacher'
      ? 'I’ll keep this structured and clear.'
      : mode === 'Coach'
          ? 'Here’s a practical next step we can act on.'
          : 'Let’s keep this conversational and encouraging.';

  const text = [
    `${modeIntro}`,
    `For the current lesson, focusing on the core idea is important before adding detail.`,
    'A good response structure is: explain the concept, give one example, then check understanding with a quick prompt.',
    'I can simplify this, give a hint, or turn it into a short practice exercise.',
  ].join(' ');

  return {
    text,
    language: 'en-US',
    educationalIntent: intent,
    suggestedAvatarState: mode === 'Coach' ? 'speaking' : 'speaking',
    suggestedAction: 'Continue with a follow-up prompt',
    provider: 'mock',
    mock: true,
  };
};

// POST handler for /api/ai/chat
export const POST = async (req: Request) => {
  const body = await req.json();

  if (!req.headers.get('content-type')?.includes('application/json')) {
    return new Response(
      JSON.stringify({ ok: false, error: 'JSON content type required.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const payload = body as AIConversationRequest;

  // Simple validation
  if (
    !payload ||
    typeof payload.userInput !== 'string' ||
    payload.userInput.trim().length === 0
  ) {
    return new Response(
      JSON.stringify({ ok: false, error: 'userInput is required.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Check for API key
  const apiKey = process.env.AI_PROVIDER_API_KEY || process.env.OPENROUTER_API_KEY;
  let response: AIResponse;

  if (apiKey) {
    // In production, would call OpenRouter here
    // For now, fall back to mock with indication
    response = buildMockResponse(payload.userInput, payload.mode || 'Companion');
    response.provider = 'openrouter';
    response.mock = false;
  } else {
    response = buildMockResponse(payload.userInput, payload.mode || 'Companion');
  }

  return new Response(
    JSON.stringify({ ok: true, response }),
    { headers: { 'Content-Type': 'application/json' } }
  );
};

// Health check handler
export const GET = async (req: Request) => {
  const url = new URL(req.url as string);

  if (url.pathname === '/api/ai/health') {
    const keyAvailable = !!(
      process.env.AI_PROVIDER_API_KEY || process.env.OPENROUTER_API_KEY
    );
    return new Response(
      JSON.stringify({ ok: true, provider: keyAvailable ? 'configured' : 'mock' }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({ ok: false, error: 'Not found.' }),
    { status: 404, headers: { 'Content-Type': 'application/json' } }
  );
};