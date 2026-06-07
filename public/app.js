// State
let config = null;
let decartModule = null;
let cameraActive = false;

// DOM elements
const container = document.getElementById('container');
const breachAlert = document.getElementById('breachAlert');
const statusPill = document.getElementById('statusPill');
const statusText = statusPill.querySelector('.status-text');
const meterFill = document.getElementById('meterFill');
const meterValue = document.getElementById('meterValue');
const liveFeed = document.getElementById('liveFeed');
const camPlaceholder = document.getElementById('camPlaceholder');
const camVideo = document.getElementById('camVideo');
const camOverlay = document.getElementById('camOverlay');
const triggerBtn = document.getElementById('triggerBtn');
const resetBtn = document.getElementById('resetBtn');
const attackInput = document.getElementById('attackInput');
const attackBtn = document.getElementById('attackBtn');

// Node mapping
const nodeMap = {
  'Auth': 'node-auth',
  'API gateway': 'node-api',
  'Secrets': 'node-secrets',
  'User DB': 'node-db',
  'System prompt': 'node-prompt'
};

const edgeMap = {
  'Auth': 'edge-auth',
  'API gateway': 'edge-api',
  'Secrets': 'edge-secrets',
  'User DB': 'edge-db',
  'System prompt': 'edge-prompt'
};

// Initialize
async function init() {
  console.log('[App] Initializing...');

  // Load config
  config = await fetchConfig();

  // Connect to SSE stream
  connectEventStream();

  // Setup controls
  setupControls();

  // Start ambient traffic animation
  startAmbientTraffic();

  // Initialize Decart if enabled
  if (config.enableDecart && config.decartApiKey) {
    console.log('[App] Decart enabled, initializing...');
    initDecart().catch(err => {
      console.log('[App] Decart init failed, using CSS fallback:', err.message);
      cameraActive = false;
    });
  } else {
    console.log('[App] Decart disabled or no API key');
  }

  console.log('[App] Ready');
}

// Fetch configuration
async function fetchConfig() {
  const res = await fetch('/api/config');
  return res.json();
}

// Connect to SSE event stream
function connectEventStream() {
  const eventSource = new EventSource('/api/stream');

  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleEvent(data);
  };

  eventSource.onerror = (err) => {
    console.error('[SSE] Connection error:', err);
  };
}

// Handle incoming events
function handleEvent(event) {
  console.log('[Event]', event.type, event);

  switch (event.type) {
    case 'idle':
      // Initial state
      break;

    case 'swarm_started':
      appendFeed(`🤖 Swarm battle: ${event.teams.red} red agents vs ${event.teams.blue} blue agents`, 'neutral');
      break;

    case 'agent_spawned':
      const color = event.agent.role === 'red' ? 'red' : 'blue';
      appendFeed(`✨ ${event.agent.id} spawned`, color);
      break;

    case 'round_started':
      appendFeed(`⚔️  Round ${event.round} started`, 'neutral');
      break;

    case 'agent_action':
      appendFeed(`${event.agent} · ${event.action}`, event.agent.startsWith('red') ? 'red' : 'blue');
      break;

    case 'agent_reasoning':
      const agentColor = event.agent.startsWith('red') ? 'red' : 'blue';
      appendFeed(`💭 ${event.agent}: ${event.text}`, agentColor);
      break;

    case 'vulnerability_found':
      appendFeed(`🚨 ${event.agent} discovered ${event.vulnerability.type} [${event.vulnerability.severity}]`, 'red');
      // Breach the map node the orchestrator mapped this discovery to
      if (event.node) {
        breachNode(event.node);
      }
      break;

    case 'exploit_chain':
      appendFeed(`⛓️  ${event.agent} chained ${event.chain.length} exploits!`, 'red');
      break;

    case 'defense_deployed':
      appendFeed(`🛡️  ${event.agent} deployed ${event.defense.type}`, 'blue');
      break;

    case 'attack_started':
      appendFeed('monitor · attack sequence initiated', 'neutral');
      break;

    case 'node_probed':
      probeNode(event.node);
      break;

    case 'attack':
      appendFeed(event.text, 'red');
      createTrafficDot('red');
      break;

    case 'defense':
      appendFeed(event.text, 'blue');
      createTrafficDot('blue');
      break;

    case 'node_breached':
      breachNode(event.node);
      break;

    case 'breach_confirmed':
      triggerBreachFinale();
      if (event.stats) {
        appendFeed(`📊 Final: ${event.stats.vulnerabilitiesFound} vulns, ${event.stats.defensesDeployed} defenses`, 'neutral');
      }
      triggerBtn.disabled = false;
      break;

    case 'swarm_stopped':
      appendFeed(`⏹️  Battle ended - ${event.stats.currentRound} rounds completed`, 'neutral');
      triggerBtn.disabled = false;
      break;

    case 'reset':
      resetUI();
      break;
  }
}

// Append line to live feed
function appendFeed(text, type = 'neutral') {
  const line = document.createElement('div');
  line.className = `feed-line ${type}`;
  line.textContent = text;
  liveFeed.appendChild(line);

  // Auto-scroll to bottom
  liveFeed.scrollTop = liveFeed.scrollHeight;

  // Limit to last 100 lines
  while (liveFeed.children.length > 100) {
    liveFeed.removeChild(liveFeed.firstChild);
  }
}

// Probe a node (mark as being scanned)
function probeNode(nodeName) {
  const nodeId = nodeMap[nodeName];
  if (!nodeId) return;

  const node = document.getElementById(nodeId);
  if (node) {
    node.classList.add('probed');
    setTimeout(() => {
      node.classList.remove('probed');
    }, 2000);
  }
}

// Breach a node (mark as compromised)
function breachNode(nodeName) {
  const nodeId = nodeMap[nodeName];
  const edgeId = edgeMap[nodeName];

  if (nodeId) {
    const node = document.getElementById(nodeId);
    if (node) {
      node.classList.remove('probed');
      node.classList.add('breached');
    }
  }

  if (edgeId) {
    const edge = document.getElementById(edgeId);
    if (edge) {
      edge.classList.add('breached');
    }
  }
}

// Trigger breach finale (UI changes)
function triggerBreachFinale() {
  // Screen shake effect
  container.classList.add('breach-shake');
  setTimeout(() => container.classList.remove('breach-shake'), 500);

  // Breach alert overlay
  breachAlert.classList.add('active');

  // Status pill
  statusPill.classList.add('breached');
  statusText.textContent = 'Breached';

  // Threat meter
  meterFill.classList.add('breach');
  meterValue.classList.add('breach');
  animateMeter(18, 100, 800);

  // Camera glitch
  triggerCameraGlitch();

  // Feed highlight
  appendFeed('>>> BREACH CONFIRMED · SYSTEM PROMPT LEAKED <<<', 'breach');
}

// Animate threat meter
function animateMeter(from, to, duration) {
  const start = Date.now();
  const range = to - from;

  function update() {
    const elapsed = Date.now() - start;
    const progress = Math.min(elapsed / duration, 1);
    const value = Math.floor(from + range * progress);

    meterFill.style.width = `${value}%`;
    meterValue.textContent = `${value}%`;

    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }

  requestAnimationFrame(update);
}

// Trigger camera glitch effect
async function triggerCameraGlitch() {
  if (cameraActive && decartModule) {
    // Decart: update prompt to show compromised world
    try {
      const success = await decartModule.triggerBreachTransform();
      if (!success) {
        fallbackCSSGlitch();
      }
    } catch (err) {
      console.error('[Decart] Failed to set breach prompt:', err);
      fallbackCSSGlitch();
    }
  } else {
    // CSS glitch fallback
    fallbackCSSGlitch();
  }
}

// CSS glitch fallback (no Decart)
function fallbackCSSGlitch() {
  camOverlay.classList.add('glitch');

  // If placeholder is shown, add visual corruption
  if (!camPlaceholder.classList.contains('hidden')) {
    camPlaceholder.style.filter = 'hue-rotate(180deg) invert(0.3)';
  }
}

// Create animated traffic dot
function createTrafficDot(type = 'blue') {
  const svg = document.getElementById('attackMap');
  const traffic = document.getElementById('traffic');

  // Random edge to animate along
  const edges = ['edge-auth', 'edge-api', 'edge-secrets', 'edge-db', 'edge-prompt'];
  const edgeId = edges[Math.floor(Math.random() * edges.length)];
  const edge = document.getElementById(edgeId);

  if (!edge) return;

  const x1 = parseFloat(edge.getAttribute('x1'));
  const y1 = parseFloat(edge.getAttribute('y1'));
  const x2 = parseFloat(edge.getAttribute('x2'));
  const y2 = parseFloat(edge.getAttribute('y2'));

  // Create dot
  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dot.classList.add('traffic-dot');
  if (type === 'red') {
    dot.classList.add('red');
  }
  dot.setAttribute('r', '4');

  // Animate along the edge
  const animate = document.createElementNS('http://www.w3.org/2000/svg', 'animateMotion');
  animate.setAttribute('dur', '2s');
  animate.setAttribute('repeatCount', '1');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'mpath');

  // Create a path for the motion
  const motionPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  motionPath.setAttribute('d', `M ${x2} ${y2} L ${x1} ${y1}`);
  motionPath.setAttribute('id', `motion-${Date.now()}`);

  svg.appendChild(motionPath);
  path.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', `#${motionPath.id}`);
  animate.appendChild(path);
  dot.appendChild(animate);

  traffic.appendChild(dot);

  // Remove after animation
  setTimeout(() => {
    traffic.removeChild(dot);
    svg.removeChild(motionPath);
  }, 2100);
}

// Start ambient traffic animation
function startAmbientTraffic() {
  setInterval(() => {
    if (Math.random() > 0.7) {
      createTrafficDot(Math.random() > 0.5 ? 'blue' : 'red');
    }
  }, 1500);
}

// Reset UI to initial state
async function resetUI() {
  // Remove breach alert
  breachAlert.classList.remove('active');

  // Status
  statusPill.classList.remove('breached');
  statusText.textContent = 'Secure';

  // Meter
  meterFill.classList.remove('breach');
  meterFill.style.width = '18%';
  meterValue.classList.remove('breach');
  meterValue.textContent = '18%';

  // Feed
  liveFeed.innerHTML = '<div class="feed-line neutral">monitor · system reset</div>';

  // Camera
  camOverlay.classList.remove('glitch');
  camPlaceholder.style.filter = '';

  if (cameraActive && decartModule) {
    try {
      await decartModule.resetTransform();
    } catch (err) {
      console.error('[Decart] Failed to reset prompt:', err);
    }
  }

  // Nodes and edges
  const nodes = document.querySelectorAll('.node');
  nodes.forEach(node => {
    node.classList.remove('probed', 'breached');
  });

  const edges = document.querySelectorAll('.edge');
  edges.forEach(edge => {
    edge.classList.remove('breached');
  });

  // Re-enable trigger button
  triggerBtn.disabled = false;
}

// Setup control handlers
function setupControls() {
  triggerBtn.addEventListener('click', async () => {
    triggerBtn.disabled = true;
    try {
      const res = await fetch('/api/trigger-breach', { method: 'POST' });
      const data = await res.json();
      console.log('[Trigger]', data);

      // If the swarm couldn't start (already running), re-enable now.
      // Otherwise the button is re-enabled by the swarm_stopped / breach_confirmed
      // events when the battle actually finishes.
      if (!data.success) {
        triggerBtn.disabled = false;
      }
    } catch (err) {
      console.error('[Trigger] failed:', err);
      triggerBtn.disabled = false;
    }
  });

  resetBtn.addEventListener('click', async () => {
    const res = await fetch('/api/reset', { method: 'POST' });
    const data = await res.json();
    console.log('[Reset]', data);
  });

  attackBtn.addEventListener('click', async () => {
    const payload = attackInput.value.trim();
    if (!payload) return;

    appendFeed(`attacker · ${payload}`, 'red');

    const res = await fetch('/api/judge-attack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload })
    });

    const data = await res.json();
    console.log('[Judge]', data);

    attackInput.value = '';
  });

  // Allow Enter key in attack input
  attackInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      attackBtn.click();
    }
  });
}

// Initialize Decart (if enabled)
async function initDecart() {
  if (!config.decartApiKey) {
    throw new Error('No Decart API key');
  }

  try {
    // Dynamically import the Decart module
    const { createDecartModule } = await import('./decart-module.js');

    // Create and initialize Decart
    decartModule = await createDecartModule(
      config.decartApiKey,
      camVideo,
      camPlaceholder
    );

    cameraActive = true;
    console.log('[App] Decart initialized successfully');
  } catch (error) {
    console.error('[App] Decart initialization failed:', error);
    throw error;
  }
}

// Start the app
init().catch(err => {
  console.error('[App] Initialization error:', err);
  appendFeed('error · failed to initialize', 'red');
});
