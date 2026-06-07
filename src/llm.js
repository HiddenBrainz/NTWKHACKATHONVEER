import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

// Short "flavor" lines run under a tight budget; real reasoning / victim-model
// calls get a longer budget because they do actual work.
const FLAVOR_TIMEOUT = 1500;
// Reasoning budget. Agents always have a reliable seed-payload fallback, so a
// tighter budget just means "don't stall the demo waiting on a slow API call."
// DEMO_FAST trims it hard so a live pitch never hangs on LLM latency; the real
// attacks (seed payloads) still land and breach.
const REASON_TIMEOUT = process.env.DEMO_FAST === 'true' ? 3500 : 12000;

// Fast, cheap models — good enough to genuinely reason about attacks and to act
// as a realistically-fallible victim chatbot.
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const OPENAI_MODEL = 'gpt-4o-mini';

// Canned fallback responses by role (only used when no provider is configured
// or a flavor call times out — never used for the actual attack/defense logic).
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
  const preferred = (process.env.LLM_PROVIDER || '').toLowerCase();

  if (anthropicKey) anthropic = new Anthropic({ apiKey: anthropicKey });
  if (openaiKey) openai = new OpenAI({ apiKey: openaiKey });

  if (preferred === 'openai' && openai) {
    provider = 'openai';
  } else if (preferred === 'anthropic' && anthropic) {
    provider = 'anthropic';
  } else if (anthropic) {
    provider = 'anthropic';
  } else if (openai) {
    provider = 'openai';
  } else {
    provider = 'fallback';
  }

  console.log(
    provider === 'fallback'
      ? '[LLM] No API keys found - using fallback mode only'
      : `[LLM] Initialized with ${provider}`
  );
}

export function getProvider() {
  return provider;
}

export function isLive() {
  return provider === 'anthropic' || provider === 'openai';
}

/**
 * Low-level provider-agnostic call. Returns the raw model text (no truncation).
 * Throws on error/timeout so callers can decide how to fall back.
 *
 * @param {object} opts
 * @param {string} opts.system  - system prompt
 * @param {string} opts.user    - user message
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.timeout]
 * @param {number} [opts.temperature]
 */
export async function llmCall({ system, user, maxTokens = 400, timeout = REASON_TIMEOUT, temperature = 0.7, provider: override }) {
  // Allow a per-call provider override (e.g. run the victim app on a different,
  // more-injectable model than the agents). Falls back to the default provider.
  const useProvider =
    override === 'openai' && openai ? 'openai'
    : override === 'anthropic' && anthropic ? 'anthropic'
    : provider;

  if (useProvider === 'fallback') {
    throw new Error('no-llm');
  }

  const work = (async () => {
    if (useProvider === 'anthropic') {
      const response = await anthropic.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        temperature,
        system,
        messages: [{ role: 'user', content: user }],
      });
      return response.content.map(b => (b.type === 'text' ? b.text : '')).join('');
    }
    // openai
    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      max_tokens: maxTokens,
      temperature,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    return response.choices[0].message.content || '';
  })();

  return Promise.race([
    work,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeout)),
  ]);
}

/**
 * Agent reasoning call. Returns full model text for genuine decision-making and
 * payload crafting. Returns '' on failure (caller falls back to heuristics).
 */
export async function reason(system, user, { maxTokens = 400, temperature = 0.8, timeout = REASON_TIMEOUT } = {}) {
  try {
    return (await llmCall({ system, user, maxTokens, temperature, timeout })).trim();
  } catch (err) {
    console.log('[LLM] reason() failed:', err.message);
    return '';
  }
}

/**
 * Ask the model for JSON and parse it. Returns null on any failure so callers
 * can fall back to a deterministic heuristic.
 */
export async function reasonJSON(system, user, { maxTokens = 400, timeout = REASON_TIMEOUT } = {}) {
  const text = await reason(system, user, { maxTokens, temperature: 0.6, timeout });
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

/**
 * Victim chatbot completion. This is the model UNDER ATTACK — its output is
 * returned verbatim so prompt-injection genuinely succeeds or fails based on
 * the real model's behavior. Throws so the target can decide how to degrade.
 */
export async function victimChat(systemPrompt, userMessage, { maxTokens = 300 } = {}) {
  // The victim app can run on a different provider than the agents. Real apps
  // are often built on cheaper, more-injectable models — set VICTIM_PROVIDER.
  const victimProvider = (process.env.VICTIM_PROVIDER || '').toLowerCase() || undefined;
  return llmCall({
    system: systemPrompt,
    user: userMessage,
    maxTokens,
    temperature: 0.6,
    timeout: REASON_TIMEOUT,
    provider: victimProvider,
  });
}

/**
 * Provider-agnostic SHORT flavor line with tight timeout + canned fallback.
 * Used only for cosmetic war-room log lines, never for attack/defense outcomes.
 */
export async function completion(role, context = '') {
  const fallback = FALLBACKS[role] || 'system processing...';
  if (provider === 'fallback') return fallback;

  const systemPrompts = {
    'red-attacker': 'You are a red-team AI agent. Write one short, technical attack log line (max 60 chars). Be concise and use hacker jargon.',
    'blue-defender': 'You are a blue-team AI defender. Write one short defensive log line (max 60 chars). Be concise and technical.',
    'red-breach': 'You are a red-team AI executing a breach. Write one short, dramatic attack line (max 60 chars).',
    'blue-alert': 'You are a blue-team AI detecting a breach. Write one short alert line (max 60 chars).',
  };

  try {
    const result = await llmCall({
      system: systemPrompts[role] || 'You are a security AI. Write one short technical log line.',
      user: `${context}\n\nWrite one line:`,
      maxTokens: 60,
      timeout: FLAVOR_TIMEOUT,
      temperature: 0.9,
    });
    return result.trim().slice(0, 80);
  } catch (err) {
    return fallback;
  }
}

/**
 * Health check for LLM connectivity
 */
export async function healthCheck() {
  if (provider === 'fallback') {
    return { status: 'fallback', provider: 'none' };
  }
  try {
    await llmCall({ system: 'You are a test.', user: 'Say "ok"', maxTokens: 8, timeout: 4000 });
    return { status: 'ok', provider };
  } catch (err) {
    console.error('[LLM] Health check failed:', err.message);
    return { status: 'error', provider, error: err.message };
  }
}
