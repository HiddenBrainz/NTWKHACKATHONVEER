/* ═══════════════════════════════════════════════════════════════
   Live Breach — Boot screen controller (self-contained).
   Plays a hacker-style init sequence, then dissolves into the app.
   Skippable (click / Esc / any key) and self-dismissing via a hard
   safety timeout so it can never block the dashboard.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  const screen = document.getElementById('bootScreen');
  if (!screen) return;

  document.body.classList.add('is-booting');

  const titleEl = screen.querySelector('.boot-title');
  const logEl   = screen.querySelector('#bootLog');
  const fillEl  = screen.querySelector('#bootBarFill');
  const pctEl   = screen.querySelector('#bootPct');

  let done = false;

  // ── Title scramble-decrypt ───────────────────────────────────
  const FINAL = 'LIVE BREACH';
  const GLYPHS = '!<>-_\\/[]{}=+*^?#01XZ░▒▓';
  const rnd = (s) => s[Math.floor(Math.random() * s.length)];

  function scramble(duration = 750) {
    const start = performance.now();
    function frame(now) {
      const p = Math.min((now - start) / duration, 1);
      const reveal = Math.floor(p * FINAL.length);
      let out = '';
      for (let i = 0; i < FINAL.length; i++) {
        if (FINAL[i] === ' ') { out += ' '; continue; }
        out += i < reveal ? FINAL[i] : rnd(GLYPHS);
      }
      titleEl.textContent = out;
      titleEl.setAttribute('data-text', out);
      if (p < 1) requestAnimationFrame(frame);
      else { titleEl.textContent = FINAL; titleEl.setAttribute('data-text', FINAL); }
    }
    requestAnimationFrame(frame);
  }

  // ── Boot log sequence ────────────────────────────────────────
  const STEPS = [
    ['0.00', 'POST · memory check ........... 16384 MB', 'ok'],
    ['0.18', 'mounting /dev/redteam ......... ONLINE', 'ok'],
    ['0.36', 'mounting /dev/blueteam ........ ONLINE', 'ok'],
    ['0.55', 'spawning red swarm [3 agents] . OK', 'ok'],
    ['0.74', 'spawning blue swarm [3 agents]  OK', 'ok'],
    ['0.95', 'arming genetic jailbreak engine OK', 'ok'],
    ['1.18', 'calibrating vector firewall ... OK', 'ok'],
    ['1.40', 'linking victim model · FLAG-7731', 'warn'],
    ['1.63', 'opening SSE telemetry uplink .. OK', 'ok'],
    ['1.88', '>> WAR ROOM ONLINE <<', 'crit'],
  ];

  function addLine([t, m, status], i) {
    const ln = document.createElement('div');
    ln.className = 'ln' + (status === 'crit' ? ' crit' : '');
    // Highlight the trailing status token (ONLINE / OK / FLAG-7731) in its colour.
    const body =
      status === 'crit'
        ? `<span class="m">${m}</span>`
        : `<span class="m">${m.replace(
            /(ONLINE|OK|FLAG-7731)\s*$/,
            (x) => `</span><span class="${status}">${x}</span>`
          )}</span>`;
    ln.innerHTML = `<span class="t">[ ${t} ]</span> ${body}`;
    logEl.appendChild(ln);
    logEl.scrollTop = logEl.scrollHeight;
    const pct = Math.round(((i + 1) / STEPS.length) * 100);
    fillEl.style.width = pct + '%';
    pctEl.textContent = pct + '%';
  }

  function runLog() {
    let i = 0;
    const tick = () => {
      if (done || i >= STEPS.length) {
        if (!done) setTimeout(finish, 480);
        return;
      }
      addLine(STEPS[i], i);
      i++;
      setTimeout(tick, 165 + Math.random() * 90);
    };
    tick();
  }

  // ── Dismiss ──────────────────────────────────────────────────
  function finish() {
    if (done) return;
    done = true;
    fillEl.style.width = '100%';
    pctEl.textContent = '100%';
    screen.classList.add('boot-done');
    document.body.classList.remove('is-booting');
    setTimeout(() => screen.remove(), 750);
    window.dispatchEvent(new CustomEvent('liveBreach:boot-complete'));
  }

  // Skip on interaction
  screen.addEventListener('click', finish);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') finish();
  });

  // Hard safety net: never trap the user behind the loader.
  setTimeout(finish, 8000);

  // Go
  scramble();
  setTimeout(runLog, 420);
})();
