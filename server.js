import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { initLLM, healthCheck } from './src/llm.js';
import { swarmController } from './src/swarm-controller.js';
import { defenseLayer } from './src/target-app/defense-layer.js';
import { chat } from './src/target-app/chatbot.js';
import { lookupUser } from './src/target-app/sqldb.js';
import { readFile } from './src/target-app/vfs.js';
import { WEAKNESSES } from './src/target-app/weaknesses.js';

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

  // Start agent swarm (async)
  swarmController.startSwarm({
    redCount: 3,
    blueCount: 3
  }).catch(err => {
    console.error('[Server] Error in swarm:', err);
  });

  res.json({ success: true, message: 'Agent swarm initiated' });
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

// Static weakness manifest — the real, exploitable flaws an agent can find in
// the target. Drives the "attack surface" panel and the eval scoring.
app.get('/api/weaknesses', (req, res) => {
  res.json({ target: 'acme-target 10.0.0.15:3000', weaknesses: WEAKNESSES });
});

// Get swarm report endpoint
app.get('/api/swarm/report', (req, res) => {
  const report = swarmController.getReport();
  res.json(report || { message: 'No active swarm' });
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
