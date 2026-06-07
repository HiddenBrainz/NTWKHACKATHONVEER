/* ===========================================================================
   Adversarial Evolution Arena — frontend.

   Fully self-contained: injects its own DOM + CSS and opens its OWN SSE
   connection to /api/stream, so it cooperates with the rest of the app without
   touching app.js. It listens only for arena_* events and ignores the rest.
   =========================================================================== */
(function () {
  'use strict';

  // ---- inject stylesheet (once) -------------------------------------------
  if (!document.getElementById('arena-css')) {
    const link = document.createElement('link');
    link.id = 'arena-css';
    link.rel = 'stylesheet';
    link.href = 'arena.css';
    document.head.appendChild(link);
  }

  // ---- build DOM -----------------------------------------------------------
  const section = document.createElement('section');
  section.id = 'arena-section';
  section.innerHTML = `
    <div class="arena-head">
      <div>
        <div class="arena-title">🧬 ADVERSARIAL EVOLUTION ARENA</div>
        <div class="arena-sub">genetic jailbreak engine vs adaptive vector-space firewall · live coevolution</div>
      </div>
      <div class="arena-status" id="arenaStatus">idle</div>
      <button class="arena-btn" id="evolveBtn">🧬 EVOLVE JAILBREAK</button>
    </div>

    <div class="arena-badges">
      <div class="badge gen">GEN<b id="arenaGen">0</b></div>
      <div class="badge red">RED ELO<b id="redElo">1000</b></div>
      <div class="badge blue">BLUE ELO<b id="blueElo">1000</b></div>
      <div class="badge synth">SYNTH GENES<b id="synthCount">0</b></div>
      <div class="badge">FIREWALL τ<b id="fwThresh">—</b></div>
      <div class="badge ledger">⛓ LEDGER<b id="ledgerHash">—</b></div>
    </div>

    <div class="arena-grid">
      <div class="arena-panel">
        <div class="ap-title">Gene Pool <span id="poolMeta">awaiting evolution</span></div>
        <div class="genepool" id="genePool"></div>
      </div>
      <div class="arena-panel">
        <div class="ap-title">Arms Race <span id="armsMeta"></span></div>
        <canvas id="armsCanvas"></canvas>
        <div class="arms-legend">
          <span class="lg red">red attack fitness</span>
          <span class="lg blue">blue defense strength</span>
          <span class="lg dim">avg fitness</span>
        </div>
      </div>
      <div class="arena-panel">
        <div class="ap-title">Vector-Space Firewall <span id="fwMeta"></span></div>
        <canvas id="scatterCanvas"></canvas>
        <div class="scatter-legend">
          <span class="lg blue">benign traffic</span>
          <span class="lg green">passed</span>
          <span class="lg red">blocked</span>
          <span class="lg yellow">jailbreak</span>
        </div>
      </div>
    </div>

    <div class="arena-jailbreak" id="arenaJailbreak"></div>
  `;

  // Insert before the controls if present, else append to the main container.
  const container = document.getElementById('container') || document.body;
  const controls = container.querySelector('.controls');
  if (controls) container.insertBefore(section, controls);
  else container.appendChild(section);

  const $ = id => document.getElementById(id);
  const els = {
    status: $('arenaStatus'), evolveBtn: $('evolveBtn'),
    gen: $('arenaGen'), redElo: $('redElo'), blueElo: $('blueElo'),
    synth: $('synthCount'), fwThresh: $('fwThresh'), ledger: $('ledgerHash'),
    poolMeta: $('poolMeta'), genePool: $('genePool'),
    armsCanvas: $('armsCanvas'), armsMeta: $('armsMeta'),
    scatter: $('scatterCanvas'), fwMeta: $('fwMeta'),
    jailbreak: $('arenaJailbreak'),
  };

  // ---- state ---------------------------------------------------------------
  const state = {
    running: false,
    redSeries: [], blueSeries: [], avgSeries: [],
    benign: [], safeCentroid: null, points: [], threshold: 0.48,
  };

  // ---- canvas helpers ------------------------------------------------------
  function fitCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    const w = Math.max(10, r.width), h = Math.max(10, r.height || 190);
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function drawArms() {
    const { ctx, w, h } = fitCanvas(els.armsCanvas);
    ctx.clearRect(0, 0, w, h);
    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = (h - 16) * (i / 4) + 4;
      ctx.beginPath(); ctx.moveTo(28, y); ctx.lineTo(w - 4, y); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(150,160,180,0.6)'; ctx.font = '9px monospace';
    ctx.fillText('1.0', 4, 10); ctx.fillText('0.5', 4, (h - 16) / 2 + 8); ctx.fillText('0', 12, h - 14);

    const n = Math.max(state.redSeries.length, state.blueSeries.length, 2);
    const x = i => 28 + (w - 34) * (n <= 1 ? 0 : i / (n - 1));
    const y = v => 4 + (h - 20) * (1 - Math.max(0, Math.min(1, v)));

    const line = (series, color, width, dashed) => {
      if (series.length < 1) return;
      ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.setLineDash(dashed ? [4, 4] : []);
      ctx.beginPath();
      series.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
      ctx.stroke();
      ctx.setLineDash([]);
      // glow dot on last point
      const li = series.length - 1;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x(li), y(series[li]), 3, 0, 7); ctx.fill();
    };
    line(state.avgSeries, 'rgba(150,160,180,0.5)', 1.5, true);
    line(state.blueSeries, '#19e3ff', 2, false);
    line(state.redSeries, '#ff3b5c', 2, false);
  }

  function drawScatter() {
    const { ctx, w, h } = fitCanvas(els.scatter);
    ctx.clearRect(0, 0, w, h);

    const all = [...state.benign, ...state.points];
    if (state.safeCentroid) all.push(state.safeCentroid);
    if (all.length === 0) return;
    let minX = Math.min(...all.map(p => p.x)), maxX = Math.max(...all.map(p => p.x));
    let minY = Math.min(...all.map(p => p.y)), maxY = Math.max(...all.map(p => p.y));
    const padX = (maxX - minX || 0.2) * 0.18, padY = (maxY - minY || 0.2) * 0.18;
    minX -= padX; maxX += padX; minY -= padY; maxY += padY;
    const sx = v => 8 + (w - 16) * ((v - minX) / (maxX - minX || 1));
    const sy = v => 8 + (h - 16) * (1 - (v - minY) / (maxY - minY || 1));

    // safe-zone ring (shrinks as blue tightens) — illustrative boundary
    if (state.safeCentroid) {
      const cx = sx(state.safeCentroid.x), cy = sy(state.safeCentroid.y);
      const rad = Math.max(14, Math.min(w, h) * 0.46 * (state.threshold / 0.48));
      const g = ctx.createRadialGradient(cx, cy, rad * 0.2, cx, cy, rad);
      g.addColorStop(0, 'rgba(25,227,255,0.10)');
      g.addColorStop(1, 'rgba(25,227,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(25,227,255,0.35)'; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    }
    // benign cloud
    ctx.fillStyle = 'rgba(25,227,255,0.5)';
    state.benign.forEach(p => { ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), 2.5, 0, 7); ctx.fill(); });
    // safe centroid marker
    if (state.safeCentroid) {
      ctx.fillStyle = '#19e3ff';
      ctx.beginPath(); ctx.arc(sx(state.safeCentroid.x), sy(state.safeCentroid.y), 4.5, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1; ctx.stroke();
    }
    // genome points (newest brightest)
    const pts = state.points.slice(-46);
    pts.forEach((p, i) => {
      const fade = 0.3 + 0.7 * (i / pts.length);
      if (p.leaked) {
        ctx.fillStyle = `rgba(255,210,63,${fade})`;
        star(ctx, sx(p.x), sy(p.y), 6, 4.5);
      } else if (p.blocked) {
        ctx.strokeStyle = `rgba(255,59,92,${fade})`; ctx.lineWidth = 1.5;
        const X = sx(p.x), Y = sy(p.y);
        ctx.beginPath(); ctx.moveTo(X - 3, Y - 3); ctx.lineTo(X + 3, Y + 3);
        ctx.moveTo(X + 3, Y - 3); ctx.lineTo(X - 3, Y + 3); ctx.stroke();
      } else {
        ctx.fillStyle = `rgba(61,220,132,${fade})`;
        ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), 3, 0, 7); ctx.fill();
      }
    });
  }

  function star(ctx, x, y, outer, inner) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? inner : outer;
      const a = Math.PI / 5 * i - Math.PI / 2;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath(); ctx.fill();
  }

  // ---- renderers -----------------------------------------------------------
  function renderPool(snap) {
    const max = Math.max(1, ...snap.population.map(p => Math.abs(p.fitness || 0)), 105);
    els.genePool.innerHTML = '';
    snap.population.forEach(p => {
      const row = document.createElement('div');
      const lin = (p.lineage || 'spawn').replace('llm-synth', 'llm');
      row.className = 'gene-row' + (p.leaked ? ' leaked' : '') + (p.blocked ? ' blocked' : '');
      const pct = Math.max(0, Math.min(100, (p.fitness / max) * 100));
      const icon = p.leaked ? '💥' : p.blocked ? '🚫' : '·';
      row.innerHTML = `
        <div class="gene-bar" style="width:${pct}%"></div>
        <span class="gene-status">${icon}</span>
        <span class="gene-fit">${(p.fitness ?? 0).toFixed(1)}</span>
        <span class="gene-lin ${lin}">${lin}</span>
        <span class="gene-pay">${escapeHtml(p.payload).slice(0, 90)}</span>`;
      els.genePool.appendChild(row);
    });
    els.poolMeta.textContent = `gen ${snap.generation} · avg ${snap.avgFitness.toFixed(1)} · best ${snap.best.fitness.toFixed(1)}`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function flashElo() {
    [els.redElo.parentElement, els.blueElo.parentElement].forEach(b => {
      b.classList.remove('elo-flash'); void b.offsetWidth; b.classList.add('elo-flash');
    });
  }

  // ---- event handling ------------------------------------------------------
  function handle(ev) {
    switch (ev.type) {
      case 'arena_started':
        state.running = true;
        state.redSeries = []; state.blueSeries = []; state.avgSeries = [];
        state.points = [];
        state.benign = ev.benignPoints || [];
        state.safeCentroid = ev.safeCentroid || null;
        state.threshold = ev.firewall?.threshold ?? 0.48;
        els.status.textContent = `evolving · ${ev.provider === 'fallback' ? 'offline sim' : ev.provider}`;
        els.status.className = 'arena-status live';
        els.redElo.textContent = ev.redElo; els.blueElo.textContent = ev.blueElo;
        els.evolveBtn.disabled = true;
        els.jailbreak.className = 'arena-jailbreak';
        drawScatter(); drawArms();
        break;

      case 'generation_started':
        els.gen.textContent = ev.generation;
        break;

      case 'genome_scored':
        if (ev.coords) state.points.push({ x: ev.coords.x, y: ev.coords.y, blocked: ev.blocked, leaked: ev.leaked });
        if (state.points.length > 200) state.points = state.points.slice(-120);
        drawScatter();
        break;

      case 'population_snapshot':
        renderPool(ev);
        break;

      case 'firewall_state':
        state.threshold = ev.threshold;
        els.fwThresh.textContent = ev.threshold.toFixed(2);
        els.fwMeta.textContent = `τ=${ev.threshold.toFixed(2)} · ${ev.blocked}/${ev.inspected} blocked · ${ev.attackCount} learned`;
        drawScatter();
        break;

      case 'arms_race':
        state.redSeries.push(ev.redFitness);
        state.blueSeries.push(ev.blueStrength);
        if (typeof ev.avgFitness === 'number') state.avgSeries.push(ev.avgFitness);
        els.redElo.textContent = ev.redElo; els.blueElo.textContent = ev.blueElo;
        els.armsMeta.textContent = `gen ${ev.generation} · ${ev.winner === 'red' ? 'RED won round' : 'BLUE held'}`;
        flashElo();
        drawArms();
        break;

      case 'gene_synthesized':
        els.synth.textContent = ev.totalSynth;
        break;

      case 'jailbreak_found':
        showJailbreak(ev);
        break;

      case 'firewall_adapted':
        els.fwThresh.textContent = ev.threshold.toFixed(2);
        appendAdapt(ev);
        break;

      case 'ledger':
        els.ledger.textContent = ev.head.slice(0, 10) + '…';
        break;

      case 'arena_complete':
        state.running = false;
        els.evolveBtn.disabled = false;
        if (ev.verdict) {
          els.status.textContent = ev.verdict.startsWith('RED') ? 'red team ascendant' : 'blue team held';
          els.status.className = 'arena-status ' + (ev.verdict.startsWith('RED') ? 'red-win' : 'blue-win');
        } else {
          els.status.textContent = 'complete';
          els.status.className = 'arena-status';
        }
        break;

      case 'reset':
        resetArena();
        break;
    }
  }

  function showJailbreak(ev) {
    els.jailbreak.className = 'arena-jailbreak show breach';
    els.jailbreak.innerHTML = `
      <div class="jb-head">💥 JAILBREAK · generation ${ev.generation} · fitness ${ev.fitness.toFixed(1)}</div>
      <div class="jb-row"><b>payload »</b> ${escapeHtml(ev.payload).slice(0, 220)}</div>
      <div class="jb-row"><b>victim »</b> ${escapeHtml(ev.response || '').slice(0, 220)}</div>
      ${ev.secret ? `<div class="jb-row">exfiltrated secret: <span class="jb-flag">${escapeHtml(ev.secret)}</span></div>` : ''}
      <div class="jb-adapt" id="jbAdapt"></div>`;
    // re-trigger flash animation
    void els.jailbreak.offsetWidth;
  }

  function appendAdapt(ev) {
    const a = document.getElementById('jbAdapt');
    if (a) a.textContent = `🛡 blue learned the signature → firewall tightened to τ=${ev.threshold.toFixed(2)} (now blocks this attack)`;
  }

  function resetArena() {
    state.running = false;
    state.redSeries = []; state.blueSeries = []; state.avgSeries = []; state.points = [];
    els.gen.textContent = '0'; els.redElo.textContent = '1000'; els.blueElo.textContent = '1000';
    els.synth.textContent = '0'; els.fwThresh.textContent = '—'; els.ledger.textContent = '—';
    els.poolMeta.textContent = 'awaiting evolution'; els.fwMeta.textContent = ''; els.armsMeta.textContent = '';
    els.genePool.innerHTML = '';
    els.status.textContent = 'idle'; els.status.className = 'arena-status';
    els.jailbreak.className = 'arena-jailbreak';
    els.evolveBtn.disabled = false;
    drawArms(); drawScatter();
  }

  // ---- controls ------------------------------------------------------------
  els.evolveBtn.addEventListener('click', async () => {
    els.evolveBtn.disabled = true;
    try {
      const res = await fetch('/api/evolve', { method: 'POST' });
      const data = await res.json();
      if (!data.success) { els.evolveBtn.disabled = false; els.status.textContent = data.message || 'busy'; }
    } catch (e) {
      els.evolveBtn.disabled = false;
    }
  });

  window.addEventListener('resize', () => { drawArms(); drawScatter(); });

  // ---- own SSE connection --------------------------------------------------
  function connect() {
    const es = new EventSource('/api/stream');
    es.onmessage = e => { try { handle(JSON.parse(e.data)); } catch (_) {} };
    es.onerror = () => { /* EventSource auto-reconnects */ };
  }
  connect();
  drawArms(); drawScatter();
})();
