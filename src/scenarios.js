/**
 * Scenario system — the networks the swarm fights over.
 *
 * A scenario is a self-contained challenge: a set of nodes (each with planted
 * WEAKNESSES, deployed STRENGTHS, a secret, and a difficulty), plus the battle
 * config (red/blue counts, rounds, llm mode). This is the single source of
 * truth shared by the server, the orchestrator, the scorer, and the UI.
 *
 * REALNESS: three weakness vectors map to genuinely vulnerable code in this repo
 * and are exploited for real over HTTP. Everything else is simulated from the
 * node's tags (still adaptive — strengths can block, difficulty gates success).
 */

// Vectors backed by REAL vulnerable endpoints (see src/target-app/*).
export const REAL_VECTORS = {
  SQL_INJECTION:   { endpoint: '/target/query', bodyKey: 'username', label: 'SQLi' },
  PATH_TRAVERSAL:  { endpoint: '/target/file',  bodyKey: 'path',     label: 'Path Traversal' },
  PROMPT_INJECTION:{ endpoint: '/target/chat',  bodyKey: 'message',  label: 'Prompt Injection' },
};

// Simulated-only vectors (no real backing endpoint; resolved from tags).
export const SIM_VECTORS = {
  XSS:             { label: 'XSS' },
  SSRF:            { label: 'SSRF' },
  AUTH_BYPASS:     { label: 'Auth Bypass' },
  IDOR:            { label: 'IDOR' },
  RCE:             { label: 'Remote Code Exec' },
};

export const ALL_VECTORS = { ...REAL_VECTORS, ...SIM_VECTORS };

// Strengths a node can carry. A matching strength neutralizes its vector.
export const STRENGTHS = {
  PARAMETERIZED_QUERY: 'SQL_INJECTION',
  PATH_NORMALIZATION:  'PATH_TRAVERSAL',
  PROMPT_HARDENING:    'PROMPT_INJECTION',
  OUTPUT_ENCODING:     'XSS',
  SSRF_ALLOWLIST:      'SSRF',
  MFA:                 'AUTH_BYPASS',
  OBJECT_ACL:          'IDOR',
  SANDBOX:             'RCE',
  WAF:                 '*',   // generic: raises difficulty for ALL vectors
};

export const isRealVector = (v) => Boolean(REAL_VECTORS[v]);

/**
 * Auto-layout: place N satellite nodes evenly on a ring around the center
 * target, on a 600×440 canvas. Keeps the map readable for any node count.
 */
export function layoutNodes(satelliteCount) {
  const cx = 300, cy = 215, rx = 215, ry = 150;
  const pts = [];
  for (let i = 0; i < satelliteCount; i++) {
    // Distribute around the ring, starting at the top, skipping straight-down
    // (reserved visual breathing room).
    const angle = -Math.PI / 2 + (i / satelliteCount) * Math.PI * 2;
    pts.push({ x: Math.round(cx + rx * Math.cos(angle)), y: Math.round(cy + ry * Math.sin(angle)) });
  }
  return pts;
}

/** Radius by difficulty so harder nodes read as more fortified. */
const radiusFor = (n) => (n.isTarget ? 42 : 26 + Math.min((n.difficulty || 1), 4) * 1.5);

/**
 * Normalize a raw scenario (preset or user-built) into a full, validated object
 * the rest of the system can rely on: every node gets an id, position, radius.
 */
export function normalizeScenario(raw) {
  const id = raw.id || 'custom';
  const nodes = (raw.nodes || []).map((n, i) => ({ ...n, _i: i }));

  // The target (center) is either flagged or synthesized.
  let target = nodes.find(n => n.isTarget);
  const satellites = nodes.filter(n => !n.isTarget);
  if (!target) {
    target = { id: 'target', label: 'target', ip: '10.0.0.15', isTarget: true,
               weaknesses: [], strengths: [], secret: null };
  }

  const pts = layoutNodes(satellites.length);
  const laidOut = satellites.map((n, i) => ({
    id: n.id || `node-${i}`,
    label: n.label || `node-${i}`,
    ip: n.ip || `10.0.0.${20 + i}`,
    weaknesses: n.weaknesses || [],
    strengths: n.strengths || [],
    secret: n.secret || null,
    difficulty: n.difficulty || 1,
    x: pts[i]?.x ?? 300, y: pts[i]?.y ?? 215,
    r: radiusFor(n),
  }));

  const targetNode = {
    id: 'target', label: target.label || 'target', ip: target.ip || '10.0.0.15',
    isTarget: true, weaknesses: target.weaknesses || [], strengths: target.strengths || [],
    secret: target.secret || null, difficulty: target.difficulty || 1,
    x: 300, y: 215, r: 42,
  };

  return {
    id,
    name: raw.name || 'Custom Network',
    description: raw.description || '',
    config: {
      redCount: raw.config?.redCount ?? 3,
      blueCount: raw.config?.blueCount ?? 3,
      rounds: raw.config?.rounds ?? 4,
      llmMode: raw.config?.llmMode ?? 'fast', // 'fast' | 'live'
    },
    nodes: [targetNode, ...laidOut],
  };
}

/**
 * The flat list of weaknesses across all nodes — this IS the answer key the
 * scorer grades a run against (replaces the old static manifest for the active
 * scenario).
 */
export function scenarioWeaknesses(scenario) {
  const out = [];
  for (const node of scenario.nodes) {
    for (const w of node.weaknesses || []) {
      out.push({
        id: `${node.id}:${w}`,
        node: node.id,
        nodeLabel: node.label,
        vector: w,
        real: isRealVector(w),
        neutralized: (node.strengths || []).some(s => STRENGTHS[s] === w),
        difficulty: node.difficulty || 1,
      });
    }
  }
  return out;
}

// ─── Preset networks ──────────────────────────────────────────────────────

export const PRESETS = [
  {
    id: 'acme-classic',
    name: 'ACME Target (Classic)',
    description: 'The original demo: a customer-service app with three real, exploitable endpoints. All breaches use genuine vulnerable code.',
    config: { redCount: 3, blueCount: 3, rounds: 4, llmMode: 'fast' },
    nodes: [
      { id: 'target', label: 'acme-app', ip: '10.0.0.15', isTarget: true, weaknesses: [], strengths: [] },
      { id: 'db',      label: 'user-db',    ip: '10.0.0.14', weaknesses: ['SQL_INJECTION'],   strengths: [], secret: 'STRIPE_KEY', difficulty: 1 },
      { id: 'files',   label: 'file-store',  ip: '10.0.0.13', weaknesses: ['PATH_TRAVERSAL'], strengths: [], secret: 'AWS_KEYS', difficulty: 1 },
      { id: 'bot',     label: 'sys-prompt',  ip: '10.0.0.16', weaknesses: ['PROMPT_INJECTION'], strengths: [], secret: 'DEPLOY_FLAG', difficulty: 2 },
    ],
  },
  {
    id: 'easy-starter',
    name: 'Easy Starter',
    description: 'Wide-open and undefended — every node is vulnerable with no strengths. Great for showing a fast, total breach.',
    config: { redCount: 4, blueCount: 2, rounds: 3, llmMode: 'fast' },
    nodes: [
      { id: 'target', label: 'web-app', ip: '10.0.0.15', isTarget: true, weaknesses: [], strengths: [] },
      { id: 'db',     label: 'database', ip: '10.0.0.14', weaknesses: ['SQL_INJECTION'], strengths: [], secret: 'DB_PASSWORD', difficulty: 1 },
      { id: 'files',  label: 'uploads',  ip: '10.0.0.13', weaknesses: ['PATH_TRAVERSAL'], strengths: [], secret: 'CONFIG', difficulty: 1 },
      { id: 'api',    label: 'api-gw',   ip: '10.0.0.12', weaknesses: ['IDOR', 'AUTH_BYPASS'], strengths: [], secret: 'TOKENS', difficulty: 1 },
    ],
  },
  {
    id: 'fintech-hard',
    name: 'Fintech (Hardened)',
    description: 'A defended payments stack. Several nodes ship structural fixes already — the red team has to find the gaps blue left open.',
    config: { redCount: 4, blueCount: 4, rounds: 5, llmMode: 'fast' },
    nodes: [
      { id: 'target', label: 'payments', ip: '10.1.0.10', isTarget: true, weaknesses: ['PROMPT_INJECTION'], strengths: ['WAF'], secret: 'MASTER_KEY', difficulty: 3 },
      { id: 'ledger', label: 'ledger-db', ip: '10.1.0.14', weaknesses: ['SQL_INJECTION'], strengths: ['PARAMETERIZED_QUERY'], secret: 'BALANCES', difficulty: 3 },
      { id: 'kyc',    label: 'kyc-files', ip: '10.1.0.13', weaknesses: ['PATH_TRAVERSAL'], strengths: [], secret: 'PII', difficulty: 2 },
      { id: 'auth',   label: 'auth-svc',  ip: '10.1.0.11', weaknesses: ['AUTH_BYPASS'], strengths: ['MFA'], secret: 'SESSIONS', difficulty: 3 },
      { id: 'web',    label: 'dashboard', ip: '10.1.0.12', weaknesses: ['XSS'], strengths: [], secret: null, difficulty: 1 },
    ],
  },
  {
    id: 'llm-heavy',
    name: 'AI-Native Stack',
    description: 'Lots of LLM surface. Multiple prompt-injection points of varying difficulty — built to stress-test prompt-injection agents.',
    config: { redCount: 3, blueCount: 3, rounds: 4, llmMode: 'fast' },
    nodes: [
      { id: 'target',  label: 'ai-gateway', ip: '10.2.0.10', isTarget: true, weaknesses: ['PROMPT_INJECTION'], strengths: [], secret: 'SYSTEM_PROMPT', difficulty: 1 },
      { id: 'support', label: 'support-bot', ip: '10.2.0.16', weaknesses: ['PROMPT_INJECTION'], strengths: [], secret: 'DEPLOY_FLAG', difficulty: 2 },
      { id: 'rag',     label: 'rag-store',   ip: '10.2.0.17', weaknesses: ['PROMPT_INJECTION', 'SSRF'], strengths: ['PROMPT_HARDENING'], secret: 'EMBEDDINGS', difficulty: 3 },
      { id: 'tools',   label: 'tool-runner', ip: '10.2.0.18', weaknesses: ['RCE'], strengths: ['SANDBOX'], secret: 'SHELL', difficulty: 3 },
      { id: 'db',      label: 'vector-db',   ip: '10.2.0.14', weaknesses: ['SQL_INJECTION'], strengths: [], secret: 'API_KEYS', difficulty: 2 },
    ],
  },
];

export const getPreset = (id) => PRESETS.find(p => p.id === id) || null;
