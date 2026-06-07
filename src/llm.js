import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

const LLM_TIMEOUT = 800;

// Canned fallback responses by role
const FALLBACKS = {
  'red-attacker': 'probing attack surface...',
  'blue-defender': 'monitoring defensive perimeter...',
  'red-breach': 'injecting payload...',
  'blue-alert': 'anomaly detected...',
};

let anthropic = null;
let openai = null;
let provider = null;

// Initialize the appropriate provider
export function initLLM() {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (anthropicKey) {
    anthropic = new Anthropic({ apiKey: anthropicKey });
    provider = 'anthropic';
    console.log('[LLM] Initialized with Anthropic');
  } else if (openaiKey) {
    openai = new OpenAI({ apiKey: openaiKey });
    provider = 'openai';
    console.log('[LLM] Initialized with OpenAI');
  } else {
    console.log('[LLM] No API keys found - using fallback mode only');
    provider = 'fallback';
  }
}

/**
 * Provider-agnostic LLM completion with timeout and fallback
 * @param {string} role - One of: red-attacker, blue-defender, red-breach, blue-alert
 * @param {string} context - Additional context for the completion
 * @returns {Promise<string>} - The generated text or fallback
 */
export async function completion(role, context = '') {
  const fallback = FALLBACKS[role] || 'system processing...';

  if (provider === 'fallback') {
    return fallback;
  }

  const systemPrompts = {
    'red-attacker': 'You are a red-team AI agent. Write one short, technical attack log line (max 60 chars). Be concise and use hacker jargon.',
    'blue-defender': 'You are a blue-team AI defender. Write one short defensive log line (max 60 chars). Be concise and technical.',
    'red-breach': 'You are a red-team AI executing a breach. Write one short, dramatic attack line (max 60 chars).',
    'blue-alert': 'You are a blue-team AI detecting a breach. Write one short alert line (max 60 chars).',
  };

  const prompt = `${context}\n\nWrite one line:`;

  try {
    const result = await Promise.race([
      generateCompletion(systemPrompts[role], prompt),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), LLM_TIMEOUT)
      )
    ]);

    return result.trim().slice(0, 80); // Safety truncation
  } catch (err) {
    if (err.message === 'timeout') {
      console.log(`[LLM] Timeout for ${role}, using fallback`);
    } else {
      console.log(`[LLM] Error for ${role}:`, err.message);
    }
    return fallback;
  }
}

async function generateCompletion(systemPrompt, userPrompt) {
  if (provider === 'anthropic') {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-20250514',
      max_tokens: 100,
      messages: [{ role: 'user', content: `${systemPrompt}\n\n${userPrompt}` }],
    });
    return response.content[0].text;
  } else if (provider === 'openai') {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 100,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
    });
    return response.choices[0].message.content;
  }
  throw new Error('No provider available');
}

/**
 * Health check for LLM connectivity
 */
export async function healthCheck() {
  if (provider === 'fallback') {
    return { status: 'fallback', provider: 'none' };
  }

  try {
    await Promise.race([
      generateCompletion('You are a test.', 'Say "ok"'),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 2000)
      )
    ]);
    return { status: 'ok', provider };
  } catch (err) {
    console.error('[LLM] Health check failed:', err.message);
    return { status: 'error', provider, error: err.message };
  }
}
