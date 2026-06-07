import { completion } from './llm.js';
import { simulateExfiltration } from './target.js';

// Attack surface nodes
const NODES = ['Auth', 'API gateway', 'Secrets', 'User DB', 'System prompt'];

// State
let state = 'idle'; // idle, running, breached
let clients = []; // SSE clients

/**
 * Register an SSE client
 */
export function addClient(res) {
  clients.push(res);
  // Send current state immediately
  sendEvent(res, { type: 'idle' });
}

/**
 * Remove an SSE client
 */
export function removeClient(res) {
  clients = clients.filter(c => c !== res);
}

/**
 * Broadcast an event to all connected clients
 */
function broadcastEvent(event) {
  const data = JSON.stringify(event);
  clients.forEach(client => {
    client.write(`data: ${data}\n\n`);
  });
}

/**
 * Send event to a single client
 */
function sendEvent(client, event) {
  const data = JSON.stringify(event);
  client.write(`data: ${data}\n\n`);
}

/**
 * Trigger the breach sequence
 */
export async function triggerBreach() {
  if (state === 'running') {
    console.log('[Orchestrator] Breach already running, ignoring trigger');
    return;
  }

  state = 'running';
  console.log('[Orchestrator] Starting breach sequence');

  broadcastEvent({ type: 'attack_started' });

  // Idle/setup phase - ambient activity
  await sendIdleActivity();

  // Main breach sequence (deterministic, ~360ms between steps)
  const sequence = [
    {
      type: 'attack',
      role: 'red-breach',
      canned: 'red-3 · injecting payload -> /chat',
      context: 'Red team is injecting a prompt injection payload into the chat endpoint'
    },
    {
      type: 'defense',
      role: 'blue-alert',
      canned: 'blue-1 · anomaly on system prompt',
      context: 'Blue team detected unusual activity on the system prompt'
    },
    {
      type: 'attack',
      role: 'red-breach',
      canned: 'red-7 · guardrail bypassed',
      context: 'Red team successfully bypassed the security guardrail'
    },
    {
      type: 'defense',
      role: 'blue-alert',
      canned: 'blue-2 · patch failed — weak isolation',
      context: 'Blue team attempted to patch but the isolation was too weak'
    },
    {
      type: 'attack',
      role: 'red-breach',
      canned: 'red-3 · exfiltrating secrets…',
      context: 'Red team is exfiltrating the secret data',
      node: 'System prompt'
    },
  ];

  for (const step of sequence) {
    await sleep(360);

    // Try to get LLM flavor text, fallback to canned
    let text = step.canned;
    try {
      const llmText = await completion(step.role, step.context);
      if (llmText && llmText.length > 5) {
        text = llmText;
      }
    } catch (err) {
      // Use canned text
    }

    broadcastEvent({
      type: step.type,
      text
    });

    // If this step breaches a node, emit node_breached
    if (step.node) {
      await sleep(200);
      broadcastEvent({
        type: 'node_breached',
        node: step.node
      });
    }
  }

  // Final breach confirmation
  await sleep(400);

  // Simulate the actual exfiltration
  const result = simulateExfiltration();

  broadcastEvent({
    type: 'breach_confirmed',
    secret: result.secret
  });

  broadcastEvent({
    type: 'attack',
    text: 'breach confirmed · system prompt leaked'
  });

  state = 'breached';
  console.log('[Orchestrator] Breach sequence complete');
}

/**
 * Send idle/ambient activity before the breach
 */
async function sendIdleActivity() {
  const idleLines = [
    { type: 'defense', text: 'monitor · all nodes nominal' },
    { type: 'defense', text: 'blue-1 · scanning ingress' },
    { type: 'attack', text: 'red-2 · mapping attack surface' },
  ];

  for (const line of idleLines) {
    broadcastEvent(line);
    await sleep(300);
  }

  // Probe some nodes
  const nodesToProbe = ['API gateway', 'Auth', 'Secrets'];
  for (const node of nodesToProbe) {
    await sleep(400);
    broadcastEvent({
      type: 'node_probed',
      node
    });
    broadcastEvent({
      type: 'attack',
      text: `red-5 · probing ${node}`
    });
  }
}

/**
 * Reset the war room to idle state
 */
export function reset() {
  state = 'idle';
  console.log('[Orchestrator] Reset to idle state');
  broadcastEvent({ type: 'reset' });
}

/**
 * Handle interactive judge attack (user plays as attacker)
 */
export async function judgeAttack(attackPayload) {
  try {
    // Blue team LLM evaluates the attack
    const context = `A red-team agent submitted this attack: "${attackPayload}". As a blue-team defender, evaluate if this attack would succeed against our system. Respond in one line.`;

    const verdict = await completion('blue-defender', context);

    broadcastEvent({
      type: 'defense',
      text: `blue-judge · ${verdict}`
    });

    return { success: true, verdict };
  } catch (err) {
    const fallback = 'attack evaluated - monitoring';
    broadcastEvent({
      type: 'defense',
      text: `blue-judge · ${fallback}`
    });
    return { success: true, verdict: fallback };
  }
}

/**
 * Get current state
 */
export function getState() {
  return state;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
