import http from 'node:http';

const PORT = Number(process.env.AI_SERVER_PORT || 3001);
const MAX_INPUT_LENGTH = Number(process.env.AI_MAX_INPUT_LENGTH || 2000);
const MAX_OUTPUT_LENGTH = Number(process.env.AI_MAX_OUTPUT_LENGTH || 1200);

const validateRequest = (payload) => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Request body must be an object.');
  }

  if (typeof payload.userInput !== 'string' || payload.userInput.trim().length === 0) {
    throw new Error('userInput is required.');
  }

  if (payload.userInput.length > MAX_INPUT_LENGTH) {
    throw new Error('userInput exceeds the maximum supported length.');
  }

  if (payload.messages && (!Array.isArray(payload.messages) || payload.messages.length > 12)) {
    throw new Error('messages must be an array with up to 12 entries.');
  }

  if (payload.language && typeof payload.language !== 'string') {
    throw new Error('language must be a string.');
  }

  if (payload.mode && !['Teacher', 'Companion', 'Coach'].includes(payload.mode)) {
    throw new Error('mode is invalid.');
  }
};

const sanitizeText = (value, maxLength) => {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
};

const inferIntent = (input) => {
  const source = input.toLowerCase();

  if (/explain|what is|why does|how does|describe/.test(source)) return 'explain';
  if (/solve|calculate|answer|equation|problem/.test(source)) return 'solve';
  if (/hint|clue|nudge/.test(source)) return 'hint';
  if (/practice|quiz|exercise|drill/.test(source)) return 'practice';
  if (/summarize|summary|wrap up/.test(source)) return 'summarize';
  if (/review|recap|go over/.test(source)) return 'review';
  if (/translate|translation/.test(source)) return 'translate';
  if (/grammar|sentence|verb|tense|correct/.test(source)) return 'grammar';
  if (/vocabulary|word|phrase|meaning/.test(source)) return 'vocabulary';
  if (/write|essay|paragraph|draft/.test(source)) return 'writing';
  if (/read|passage|reading/.test(source)) return 'reading';
  if (/speak|pronounce|conversation|talk/.test(source)) return 'speaking';
  if (/check|understand|concept/.test(source)) return 'concept-check';
  return 'explain';
};

const chooseAvatarState = (intent, mode) => {
  if (intent === 'practice' || intent === 'quiz') return 'happy';
  if (intent === 'concept-check') return 'confused';
  if (mode === 'Coach') return 'speaking';
  return 'speaking';
};

const buildMockResponse = (payload) => {
  const intent = payload.interactionType || inferIntent(payload.userInput);
  const mode = payload.mode || 'Companion';
  const prompt = sanitizeText(payload.userInput, 160);
  const modeLine =
    mode === 'Teacher'
      ? 'I’ll keep this structured and clear.'
      : mode === 'Coach'
        ? 'Here’s a practical next step we can act on.'
        : 'Let’s keep this conversational and encouraging.';

  const text = [
    `${modeLine}`,
    `For “${prompt}”, the key is to focus on the underlying idea before diving into details.`,
    'A useful response structure is: explain the concept, give one example, and then check understanding with a quick prompt.',
    'If you want, I can simplify this, give a hint, or turn it into a short practice exercise.',
  ].join(' ');

  return {
    text: sanitizeText(text, MAX_OUTPUT_LENGTH),
    language: payload.language || 'en-US',
    educationalIntent: intent,
    suggestedAvatarState: chooseAvatarState(intent, mode),
    suggestedAction: 'Continue with a follow-up prompt',
    provider: 'mock',
    mock: true,
  };
};

const handleOpenAIProvider = async (payload) => {
  const apiKey = process.env.AI_PROVIDER_API_KEY;
  const baseUrl = process.env.AI_PROVIDER_BASE_URL || 'https://api.openai.com/v1';
  const model = process.env.AI_PROVIDER_MODEL || 'gpt-4o-mini';

  if (!apiKey) {
    return null;
  }

  const messages = [
    {
      role: 'system',
      content: `You are a helpful educational companion. Keep responses concise, friendly, and educational. Mode: ${payload.mode || 'Companion'}.`,
    },
    ...payload.messages
      .slice(-10)
      .map((message) => ({
        role: message.role,
        content: sanitizeText(message.content, 2000),
      })),
    { role: 'user', content: sanitizeText(payload.userInput, 2000) },
  ];

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 500,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || 'AI provider request failed.');
  }

  const result = await response.json();
  const content = result?.choices?.[0]?.message?.content;

  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('AI provider returned no usable content.');
  }

  const intent = payload.interactionType || inferIntent(payload.userInput);

  return {
    text: sanitizeText(content, MAX_OUTPUT_LENGTH),
    language: payload.language || 'en-US',
    educationalIntent: intent,
    suggestedAvatarState: chooseAvatarState(intent, payload.mode || 'Companion'),
    suggestedAction: 'Continue with a follow-up prompt',
    provider: 'openai',
    mock: false,
  };
};

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');

  if (req.method === 'GET' && requestUrl.pathname === '/api/ai/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, provider: process.env.AI_PROVIDER_API_KEY ? 'configured' : 'mock' }));
    return;
  }

  if (req.method !== 'POST' || requestUrl.pathname !== '/api/ai/chat') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Not found.' }));
    return;
  }

  try {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });

    req.on('end', async () => {
      try {
        const payload = raw ? JSON.parse(raw) : {};
        validateRequest(payload);

        let response;
        if (process.env.AI_PROVIDER_API_KEY) {
          try {
            response = await handleOpenAIProvider(payload);
          } catch (error) {
            console.warn('[ai-server] OpenAI provider failed, falling back to mock provider:', error instanceof Error ? error.message : error);
            response = buildMockResponse(payload);
          }
        } else {
          response = buildMockResponse(payload);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, response }));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to process AI request.';
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: message }));
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error.';
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: message }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[ai-server] running on http://localhost:${PORT}`);
  console.log('[ai-server] mode:', process.env.AI_PROVIDER_API_KEY ? 'configured provider' : 'mock provider');
});
