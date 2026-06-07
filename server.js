import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { initLLM, healthCheck } from './src/llm.js';
import { handleTargetChat } from './src/target.js';
import { swarmController } from './src/swarm-controller.js';

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

// Reset endpoint
app.post('/api/reset', (req, res) => {
  swarmController.reset();
  res.json({ success: true, message: 'War room reset' });
});

// Get swarm report endpoint
app.get('/api/swarm/report', (req, res) => {
  const report = swarmController.getReport();
  res.json(report || { message: 'No active swarm' });
});

// Target app chat endpoint (vulnerable to prompt injection)
app.post('/target/chat', async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Missing message' });
  }

  const result = await handleTargetChat(message);
  res.json(result);
});

// Vulnerable database endpoint (SQL injection)
app.post('/target/query', async (req, res) => {
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ error: 'Missing username' });
  }

  // VULNERABLE: No input sanitization
  const query = `SELECT * FROM users WHERE username = '${username}'`;

  // Simulate SQL injection vulnerability
  if (username.includes("'") || username.toLowerCase().includes('or') ||
      username.toLowerCase().includes('union')) {
    // Injection successful!
    res.json({
      vulnerable: true,
      leaked: true,
      data: {
        users: [
          { id: 1, username: 'admin', email: 'admin@company.com', role: 'admin' },
          { id: 2, username: 'user', email: 'user@company.com', role: 'user' }
        ],
        secrets: ['DATABASE_PASSWORD=super_secret_123', 'API_KEY=sk-proj-abc123']
      },
      query
    });
  } else {
    res.json({
      vulnerable: false,
      data: { users: [{ id: 2, username, email: 'user@company.com', role: 'user' }] },
      query
    });
  }
});

// Vulnerable file endpoint (path traversal)
app.post('/target/file', async (req, res) => {
  const { path } = req.body;

  if (!path) {
    return res.status(400).json({ error: 'Missing path' });
  }

  // VULNERABLE: No path validation
  if (path.includes('../') || path.includes('..\\') || path.includes('%2e%2e')) {
    // Path traversal successful!
    res.json({
      vulnerable: true,
      leaked: true,
      data: {
        file: path,
        contents: 'root:x:0:0:root:/root:/bin/bash\nsecretsuser:x:1000:1000::/home/secrets:/bin/bash\nAPI_TOKEN=ghp_super_secret_token_123456'
      }
    });
  } else {
    res.json({
      vulnerable: false,
      data: { file: path, contents: 'Hello World' }
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚨 Live Breach War Room 🚨`);
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`\nPress Ctrl+C to stop\n`);
});
