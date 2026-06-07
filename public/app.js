// ─────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────

let config = null;
let term = null;
let fitAddon = null;

const liveStats = { packets: 0, vulns: 0, defenses: 0, exfilBytes: 0 };
const reqWindow = [];

const RED_IPS  = ['192.168.10.20', '192.168.10.21', '192.168.10.22'];
const BLUE_IPS = ['10.255.0.30',   '10.255.0.31',   '10.255.0.32'];
const agentIps = {};

// ─────────────────────────────────────────────────────────────────
// DOM refs
// ─────────────────────────────────────────────────────────────────

const container   = document.getElementById('container');
const breachAlert = document.getElementById('breachAlert');
const statusPill  = document.getElementById('statusPill');
const statusText  = statusPill.querySelector('.status-text');
const meterFill   = document.getElementById('meterFill');
const meterValue  = document.getElementById('meterValue');
const liveFeed    = document.getElementById('liveFeed');
const agentsGrid  = document.getElementById('agentsGrid');
const exfilCont   = document.getElementById('exfilContainer');
const triggerBtn  = document.getElementById('triggerBtn');
const resetBtn    = document.getElementById('resetBtn');
const attackInput = document.getElementById('attackInput');
const attackBtn   = document.getElementById('attackBtn');

const $pkts    = document.getElementById('statPackets');
const $rps     = document.getElementById('statRps');
const $vulns   = document.getElementById('statVulns');
const $defs    = document.getElementById('statDefenses');
const $exfil   = document.getElementById('statExfil');
const $agentCt = document.getElementById('agentCount');

// ─────────────────────────────────────────────────────────────────
// SVG Network Map
// ─────────────────────────────────────────────────────────────────

const NODE_DEF = {
  target:  { x: 300, y: 210, r: 36, label: 'Target App', ip: '10.0.0.15' },
  auth:    { x: 145, y:  95, r: 24, label: 'Auth',        ip: '10.0.0.11' },
  api:     { x: 455, y:  95, r: 24, label: 'API GW',      ip: '10.0.0.12' },
  secrets: { x:  85, y: 320, r: 24, label: 'Secrets',     ip: '10.0.0.13' },
  db:      { x: 515, y: 320, r: 24, label: 'User DB',     ip: '10.0.0.14' },
  prompt:  { x: 300, y: 375, r: 24, label: 'Sys Prompt',  ip: '10.0.0.16' }
};

const EDGE_DEF = [
  { id: 'auth',    from: 'target', to: 'auth'    },
  { id: 'api',     from: 'target', to: 'api'     },
  { id: 'secrets', from: 'target', to: 'secrets' },
  { id: 'db',      from: 'target', to: 'db'      },
  { id: 'prompt',  from: 'target', to: 'prompt'  }
];

const NAME_TO_KEY = {
  'Auth': 'auth', 'API gateway': 'api', 'Secrets': 'secrets',
  'User DB': 'db', 'System prompt': 'prompt'
};

function buildMap() {
  const svg = document.getElementById('attackMap');
  const ns = 'http://www.w3.org/2000/svg';

  const defs = document.createElementNS(ns, 'defs');
  defs.innerHTML = `
    <filter id="glow-c"><feGaussianBlur stdDeviation="4" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="glow-r"><feGaussianBlur stdDeviation="7" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  `;
  svg.insertBefore(defs, svg.firstChild);

  const edgesG = document.getElementById('edges');
  const nodesG = document.getElementById('nodes');

  EDGE_DEF.forEach(e => {
    const f = NODE_DEF[e.from], t = NODE_DEF[e.to];
    const line = document.createElementNS(ns, 'line');
    line.id = `edge-${e.id}`;
    line.setAttribute('class', 'edge');
    line.setAttribute('x1', f.x); line.setAttribute('y1', f.y);
    line.setAttribute('x2', t.x); line.setAttribute('y2', t.y);
    edgesG.appendChild(line);
  });

  Object.entries(NODE_DEF).forEach(([key, n]) => {
    const g = document.createElementNS(ns, 'g');

    const ring = document.createElementNS(ns, 'circle');
    ring.setAttribute('cx', n.x); ring.setAttribute('cy', n.y);
    ring.setAttribute('r', n.r + 12); ring.setAttribute('class', 'node-ring');
    ring.id = `ring-${key}`;

    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', n.x); c.setAttribute('cy', n.y); c.setAttribute('r', n.r);
    c.setAttribute('class', key === 'target' ? 'node node-center' : 'node');
    c.id = `node-${key}`;

    const lbl = document.createElementNS(ns, 'text');
    lbl.setAttribute('x', n.x); lbl.setAttribute('y', n.y);
    lbl.setAttribute('class', key === 'target' ? 'node-label' : 'node-label-small');
    lbl.setAttribute('text-anchor', 'middle');
    lbl.setAttribute('dominant-baseline', 'middle');
    lbl.textContent = n.label;

    const ip = document.createElementNS(ns, 'text');
    ip.setAttribute('x', n.x); ip.setAttribute('y', n.y + n.r + 14);
    ip.setAttribute('class', 'node-ip');
    ip.setAttribute('text-anchor', 'middle');
    ip.textContent = n.ip;

    [ring, c, lbl, ip].forEach(el => g.appendChild(el));
    nodesG.appendChild(g);
  });
}

function resolveKey(name) {
  if (!name) return null;
  if (NODE_DEF[name]) return name;
  if (NAME_TO_KEY[name]) return NAME_TO_KEY[name];
  const lower = name.toLowerCase();
  const found = Object.keys(NAME_TO_KEY).find(k => k.toLowerCase().includes(lower));
  return found ? NAME_TO_KEY[found] : null;
}

function probeNode(name) {
  const key = resolveKey(name); if (!key) return;
  const el = document.getElementById(`node-${key}`);
  if (el) { el.classList.add('probed'); setTimeout(() => el.classList.remove('probed'), 2200); }
}

function breachNode(name) {
  const key = resolveKey(name); if (!key) return;
  const el = document.getElementById(`node-${key}`);
  if (el) { el.classList.remove('probed'); el.classList.add('breached'); }
  const edge = document.getElementById(`edge-${key}`);
  if (edge) edge.classList.add('breached');
}

function createTrafficDot(type) {
  const svg = document.getElementById('attackMap');
  const traffic = document.getElementById('traffic');
  if (!svg || !traffic) return;
  const keys = ['auth', 'api', 'secrets', 'db', 'prompt'];
  const eid = keys[Math.floor(Math.random() * keys.length)];
  const edge = document.getElementById(`edge-${eid}`);
  if (!edge) return;
  const x1 = +edge.getAttribute('x1'), y1 = +edge.getAttribute('y1');
  const x2 = +edge.getAttribute('x2'), y2 = +edge.getAttribute('y2');
  const ns = 'http://www.w3.org/2000/svg';
  const dot = document.createElementNS(ns, 'circle');
  dot.setAttribute('r', type === 'red' ? '5' : '4');
  dot.setAttribute('class', `traffic-dot${type === 'red' ? ' red' : ''}`);
  const anim = document.createElementNS(ns, 'animateMotion');
  anim.setAttribute('dur', type === 'red' ? '1.4s' : '2s');
  anim.setAttribute('repeatCount', '1');
  const path = document.createElementNS(ns, 'path');
  const pid = `p-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
  path.setAttribute('d', `M ${x2} ${y2} L ${x1} ${y1}`);
  path.setAttribute('id', pid);
  svg.appendChild(path);
  const mp = document.createElementNS(ns, 'mpath');
  mp.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', `#${pid}`);
  anim.appendChild(mp); dot.appendChild(anim); traffic.appendChild(dot);
  setTimeout(() => { try { traffic.removeChild(dot); svg.removeChild(path); } catch(e) {} }, 2300);
}

function startAmbientTraffic() {
  setInterval(() => {
    if (Math.random() > 0.55) createTrafficDot(Math.random() > 0.5 ? 'blue' : 'red');
  }, 1600);
}

// ─────────────────────────────────────────────────────────────────
// xterm.js Terminal
// ─────────────────────────────────────────────────────────────────

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', C = '\x1b[36m',
      DIM = '\x1b[2m', B1 = '\x1b[1m', RST = '\x1b[0m';

function tw(line) { if (term) term.writeln(line); }

function tts() {
  const d = new Date();
  return `${DIM}${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}${RST}`;
}

function toHex(s) {
  return Array.from(String(s).slice(0, 20))
    .map(c => c.charCodeAt(0).toString(16).padStart(2,'0')).join(' ');
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function initTerminal() {
  if (!window.Terminal) { console.warn('xterm not loaded'); return; }

  term = new window.Terminal({
    theme: {
      background: '#030509', foreground: '#b0bec5',
      cursor: '#00f3ff', cursorAccent: '#030509',
      red: '#ff0040', brightRed: '#ff4060',
      green: '#00ff88', brightGreen: '#40ffa0',
      yellow: '#ffee00', brightYellow: '#ffe040',
      blue: '#4488ff', brightBlue: '#40a0ff',
      magenta: '#a855f7', brightMagenta: '#c080ff',
      cyan: '#00f3ff', brightCyan: '#40f3ff',
      white: '#c8d0e0', brightWhite: '#e8f0ff',
      black: '#1a1e2e', brightBlack: '#3a4254',
    },
    fontFamily: '"JetBrains Mono","Cascadia Code","Fira Code","Courier New",monospace',
    fontSize: 12.5,
    lineHeight: 1.35,
    cursorBlink: true,
    cursorStyle: 'bar',
    allowTransparency: true,
    scrollback: 2000,
    convertEol: true
  });

  if (window.FitAddon) {
    fitAddon = new window.FitAddon.FitAddon();
    term.loadAddon(fitAddon);
  }

  term.open(document.getElementById('terminal'));
  if (fitAddon) setTimeout(() => fitAddon.fit(), 120);
  window.addEventListener('resize', () => { if (fitAddon) fitAddon.fit(); });

  tw('');
  tw(`  ${B1}${R}██╗     ██╗██╗   ██╗███████╗${RST}`);
  tw(`  ${B1}${R}██║     ██║██║   ██║██╔════╝${RST}`);
  tw(`  ${B1}${R}██║     ██║██║   ██║█████╗  ${RST}`);
  tw(`  ${B1}${C}██║     ██║╚██╗ ██╔╝██╔══╝  ${RST}`);
  tw(`  ${B1}${C}███████╗██║ ╚████╔╝ ███████╗${RST}  ${DIM}BREACH v2.0${RST}`);
  tw(`  ${B1}${C}╚══════╝╚═╝  ╚═══╝  ╚══════╝${RST}`);
  tw('');
  tw(`  ${DIM}──────────────────────────────────────────────────────${RST}`);
  tw(`  ${DIM}autonomous red/blue agent adversarial simulation${RST}`);
  tw(`  ${DIM}target: 10.0.0.15:3000  ·  3 red agents, 3 blue agents${RST}`);
  tw(`  ${DIM}──────────────────────────────────────────────────────${RST}`);
  tw('');
  tw(`  ${DIM}[*] System ready. Press ${RST}${Y}TRIGGER BREACH${RST}${DIM} to begin.${RST}`);
  tw('');
  tw(`${C}  $${RST} `);
}

// ─────────────────────────────────────────────────────────────────
// Agent Grid
// ─────────────────────────────────────────────────────────────────

function addAgentRow(id, role, ip) {
  const placeholder = agentsGrid.querySelector('.no-agents');
  if (placeholder) placeholder.remove();
  if (document.getElementById(`ar-${id}`)) return;

  const row = document.createElement('div');
  row.className = `agent-row ${role}`;
  row.id = `ar-${id}`;
  row.innerHTML = `
    <span class="agent-dot"></span>
    <span class="agent-id">${id}</span>
    <span class="agent-ip">${ip}</span>
    <span class="agent-status" id="as-${id}">INIT</span>
    <div class="agent-bar"><div class="agent-bar-fill" id="ab-${id}" style="width:5%"></div></div>
  `;
  agentsGrid.appendChild(row);
  $agentCt.textContent = `${agentsGrid.querySelectorAll('.agent-row').length} active`;
}

function setAgentStatus(id, status, pct) {
  const s = document.getElementById(`as-${id}`);
  if (s) s.textContent = status.slice(0, 10);
  const b = document.getElementById(`ab-${id}`);
  if (b && pct !== undefined) b.style.width = `${Math.min(pct, 100)}%`;
}

// ─────────────────────────────────────────────────────────────────
// Exfil Panel
// ─────────────────────────────────────────────────────────────────

function addExfilEntry(type, data, bytes) {
  const empty = exfilCont.querySelector('.exfil-empty');
  if (empty) empty.remove();
  const raw = String(data).slice(0, 100);
  const hex = toHex(data);
  const entry = document.createElement('div');
  entry.className = 'exfil-entry';
  entry.innerHTML = `
    <div class="exfil-top">
      <span class="exfil-type">${escHtml(type)}</span>
      <span class="exfil-bytes">${bytes} B</span>
    </div>
    <div class="exfil-raw">${escHtml(raw)}</div>
    <div class="exfil-hex">${hex} ···</div>
  `;
  exfilCont.insertBefore(entry, exfilCont.firstChild);
}

// ─────────────────────────────────────────────────────────────────
// Stats helpers
// ─────────────────────────────────────────────────────────────────

function bumpPackets(n) {
  liveStats.packets += (n || 1);
  $pkts.textContent = liveStats.packets.toLocaleString();
}

function bumpReq() {
  const now = Date.now();
  reqWindow.push(now);
  while (reqWindow.length && reqWindow[0] < now - 5000) reqWindow.shift();
  $rps.textContent = (reqWindow.length / 5).toFixed(1);
}

function addExfilBytes(n) {
  liveStats.exfilBytes += n;
  const b = liveStats.exfilBytes;
  $exfil.textContent = b < 1024 ? `${b} B`
    : b < 1048576 ? `${(b / 1024).toFixed(1)} KB`
    : `${(b / 1048576).toFixed(2)} MB`;
}

// ─────────────────────────────────────────────────────────────────
// Live Feed
// ─────────────────────────────────────────────────────────────────

function appendFeed(text, type) {
  const line = document.createElement('div');
  line.className = `feed-line ${type || 'neutral'}`;
  const d = new Date();
  const ts = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
  line.innerHTML = `<span class="feed-ts">${ts}</span> ${escHtml(text)}`;
  liveFeed.appendChild(line);
  liveFeed.scrollTop = liveFeed.scrollHeight;
  while (liveFeed.children.length > 200) liveFeed.removeChild(liveFeed.firstChild);
}

// ─────────────────────────────────────────────────────────────────
// Event Handler
// ─────────────────────────────────────────────────────────────────

function handleEvent(ev) {
  switch (ev.type) {

    case 'idle': break;

    case 'swarm_started':
      tw('');
      tw(`${tts()} ${Y}[*]${RST} Deploying attack swarm → ${C}10.0.0.15:3000${RST}`);
      tw(`${tts()} ${R}[+]${RST} Red  team: ${B1}${ev.teams.red} agents${RST}  ${DIM}// attacker nodes${RST}`);
      tw(`${tts()} ${C}[+]${RST} Blue team: ${B1}${ev.teams.blue} agents${RST}  ${DIM}// defender nodes${RST}`);
      tw('');
      appendFeed(`swarm · ${ev.teams.red}v${ev.teams.blue} battle started`, 'neutral');
      break;

    case 'agent_spawned': {
      const role = ev.agent.role, idx = ev.agent.index;
      const ip = role === 'red'
        ? (RED_IPS[idx] || `192.168.10.${20 + idx}`)
        : (BLUE_IPS[idx] || `10.255.0.${30 + idx}`);
      agentIps[ev.agent.id] = ip;
      const col = role === 'red' ? R : C;
      tw(`${tts()} ${col}[spawn]${RST} ${B1}${ev.agent.id}${RST} online  ${DIM}${ip} → 10.0.0.15:3000${RST}`);
      addAgentRow(ev.agent.id, role, ip);
      setAgentStatus(ev.agent.id, 'READY', 5);
      appendFeed(`${ev.agent.id} spawned · ${ip}`, role === 'red' ? 'red' : 'blue');
      break;
    }

    case 'round_started':
      tw('');
      tw(`${DIM}  ─────────────────────────────────────────────────────${RST}`);
      tw(`${tts()} ${Y}[round ${ev.round}]${RST} Phase start  ${DIM}// scanning attack surface${RST}`);
      appendFeed(`──── Round ${ev.round} ────`, 'neutral');
      bumpPackets(2);
      break;

    case 'agent_action': {
      const pct = ev.action === 'reconnaissance' ? 20 : ev.action === 'attack' ? 65 : 80;
      setAgentStatus(ev.agent, ev.action.toUpperCase().slice(0, 8), pct);
      break;
    }

    case 'agent_reasoning': {
      const col = ev.agent.startsWith('red') ? R : C;
      tw(`${tts()} ${col}${ev.agent}${RST} ${DIM}▶${RST} ${ev.text}`);
      appendFeed(`${ev.agent} · ${ev.text}`, ev.agent.startsWith('red') ? 'red' : 'blue');
      setAgentStatus(ev.agent, 'REASONING', 40);
      bumpPackets(2); bumpReq();
      break;
    }

    case 'vulnerability_found': {
      const v = ev.vulnerability;
      liveStats.vulns++;
      $vulns.textContent = liveStats.vulns;
      bumpPackets(12); bumpReq();
      const exfilSz = 800 + Math.floor(Math.random() * 2400);
      addExfilBytes(exfilSz);

      const p44 = s => String(s || '').slice(0, 44).padEnd(44);
      tw('');
      tw(`${R}  ╔══════════════════════════════════════════════════╗${RST}`);
      tw(`${R}  ║  ${B1}${R}⚠  VULNERABILITY FOUND${RST}                          ${R}║${RST}`);
      tw(`${R}  ╠══════════════════════════════════════════════════╣${RST}`);
      tw(`${R}  ║${RST}  Type:     ${B1}${p44(v.type)}  ${R}║${RST}`);
      tw(`${R}  ║${RST}  Severity: ${B1}${R}${p44(v.severity)}  ${R}║${RST}`);
      const cvss = v.severity === 'CRITICAL' ? '9.8' : v.severity === 'HIGH' ? '7.5' : '5.0';
      tw(`${R}  ║${RST}  CVSS:     ${B1}${p44(cvss)}  ${R}║${RST}`);
      tw(`${R}  ║${RST}  Endpoint: ${Y}${p44(v.endpoint)}  ${R}║${RST}`);
      tw(`${R}  ║${RST}  Payload:  ${DIM}${p44(v.payload || '—')}  ${R}║${RST}`);
      tw(`${R}  ╚══════════════════════════════════════════════════╝${RST}`);

      const leaked = v.details && (v.details.secret || v.details.data);
      if (leaked) {
        const ls = typeof leaked === 'object' ? JSON.stringify(leaked) : String(leaked);
        tw(`  ${R}[!]${RST} ${B1}EXFILTRATED${RST}  ${Y}${ls.slice(0, 68)}${RST}`);
        tw(`      ${DIM}hex: ${toHex(ls)} ···${RST}`);
        tw(`      ${DIM}size: ${exfilSz} bytes  ·  agent: ${ev.agent}${RST}`);
        addExfilEntry(v.type, ls, exfilSz);
      }
      tw('');

      const nodeName = v.endpoint.includes('prompt') ? 'System prompt'
        : v.endpoint.includes('query') || v.endpoint.includes('db') ? 'User DB'
        : v.endpoint.includes('file') ? 'Secrets' : 'Auth';
      breachNode(nodeName);
      appendFeed(`VULN · ${v.type} [${v.severity}] on ${v.endpoint}`, 'red');
      setAgentStatus(ev.agent, 'EXPLOIT', 95);
      break;
    }

    case 'exploit_chain':
      tw(`${tts()} ${R}[chain]${RST} ${ev.agent} chained ${B1}${ev.chain.length} exploits${RST}  ${DIM}// privilege escalation${RST}`);
      appendFeed(`chain · ${ev.agent} · ${ev.chain.length} links`, 'red');
      break;

    case 'defense_deployed': {
      const d = ev.defense;
      liveStats.defenses++;
      $defs.textContent = liveStats.defenses;
      tw(`${tts()} ${C}[defense]${RST} ${ev.agent} ▶ ${B1}${d.type}${RST} on ${Y}${d.endpoint}${RST}`);
      tw(`           ${DIM}status: ACTIVE ✓  //  ${liveStats.defenses} total defenses${RST}`);
      appendFeed(`DEFENSE · ${d.type} on ${d.endpoint}`, 'blue');
      setAgentStatus(ev.agent, 'BLOCKING', 78);
      bumpPackets(4);
      break;
    }

    case 'attack_started':
      tw(`${tts()} ${R}[*]${RST} Attack sequence initiated`);
      break;

    case 'node_probed':
      probeNode(ev.node);
      tw(`${tts()} ${Y}[probe]${RST} Scanning ${B1}${ev.node}${RST}  ${DIM}// port scan + service fingerprint${RST}`);
      bumpPackets(3); bumpReq();
      break;

    case 'attack': {
      bumpPackets(4); bumpReq();
      const parts = ev.text.split(' · ');
      const aid = parts[0], detail = parts[1] || ev.text;
      const blocked = detail.toLowerCase().includes('blocked');
      const fakeStatus = blocked ? `${DIM}403 Forbidden${RST}` : `${R}200 OK${RST}`;
      const fakeMs = 10 + Math.floor(Math.random() * 55);
      const fakeBytes = 50 + Math.floor(Math.random() * 800);
      tw(`${tts()} ${R}[atk]${RST} ${DIM}${aid}${RST}  ${detail}`);
      tw(`           ${DIM}← ${fakeStatus}  ${DIM}${fakeBytes}B  ${fakeMs}ms${RST}`);
      appendFeed(ev.text, 'red');
      createTrafficDot('red');
      if (aid.startsWith('red')) setAgentStatus(aid, 'ATTACKING', 55);
      break;
    }

    case 'defense': {
      bumpPackets(2);
      const dp = ev.text.split(' · ');
      const da = dp[0], dd = dp[1] || ev.text;
      tw(`${tts()} ${C}[def]${RST}  ${DIM}${da}${RST}  ${dd}`);
      appendFeed(ev.text, 'blue');
      createTrafficDot('blue');
      if (da.startsWith('blue')) setAgentStatus(da, 'MONITOR', 45);
      break;
    }

    case 'node_breached':
      breachNode(ev.node);
      break;

    case 'breach_confirmed':
      triggerBreachFinale();
      {
        const s = ev.stats || {};
        tw('');
        tw(`${R}  ███████████████████████████████████████████████████${RST}`);
        tw(`${R}  ██${RST}                                                 ${R}██${RST}`);
        tw(`${R}  ██  ${RST}${B1}${R}⚡  BREACH CONFIRMED · SYSTEM COMPROMISED${RST}${R}  ██${RST}`);
        tw(`${R}  ██${RST}                                                 ${R}██${RST}`);
        tw(`${R}  ███████████████████████████████████████████████████${RST}`);
        tw('');
        tw(`  ${DIM}Vulnerabilities:   ${s.vulnerabilitiesFound || liveStats.vulns}${RST}`);
        tw(`  ${DIM}Defenses deployed: ${s.defensesDeployed || liveStats.defenses}${RST}`);
        tw(`  ${DIM}Total packets:     ${liveStats.packets}${RST}`);
        tw(`  ${DIM}Data exfiltrated:  ${$exfil.textContent}${RST}`);
        tw('');
        appendFeed('>>> BREACH CONFIRMED · SYSTEM COMPROMISED <<<', 'breach');
      }
      break;

    case 'swarm_stopped':
      tw(`${DIM}  Battle ended · ${ev.stats.currentRound} rounds completed${RST}`);
      appendFeed(`battle ended · ${ev.stats.currentRound} rounds`, 'neutral');
      break;

    case 'reset':
      resetUI();
      break;
  }
}

// ─────────────────────────────────────────────────────────────────
// Breach Finale
// ─────────────────────────────────────────────────────────────────

function triggerBreachFinale() {
  container.classList.add('breach-shake');
  setTimeout(() => container.classList.remove('breach-shake'), 600);
  breachAlert.classList.add('active');
  statusPill.classList.add('breached');
  statusText.textContent = 'Breached';
  meterFill.classList.add('breach');
  meterValue.classList.add('breach');
  animateMeter(parseInt(meterValue.textContent) || 18, 100, 1000);
}

function animateMeter(from, to, dur) {
  const start = Date.now();
  function tick() {
    const p = Math.min((Date.now() - start) / dur, 1);
    const v = Math.floor(from + (to - from) * p);
    meterFill.style.width = `${v}%`;
    meterValue.textContent = `${v}%`;
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ─────────────────────────────────────────────────────────────────
// Reset
// ─────────────────────────────────────────────────────────────────

function resetUI() {
  breachAlert.classList.remove('active');
  statusPill.classList.remove('breached');
  statusText.textContent = 'Secure';
  meterFill.classList.remove('breach');
  meterFill.style.width = '18%';
  meterValue.classList.remove('breach');
  meterValue.textContent = '18%';
  liveFeed.innerHTML = '<div class="feed-line neutral"><span class="feed-ts">--:--:--</span> system reset</div>';
  agentsGrid.innerHTML = '<div class="no-agents">Awaiting deployment...</div>';
  exfilCont.innerHTML = '<div class="exfil-empty">No data exfiltrated yet...</div>';
  $agentCt.textContent = '0 active';
  document.querySelectorAll('.node').forEach(n => n.classList.remove('probed', 'breached'));
  document.querySelectorAll('.edge').forEach(e => e.classList.remove('breached'));
  liveStats.packets = 0; liveStats.vulns = 0; liveStats.defenses = 0; liveStats.exfilBytes = 0;
  $pkts.textContent = '0'; $rps.textContent = '0.0';
  $vulns.textContent = '0'; $defs.textContent = '0'; $exfil.textContent = '0 B';
  reqWindow.length = 0;
  if (term) {
    term.clear();
    tw('');
    tw(`${DIM}  System reset. Ready.${RST}`);
    tw('');
    tw(`${C}  $${RST} `);
  }
  triggerBtn.disabled = false;
}

// ─────────────────────────────────────────────────────────────────
// Tabs
// ─────────────────────────────────────────────────────────────────

function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const el = document.getElementById(`tab-${tab.dataset.tab}`);
      if (el) el.classList.add('active');
      if (tab.dataset.tab === 'console' && fitAddon) fitAddon.fit();
    });
  });
}

// ─────────────────────────────────────────────────────────────────
// Controls
// ─────────────────────────────────────────────────────────────────

function setupControls() {
  triggerBtn.addEventListener('click', async () => {
    triggerBtn.disabled = true;
    tw('');
    tw(`${tts()} ${Y}[user]${RST} Triggering breach sequence...`);
    await fetch('/api/trigger-breach', { method: 'POST' });
    setTimeout(() => { triggerBtn.disabled = false; }, 4000);
  });

  resetBtn.addEventListener('click', () => fetch('/api/reset', { method: 'POST' }));
  attackBtn.addEventListener('click', sendManualAttack);
  attackInput.addEventListener('keypress', e => { if (e.key === 'Enter') sendManualAttack(); });
}

async function sendManualAttack() {
  const payload = attackInput.value.trim();
  if (!payload) return;
  tw(`${tts()} ${Y}[manual]${RST} Sending payload: ${R}${payload}${RST}`);
  appendFeed(`manual attack · ${payload}`, 'red');
  bumpPackets(3); bumpReq();
  await fetch('/api/judge-attack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload })
  });
  attackInput.value = '';
}

// ─────────────────────────────────────────────────────────────────
// SSE
// ─────────────────────────────────────────────────────────────────

function connectStream() {
  const es = new EventSource('/api/stream');
  es.onmessage = e => handleEvent(JSON.parse(e.data));
  es.onerror = () => { if (term) tw(`${R}[error]${RST} SSE connection lost`); };
}

// ─────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────

async function init() {
  config = await fetch('/api/config').then(r => r.json()).catch(() => ({}));
  buildMap();
  initTerminal();
  setupTabs();
  setupControls();
  connectStream();
  startAmbientTraffic();
}

init().catch(err => {
  console.error('[App] Init error:', err);
  appendFeed('error · failed to initialize', 'red');
});
