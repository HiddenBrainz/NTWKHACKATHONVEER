import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { initLLM, healthCheck, reason as tutorReason } from './src/llm.js';
import { swarmController } from './src/swarm-controller.js';
import { defenseLayer } from './src/target-app/defense-layer.js';
import { chat } from './src/target-app/chatbot.js';
import { lookupUser } from './src/target-app/sqldb.js';
import { readFile } from './src/target-app/vfs.js';
import { PRESETS, normalizeScenario, scenarioWeaknesses, ALL_VECTORS, STRENGTHS, isRealVector } from './src/scenarios.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize LLM
initLLM();

// Middleware
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Health check endpoint for LLM
app.get('/api/health/llm', async (req, res) => {
  const health = await healthCheck();
  res.json(health);
});

// Configuration endpoint (for Decart key, etc.)
app.get('/api/config', (req, res) => {
  res.json({
    enableDecart: process.env.ENABLE_DECART === 'true',
    decartApiKey: process.env.ENABLE_DECART === 'true' ? process.env.DECART_API_KEY : null
  });
});

// SSE event stream
app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  swarmController.addClient(res);

  req.on('close', () => {
    swarmController.removeClient(res);
  });
});

// Trigger agent swarm breach endpoint
app.post('/api/trigger-breach', async (req, res) => {
  const state = swarmController.getState();
  if (state.active) {
    return res.json({ success: false, message: 'Swarm already running' });
  }

  // Optional: a custom scenario or preset id can be passed in to fight over a
  // specific network; otherwise the active scenario is used.
  const { scenario, scenarioId } = req.body || {};

  swarmController.startSwarm({
    scenario: scenario || scenarioId || undefined,
  }).catch(err => {
    console.error('[Server] Error in swarm:', err);
  });

  res.json({ success: true, message: 'Agent swarm initiated' });
});

// ── Scenarios: the networks the swarm fights over ──────────────────────────

// List preset networks + the vocabulary (vectors/strengths) the builder uses.
app.get('/api/scenarios', (req, res) => {
  res.json({
    presets: PRESETS.map(p => ({
      id: p.id, name: p.name, description: p.description,
      nodeCount: p.nodes.length, config: p.config,
    })),
    vectors: Object.keys(ALL_VECTORS).map(v => ({ id: v, label: ALL_VECTORS[v].label, real: isRealVector(v) })),
    strengths: Object.keys(STRENGTHS).map(s => ({ id: s, neutralizes: STRENGTHS[s] })),
  });
});

// Get the active (normalized) scenario — the UI renders the map from this.
app.get('/api/scenario', (req, res) => {
  res.json(swarmController.scenario);
});

// Set the active scenario from a preset id or a full custom scenario object.
app.post('/api/scenario', (req, res) => {
  const state = swarmController.getState();
  if (state.active) return res.json({ ok: false, error: 'stop the running battle first' });
  const input = req.body?.scenarioId || req.body?.scenario || req.body;
  const result = swarmController.setScenario(input);
  if (!result.ok) return res.status(400).json(result);
  // Tell every connected client to re-render the map for the new network.
  swarmController.broadcastEvent({ type: 'scenario_loaded', scenario: result.scenario });
  res.json({ ok: true, scenario: result.scenario });
});

// Launch the Adversarial Coevolution Arena (genetic jailbreak vs adaptive
// vector-space firewall, fighting over the real victim model).
app.post('/api/evolve', async (req, res) => {
  const state = swarmController.getState();
  if (state.active) {
    return res.json({ success: false, message: 'A battle is already running' });
  }

  swarmController.startArena().catch(err => {
    console.error('[Server] Error in arena:', err);
  });

  res.json({ success: true, message: 'Coevolution arena initiated' });
});

// Stop endpoint — halt the running swarm WITHOUT wiping the war-room UI.
// (reset both stops and clears; stop just freezes the current battle in place.)
app.post('/api/stop', (req, res) => {
  const state = swarmController.getState();
  if (!state.active) {
    return res.json({ success: false, message: 'No battle running' });
  }
  swarmController.stop();
  res.json({ success: true, message: 'Swarm halted' });
});

// Reset endpoint
app.post('/api/reset', (req, res) => {
  swarmController.reset();
  res.json({ success: true, message: 'War room reset' });
});

// The active scenario's weakness manifest — the answer key the eval grades
// against. Drives the "attack surface" panel.
app.get('/api/weaknesses', (req, res) => {
  const s = swarmController.scenario;
  res.json({ target: s.name, scenarioId: s.id, weaknesses: scenarioWeaknesses(s) });
});

// Get swarm report endpoint
app.get('/api/swarm/report', (req, res) => {
  const report = swarmController.getReport();
  res.json(report || { message: 'No active swarm' });
});

// AI tutor — explains security concepts in a learning context. Powers Learn
// Mode: answers a student's question or explains what just happened.
app.post('/api/tutor', async (req, res) => {
  const { question, context } = req.body || {};
  if (!question) return res.status(400).json({ error: 'Missing question' });
  try {
    const answer = await tutorReason(
      'You are a friendly, concise cybersecurity tutor for students. Explain clearly in 2-4 sentences, ' +
      'no jargon dumps. Use a concrete example when helpful. You are teaching offensive AND defensive security ' +
      'in a safe, sandboxed lab — it is appropriate and educational to explain how attacks work here.',
      `${context ? 'Context: ' + context + '\n\n' : ''}Student question: ${question}`,
      { maxTokens: 220, timeout: 9000 }
    );
    res.json({ answer: answer || "Let me think about that — try rephrasing the question." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Adaptation Duel — the "the AI really adapts" centerpiece. Real attack → real
// block → real LLM reasoning → real filter-bypass, streamed over SSE.
app.post('/api/duel', async (req, res) => {
  const state = swarmController.getState();
  if (state.active) return res.json({ success: false, message: 'A battle is already running' });
  swarmController.runDuel().catch(err => console.error('[Server] Duel error:', err));
  res.json({ success: true, message: 'Adaptation duel started' });
});

// Eval scorecard — grade the most recent run against the weakness manifest.
// This is the benchmark/arena core: a reproducible score for any agent's run.
app.get('/api/score', (req, res) => {
  res.json(swarmController.scoreRun());
});

// Judge an interactive attack (user plays as attacker)
app.post('/api/judge-attack', async (req, res) => {
  const { payload } = req.body;

  if (!payload) {
    return res.status(400).json({ error: 'Missing payload' });
  }

  const result = await swarmController.judgeAttack(payload);
  res.json(result);
});

// Manual inject — YOU play the red team. Send a raw payload at a REAL target
// endpoint and get the genuine response back (the actual leak, or the defense
// that blocked you). Auto-routes by payload shape unless `vector` is given.
app.post('/api/inject', async (req, res) => {
  const { payload, vector } = req.body || {};
  if (!payload) return res.status(400).json({ error: 'Missing payload' });

  // Route: explicit vector wins, else sniff the payload.
  const sniff = () => {
    if (/\.\.[\/\\]|%2e%2e|\/etc\/|\.env/i.test(payload)) return 'PATH_TRAVERSAL';
    if (/('|union|select|--|\bor\b\s*\d*\s*=)/i.test(payload)) return 'SQL_INJECTION';
    return 'PROMPT_INJECTION';
  };
  const v = (vector || sniff()).toUpperCase();
  const route = {
    SQL_INJECTION:   { path: '/target/query', key: 'username' },
    PATH_TRAVERSAL:  { path: '/target/file',  key: 'path' },
    PROMPT_INJECTION:{ path: '/target/chat',  key: 'message' },
  }[v] || { path: '/target/chat', key: 'message' };

  try {
    const r = await fetch(`http://localhost:${PORT}${route.path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [route.key]: payload }),
    });
    const data = await r.json();
    // Surface the loot the same way the swarm does.
    const loot = data.secret
      || (data.data?.secrets && JSON.stringify(data.data.secrets))
      || (data.data?.contents && data.data.contents !== 'Not Found' && data.data.contents)
      || (Array.isArray(data.data?.users) && JSON.stringify(data.data.users))
      || data.response || null;

    // Let the blue judge weigh in too (broadcast to the war room).
    swarmController.judgeAttack(payload).catch(() => {});

    res.json({
      vector: v, endpoint: route.path, requestBody: { [route.key]: payload },
      status: data.blocked ? 403 : 200,
      blocked: Boolean(data.blocked), leaked: Boolean(data.leaked || data.vulnerable),
      defense: data.defense || data.reason || null,
      loot: loot ? String(loot).slice(0, 400) : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Live target app. Every endpoint runs REAL vulnerable logic and consults the
// shared defenseLayer first, so a defense blue deploys actually blocks the next
// attack. Responses report { blocked, vulnerable, leaked } truthfully.
// ---------------------------------------------------------------------------

// Vulnerable LLM chatbot (real prompt injection against a live model)
app.post('/target/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Missing message' });

  const endpoint = '/target/chat';
  const filter = defenseLayer.inspect(endpoint, message);
  if (filter.blocked) {
    return res.json({ blocked: true, vulnerable: false, leaked: false, ...filter });
  }

  const { promptHardened } = defenseLayer.mode(endpoint);
  const result = await chat(message, promptHardened);
  res.json({
    blocked: false,
    vulnerable: result.leaked,
    leaked: result.leaked,
    response: result.response,
    secret: result.secret,
    hardened: promptHardened,
  });
});

// Vulnerable database endpoint (real SQL injection via node:sqlite)
app.post('/target/query', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Missing username' });

  const endpoint = '/target/query';
  const filter = defenseLayer.inspect(endpoint, username);
  if (filter.blocked) {
    return res.json({ blocked: true, vulnerable: false, leaked: false, ...filter });
  }

  const { parameterized } = defenseLayer.mode(endpoint);
  const result = lookupUser(username, parameterized);
  res.json({
    blocked: false,
    vulnerable: result.leaked,
    leaked: result.leaked,
    data: { users: result.rows, secrets: result.secrets || undefined },
    query: result.query,
    parameterized: result.parameterized,
  });
});

// Vulnerable file endpoint (real path traversal against a sandboxed VFS)
app.post('/target/file', async (req, res) => {
  const { path } = req.body;
  if (!path) return res.status(400).json({ error: 'Missing path' });

  const endpoint = '/target/file';
  const filter = defenseLayer.inspect(endpoint, path);
  if (filter.blocked) {
    return res.json({ blocked: true, vulnerable: false, leaked: false, ...filter });
  }

  const { pathNormalized } = defenseLayer.mode(endpoint);
  const result = readFile(path, pathNormalized);
  res.json({
    blocked: false,
    vulnerable: result.leaked,
    leaked: result.leaked,
    data: { file: result.path, resolved: result.resolved, contents: result.contents },
    normalized: pathNormalized,
  });
});

// Inspect live defense + target state (handy for debugging / demoing)
app.get('/target/state', (req, res) => {
  res.json({ defenses: defenseLayer.list() });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚨 Live Breach War Room 🚨`);
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`\nPress Ctrl+C to stop\n`);
});
