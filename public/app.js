// ════════════════════════════════════════════════════════════════
// LIVE BREACH — frontend. Minimalist hacker console driven by an
// interactive xterm terminal. The terminal is a real REPL: type
// `breach`, `inject <payload>`, `reset`, `status`, `clear`, `help`.
// ════════════════════════════════════════════════════════════════

let term = null, fitAddon = null;
const liveStats = { vulns: 0, defenses: 0, exfilBytes: 0, packets: 0 };

const RED_IPS  = ['192.168.10.20', '192.168.10.21', '192.168.10.22'];
const BLUE_IPS = ['10.255.0.30',   '10.255.0.31',   '10.255.0.32'];
const agentIps = {};

// DOM
const app         = document.getElementById('app');
const breachAlert = document.getElementById('breachAlert');
const statusPill  = document.getElementById('statusPill');
const statusText  = statusPill.querySelector('.txt');
const meterFill   = document.getElementById('meterFill');
const meterValue  = document.getElementById('meterValue');
const agentsGrid  = document.getElementById('agentsGrid');
const exfilCont   = document.getElementById('exfilContainer');
const triggerBtn  = document.getElementById('triggerBtn');
const resetBtn    = document.getElementById('resetBtn');
const $vulns   = document.getElementById('statVulns');
const $defs    = document.getElementById('statDefenses');
const $exfil   = document.getElementById('statExfil');
const $agentCt = document.getElementById('agentCount');
const $netMeta = document.getElementById('netMeta');
const $exfilBadge = document.getElementById('exfilBadge');

// ── ANSI palette (mapped to the xterm theme below) ───────────────
const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', B = '\x1b[36m',
      DIM = '\x1b[2m', BOLD = '\x1b[1m', RST = '\x1b[0m';

// ════════════════════════════════════════════════════════════════
// Network map
// ════════════════════════════════════════════════════════════════
const NODE_DEF = {
  target:  { x: 300, y: 210, r: 34, label: 'target',     ip: '10.0.0.15' },
  auth:    { x: 140, y:  90, r: 22, label: 'auth',       ip: '10.0.0.11' },
  api:     { x: 460, y:  90, r: 22, label: 'api-gw',     ip: '10.0.0.12' },
  secrets: { x:  80, y: 320, r: 22, label: 'secrets',    ip: '10.0.0.13' },
  db:      { x: 520, y: 320, r: 22, label: 'user-db',    ip: '10.0.0.14' },
  prompt:  { x: 300, y: 380, r: 22, label: 'sys-prompt', ip: '10.0.0.16' }
};
const EDGE_DEF = ['auth', 'api', 'secrets', 'db', 'prompt'].map(id => ({ id, from: 'target', to: id }));
const NAME_TO_KEY = {
  'Auth': 'auth', 'API gateway': 'api', 'Secrets': 'secrets',
  'User DB': 'db', 'System prompt': 'prompt'
};

function buildMap() {
  const svg = document.getElementById('attackMap');
  const ns = 'http://www.w3.org/2000/svg';
  const edgesG = document.getElementById('edges');
  const nodesG = document.getElementById('nodes');

  EDGE_DEF.forEach(e => {
    const f = NODE_DEF[e.from], t = NODE_DEF[e.to];
    const line = document.createElementNS(ns, 'line');
    line.id = `edge-${e.id}`; line.setAttribute('class', 'edge');
    line.setAttribute('x1', f.x); line.setAttribute('y1', f.y);
    line.setAttribute('x2', t.x); line.setAttribute('y2', t.y);
    edgesG.appendChild(line);
  });

  Object.entries(NODE_DEF).forEach(([key, n]) => {
    const g = document.createElementNS(ns, 'g');
    const ring = document.createElementNS(ns, 'circle');
    ring.setAttribute('cx', n.x); ring.setAttribute('cy', n.y);
    ring.setAttribute('r', n.r + 9); ring.setAttribute('class', 'node-ring');

    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', n.x); c.setAttribute('cy', n.y); c.setAttribute('r', n.r);
    c.setAttribute('class', key === 'target' ? 'node node-center' : 'node');
    c.id = `node-${key}`;

    const lbl = document.createElementNS(ns, 'text');
    lbl.setAttribute('x', n.x); lbl.setAttribute('y', n.y);
    lbl.setAttribute('class', key === 'target' ? 'node-label' : 'node-label-small');
    lbl.setAttribute('text-anchor', 'middle'); lbl.setAttribute('dominant-baseline', 'middle');
    lbl.textContent = n.label;

    const ip = document.createElementNS(ns, 'text');
    ip.setAttribute('x', n.x); ip.setAttribute('y', n.y + n.r + 12);
    ip.setAttribute('class', 'node-ip'); ip.setAttribute('text-anchor', 'middle');
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
  const k = Object.keys(NAME_TO_KEY).find(x => x.toLowerCase().includes(lower));
  return k ? NAME_TO_KEY[k] : null;
}
function probeNode(name) {
  const key = resolveKey(name); if (!key) return;
  const el = document.getElementById(`node-${key}`);
  if (el) { el.classList.add('probed'); setTimeout(() => el.classList.remove('probed'), 2000); }
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
  const edge = document.getElementById(`edge-${EDGE_DEF[Math.floor(Math.random() * EDGE_DEF.length)].id}`);
  if (!edge) return;
  const ns = 'http://www.w3.org/2000/svg';
  const x1 = +edge.getAttribute('x1'), y1 = +edge.getAttribute('y1');
  const x2 = +edge.getAttribute('x2'), y2 = +edge.getAttribute('y2');
  const dot = document.createElementNS(ns, 'circle');
  dot.setAttribute('r', type === 'red' ? '4' : '3.2');
  dot.setAttribute('class', `traffic-dot${type === 'red' ? ' red' : ''}`);
  const anim = document.createElementNS(ns, 'animateMotion');
  anim.setAttribute('dur', type === 'red' ? '1.3s' : '1.9s'); anim.setAttribute('repeatCount', '1');
  const pid = `p-${Math.random().toString(36).slice(2, 8)}`;
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', `M ${x2} ${y2} L ${x1} ${y1}`); path.setAttribute('id', pid);
  svg.appendChild(path);
  const mp = document.createElementNS(ns, 'mpath');
  mp.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', `#${pid}`);
  anim.appendChild(mp); dot.appendChild(anim); traffic.appendChild(dot);
  setTimeout(() => { try { traffic.removeChild(dot); svg.removeChild(path); } catch (e) {} }, 2100);
}
function startAmbientTraffic() {
  setInterval(() => { if (Math.random() > 0.6) createTrafficDot(Math.random() > 0.5 ? 'blue' : 'red'); }, 1700);
}

// ════════════════════════════════════════════════════════════════
// Terminal + interactive REPL
// ════════════════════════════════════════════════════════════════
const PROMPT = `${G}breach${RST}${DIM}@${RST}${B}acme${RST}${DIM}:~$${RST} `;
let replActive = false;
let inputBuf = '';
const history = [];
let histIdx = 0;

function tts() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${DIM}${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${RST}`;
}
function toHex(s) {
  return Array.from(String(s).slice(0, 18)).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
}
function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// Single logging channel. Survives concurrent typing: clear input line,
// write the log line, then redraw the prompt + whatever was being typed.
function tw(s = '') {
  if (!term) return;
  s = String(s);
  if (!replActive) { term.write(s + '\r\n'); return; }
  term.write('\r\x1b[2K' + s + '\r\n' + PROMPT + inputBuf);
}
function drawPrompt() { term.write('\r\x1b[2K' + PROMPT + inputBuf); }

function initTerminal() {
  if (!window.Terminal) { console.warn('xterm missing'); return; }
  term = new window.Terminal({
    theme: {
      background: '#05070a', foreground: '#c4ccd2',
      cursor: '#25ff9a', cursorAccent: '#05070a', selectionBackground: 'rgba(37,255,154,0.25)',
      black: '#0b0e12', brightBlack: '#59636d',
      red: '#ff4d5e', brightRed: '#ff6f7d',
      green: '#25ff9a', brightGreen: '#5cffb4',
      yellow: '#ffc24b', brightYellow: '#ffd277',
      blue: '#4aa6ff', brightBlue: '#74bcff',
      magenta: '#c08bff', brightMagenta: '#d0a8ff',
      cyan: '#4aa6ff', brightCyan: '#74bcff',
      white: '#c4ccd2', brightWhite: '#e8f0f4',
    },
    fontFamily: '"JetBrains Mono","Cascadia Code",monospace',
    fontSize: 12.5, lineHeight: 1.4, cursorBlink: true, cursorStyle: 'bar',
    allowTransparency: true, scrollback: 3000, convertEol: false,
  });
  if (window.FitAddon) { fitAddon = new window.FitAddon.FitAddon(); term.loadAddon(fitAddon); }
  term.open(document.getElementById('terminal'));
  if (fitAddon) setTimeout(() => fitAddon.fit(), 100);
  window.addEventListener('resize', () => { if (fitAddon) fitAddon.fit(); });

  banner();
  replActive = true;
  drawPrompt();
  term.onData(onData);
  document.getElementById('terminal').addEventListener('click', () => term.focus());
}

function banner() {
  tw('');
  tw(`  ${BOLD}${G}██╗     ██╗██╗   ██╗███████╗${RST}   ${BOLD}${R}██████╗ ██████╗ ███████╗ █████╗  ██████╗██╗  ██╗${RST}`);
  tw(`  ${BOLD}${G}██║     ██║██║   ██║██╔════╝${RST}   ${BOLD}${R}██╔══██╗██╔══██╗██╔════╝██╔══██╗██╔════╝██║  ██║${RST}`);
  tw(`  ${BOLD}${G}██║     ██║██║   ██║█████╗  ${RST}   ${BOLD}${R}██████╔╝██████╔╝█████╗  ███████║██║     ███████║${RST}`);
  tw(`  ${BOLD}${G}██║     ██║╚██╗ ██╔╝██╔══╝  ${RST}   ${BOLD}${R}██╔══██╗██╔══██╗██╔══╝  ██╔══██║██║     ██╔══██║${RST}`);
  tw(`  ${BOLD}${G}███████╗██║ ╚████╔╝ ███████╗${RST}   ${BOLD}${R}██████╔╝██║  ██║███████╗██║  ██║╚██████╗██║  ██║${RST}`);
  tw(`  ${DIM}╚══════╝╚═╝  ╚═══╝  ╚══════╝   ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝ v2.0${RST}`);
  tw('');
  tw(`  ${DIM}autonomous red/blue agent adversarial simulation · target 10.0.0.15:3000${RST}`);
  tw(`  ${DIM}type ${RST}${G}help${RST}${DIM} for commands · ${RST}${G}breach${RST}${DIM} to launch the swarm${RST}`);
  tw('');
}

function onData(data) {
  if (!replActive) return;
  if (data === '\x1b[A') return historyPrev();
  if (data === '\x1b[B') return historyNext();
  if (data === '\x1b[C' || data === '\x1b[D') return;       // ignore L/R
  for (const ch of data) {
    if (ch === '\r')      submit();
    else if (ch === '\x7f') { if (inputBuf) { inputBuf = inputBuf.slice(0, -1); term.write('\b \b'); } }
    else if (ch === '\x03') { term.write('^C\r\n'); inputBuf = ''; drawPrompt(); }    // Ctrl-C
    else if (ch === '\x0c') { cmdClear(); }                                            // Ctrl-L
    else if (ch >= ' ')   { inputBuf += ch; term.write(ch); }
  }
}
function historyPrev() {
  if (!history.length) return;
  histIdx = Math.max(0, histIdx - 1);
  inputBuf = history[histIdx] || '';
  drawPrompt();
}
function historyNext() {
  if (!history.length) return;
  histIdx = Math.min(history.length, histIdx + 1);
  inputBuf = history[histIdx] || '';
  drawPrompt();
}
function submit() {
  term.write('\r\n');
  const line = inputBuf.trim();
  inputBuf = '';
  if (line) { history.push(line); histIdx = history.length; }
  runCommand(line);
  drawPrompt();
}

// raw command output (prompt is redrawn by submit afterwards)
function out(s = '') { term.write(s + '\r\n'); }

function runCommand(line) {
  if (!line) return;
  const [cmd, ...rest] = line.split(/\s+/);
  const arg = rest.join(' ');
  switch (cmd.toLowerCase()) {
    case 'help': case '?':
      out(`${G}commands${RST}`);
      out(`  ${B}breach${RST}            launch the red vs blue agent swarm`);
      out(`  ${B}inject${RST} <payload>  send a manual attack to the blue-team judge`);
      out(`  ${B}status${RST}            show live battle stats`);
      out(`  ${B}reset${RST}             reset the war room`);
      out(`  ${B}clear${RST}             clear the console`);
      out(`  ${DIM}↑/↓ history · ctrl-c cancel · ctrl-l clear${RST}`);
      break;
    case 'breach': case 'attack': case 'start': cmdBreach(); break;
    case 'reset': cmdReset(); break;
    case 'clear': case 'cls': cmdClear(); break;
    case 'status': cmdStatus(); break;
    case 'inject': case 'payload':
      if (!arg) { out(`${R}usage:${RST} inject <payload>`); break; }
      sendManualAttack(arg);
      break;
    default:
      out(`${R}command not found:${RST} ${escTerm(cmd)}  ${DIM}— type 'help'${RST}`);
  }
}
function escTerm(s) { return String(s).replace(/[\x00-\x1f\x7f]/g, ''); }

function cmdBreach() {
  if (triggerBtn.disabled) { out(`${Y}[!]${RST} swarm already running`); return; }
  triggerBtn.disabled = true;
  out(`${Y}[user]${RST} launching breach sequence...`);
  fetch('/api/trigger-breach', { method: 'POST' }).catch(() => {});
}
function cmdReset() {
  out(`${DIM}resetting...${RST}`);
  fetch('/api/reset', { method: 'POST' }).catch(() => {});
}
function cmdClear() {
  term.clear();
  term.write('\x1b[2K\r');
  inputBuf = '';
  drawPrompt();
}
function cmdStatus() {
  out(`${G}battle status${RST}`);
  out(`  vulnerabilities  ${R}${liveStats.vulns}${RST}`);
  out(`  defenses         ${B}${liveStats.defenses}${RST}`);
  out(`  data exfiltrated ${Y}${$exfil.textContent}${RST}`);
  out(`  packets          ${liveStats.packets}`);
  out(`  agents online    ${agentsGrid.querySelectorAll('.agent').length}`);
}
async function sendManualAttack(payload) {
  out(`${Y}[inject]${RST} ${R}${escTerm(payload)}${RST}`);
  bump(3);
  try {
    await fetch('/api/judge-attack', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload })
    });
  } catch (e) { out(`${R}[error]${RST} request failed`); }
}

// ════════════════════════════════════════════════════════════════
// Agents rail
// ════════════════════════════════════════════════════════════════
function addAgent(id, role, ip) {
  const empty = agentsGrid.querySelector('.empty');
  if (empty) empty.remove();
  if (document.getElementById(`ar-${id}`)) return;
  const row = document.createElement('div');
  row.className = `agent ${role}`; row.id = `ar-${id}`;
  row.innerHTML = `
    <span class="dot"></span>
    <span class="id">${id}</span>
    <span class="st" id="as-${id}">init</span>
    <div class="bar"><i id="ab-${id}"></i></div>`;
  agentsGrid.appendChild(row);
  $agentCt.textContent = `${agentsGrid.querySelectorAll('.agent').length} active`;
}
function setAgent(id, status, pct) {
  const s = document.getElementById(`as-${id}`); if (s) s.textContent = String(status).toLowerCase().slice(0, 10);
  const b = document.getElementById(`ab-${id}`); if (b && pct != null) b.style.width = `${Math.min(pct, 100)}%`;
}

// ════════════════════════════════════════════════════════════════
// Exfil + stats
// ════════════════════════════════════════════════════════════════
function addExfil(type, data, bytes) {
  const empty = exfilCont.querySelector('.empty'); if (empty) empty.remove();
  const e = document.createElement('div'); e.className = 'exfil-entry';
  e.innerHTML = `
    <div class="exfil-top"><span class="exfil-type">${escHtml(type)}</span><span class="exfil-bytes">${bytes} B</span></div>
    <div class="exfil-raw">${escHtml(String(data).slice(0, 120))}</div>
    <div class="exfil-hex">${toHex(data)} ···</div>`;
  exfilCont.insertBefore(e, exfilCont.firstChild);
  const n = exfilCont.querySelectorAll('.exfil-entry').length;
  if ($exfilBadge) $exfilBadge.textContent = ` ${n}`;
}
function bump(n) { liveStats.packets += (n || 1); }
function addExfilBytes(n) {
  liveStats.exfilBytes += n; const b = liveStats.exfilBytes;
  $exfil.textContent = b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(2)} MB`;
}

// ════════════════════════════════════════════════════════════════
// Event stream → terminal narrative
// ════════════════════════════════════════════════════════════════
function handleEvent(ev) {
  switch (ev.type) {
    case 'idle': break;

    case 'swarm_started':
      tw('');
      tw(`${tts()} ${Y}[*]${RST} deploying attack swarm → ${B}10.0.0.15:3000${RST}`);
      tw(`${tts()} ${R}[+]${RST} red team:  ${BOLD}${ev.teams.red} agents${RST} ${DIM}// attackers${RST}`);
      tw(`${tts()} ${B}[+]${RST} blue team: ${BOLD}${ev.teams.blue} agents${RST} ${DIM}// defenders${RST}`);
      if ($netMeta) $netMeta.textContent = '5 nodes · live';
      break;

    case 'agent_spawned': {
      const { role, index: idx, id } = ev.agent;
      const ip = role === 'red' ? (RED_IPS[idx] || `192.168.10.${20 + idx}`) : (BLUE_IPS[idx] || `10.255.0.${30 + idx}`);
      agentIps[id] = ip;
      const col = role === 'red' ? R : B;
      tw(`${tts()} ${col}[spawn]${RST} ${BOLD}${id}${RST} ${DIM}${ip} → 10.0.0.15${RST}`);
      addAgent(id, role, ip); setAgent(id, 'ready', 6);
      break;
    }

    case 'round_started':
      tw('');
      tw(`${DIM}  ──────────────── round ${ev.round} ────────────────${RST}`);
      bump(2);
      break;

    case 'agent_reasoning': {
      const col = ev.agent.startsWith('red') ? R : B;
      tw(`${tts()} ${col}${ev.agent}${RST} ${DIM}▸${RST} ${ev.text}`);
      setAgent(ev.agent, 'reasoning', 42); bump(2);
      break;
    }

    case 'node_probed':
      probeNode(ev.node);
      tw(`${tts()} ${Y}[probe]${RST} scanning ${BOLD}${ev.node}${RST} ${DIM}// fingerprint${RST}`);
      bump(3);
      break;

    case 'vulnerability_found': {
      const v = ev.vulnerability;
      liveStats.vulns++; $vulns.textContent = liveStats.vulns;
      bump(12);
      const sz = 700 + Math.floor(Math.random() * 2200); addExfilBytes(sz);
      const pad = s => String(s || '').slice(0, 40).padEnd(40);
      const cvss = v.severity === 'CRITICAL' ? '9.8' : v.severity === 'HIGH' ? '7.5' : '5.0';
      tw('');
      tw(`${R}  ┌─ ⚠ VULNERABILITY ───────────────────────────────┐${RST}`);
      tw(`${R}  │${RST} type     ${BOLD}${pad(v.type)}${R}│${RST}`);
      tw(`${R}  │${RST} severity ${R}${BOLD}${pad(v.severity + '  (CVSS ' + cvss + ')')}${RST}${R}│${RST}`);
      tw(`${R}  │${RST} endpoint ${Y}${pad(v.endpoint)}${R}│${RST}`);
      tw(`${R}  │${RST} payload  ${DIM}${pad(v.payload || '—')}${R}│${RST}`);
      tw(`${R}  └──────────────────────────────────────────────────┘${RST}`);
      const leaked = v.details && (v.details.secret || v.details.data);
      if (leaked) {
        const ls = typeof leaked === 'object' ? JSON.stringify(leaked) : String(leaked);
        tw(`  ${R}[!]${RST} ${BOLD}EXFILTRATED${RST} ${Y}${ls.slice(0, 60)}${RST}`);
        tw(`      ${DIM}hex ${toHex(ls)} ··· ${sz}B · ${ev.agent}${RST}`);
        addExfil(v.type, ls, sz);
      }
      breachNode(ev.node || v.endpoint);
      setAgent(ev.agent, 'exploit', 96);
      break;
    }

    case 'exploit_chain':
      tw(`${tts()} ${R}[chain]${RST} ${ev.agent} chained ${BOLD}${ev.chain.length}${RST} exploits ${DIM}// priv-esc${RST}`);
      break;

    case 'attack': {
      bump(4);
      const [aid, detail] = splitDot(ev.text);
      const blocked = /block/i.test(detail);
      tw(`${tts()} ${R}[atk]${RST} ${DIM}${aid}${RST} ${detail}`);
      tw(`        ${DIM}← ${blocked ? '403 forbidden' : '200 ok'} · ${10 + Math.floor(Math.random() * 50)}ms${RST}`);
      createTrafficDot('red');
      if (aid.startsWith('red')) setAgent(aid, blocked ? 'blocked' : 'attacking', 56);
      break;
    }

    case 'defense_deployed': {
      const d = ev.defense;
      liveStats.defenses++; $defs.textContent = liveStats.defenses;
      tw(`${tts()} ${B}[defense]${RST} ${ev.agent} ▸ ${BOLD}${d.type}${RST} on ${Y}${d.endpoint}${RST} ${G}[enforced]${RST}`);
      setAgent(ev.agent, 'blocking', 80); bump(4);
      break;
    }

    case 'defense': {
      bump(2);
      const [da, dd] = splitDot(ev.text);
      tw(`${tts()} ${B}[def]${RST}  ${DIM}${da}${RST} ${dd}`);
      createTrafficDot('blue');
      if (da.startsWith('blue')) setAgent(da, 'monitor', 46);
      break;
    }

    case 'node_breached': breachNode(ev.node); break;
    case 'attack_started': tw(`${tts()} ${R}[*]${RST} attack sequence initiated`); break;

    case 'breach_confirmed': {
      breachFinale();
      const s = ev.stats || {};
      tw('');
      tw(`${R}  ╔═══════════════════════════════════════════════════╗${RST}`);
      tw(`${R}  ║   ${BOLD}⚡ BREACH CONFIRMED · SYSTEM COMPROMISED${RST}${R}        ║${RST}`);
      tw(`${R}  ╚═══════════════════════════════════════════════════╝${RST}`);
      tw(`  ${DIM}vulns ${s.vulnerabilitiesFound || liveStats.vulns} · defenses ${s.defensesDeployed || liveStats.defenses} · exfil ${$exfil.textContent} · packets ${liveStats.packets}${RST}`);
      tw('');
      break;
    }

    case 'swarm_stopped':
      tw(`${DIM}  battle ended · ${ev.stats.currentRound} rounds${RST}`);
      tw('');
      triggerBtn.disabled = false;
      break;

    case 'reset': resetUI(); break;
  }
}
function splitDot(text) {
  const i = text.indexOf(' · ');
  return i < 0 ? [text, ''] : [text.slice(0, i), text.slice(i + 3)];
}

// ════════════════════════════════════════════════════════════════
// Breach finale + reset
// ════════════════════════════════════════════════════════════════
function breachFinale() {
  app.classList.add('shake'); setTimeout(() => app.classList.remove('shake'), 550);
  breachAlert.classList.add('active');
  statusPill.classList.add('breached'); statusText.textContent = 'breached';
  meterFill.classList.add('breach'); meterValue.classList.add('breach');
  animateMeter(parseInt(meterValue.textContent) || 18, 100, 1000);
  triggerBtn.disabled = false;
}
function animateMeter(from, to, dur) {
  const start = Date.now();
  (function tick() {
    const p = Math.min((Date.now() - start) / dur, 1);
    const v = Math.floor(from + (to - from) * p);
    meterFill.style.width = `${v}%`; meterValue.textContent = `${v}%`;
    if (p < 1) requestAnimationFrame(tick);
  })();
}
function resetUI() {
  breachAlert.classList.remove('active');
  statusPill.classList.remove('breached'); statusText.textContent = 'secure';
  meterFill.classList.remove('breach'); meterFill.style.width = '18%';
  meterValue.classList.remove('breach'); meterValue.textContent = '18%';
  agentsGrid.innerHTML = '<div class="empty">awaiting deployment</div>';
  exfilCont.innerHTML = '<div class="empty">no data exfiltrated</div>';
  $agentCt.textContent = '0 active';
  if ($netMeta) $netMeta.textContent = '5 nodes · idle';
  if ($exfilBadge) $exfilBadge.textContent = '';
  document.querySelectorAll('.node').forEach(n => n.classList.remove('probed', 'breached'));
  document.querySelectorAll('.edge').forEach(e => e.classList.remove('breached'));
  liveStats.vulns = liveStats.defenses = liveStats.exfilBytes = liveStats.packets = 0;
  $vulns.textContent = '0'; $defs.textContent = '0'; $exfil.textContent = '0 B';
  if (term) { tw(`${DIM}  war room reset.${RST}`); tw(''); }
  triggerBtn.disabled = false;
}

// ════════════════════════════════════════════════════════════════
// Tabs / controls / SSE / init
// ════════════════════════════════════════════════════════════════
function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`)?.classList.add('active');
      if (tab.dataset.tab === 'console' && fitAddon) { fitAddon.fit(); term.focus(); }
    });
  });
}
function setupControls() {
  triggerBtn.addEventListener('click', () => { cmdBreach(); term && term.focus(); });
  resetBtn.addEventListener('click', () => { cmdReset(); term && term.focus(); });
}
function connectStream() {
  const es = new EventSource('/api/stream');
  es.onmessage = e => { try { handleEvent(JSON.parse(e.data)); } catch (x) {} };
  es.onerror = () => tw(`${R}[error]${RST} SSE connection lost`);
}

function init() {
  buildMap();
  initTerminal();
  setupTabs();
  setupControls();
  connectStream();
  startAmbientTraffic();
  // Re-fit + focus the terminal once the boot screen dissolves.
  window.addEventListener('liveBreach:boot-complete', () => {
    if (fitAddon) fitAddon.fit();
    if (term) term.focus();
  });
}
init();
