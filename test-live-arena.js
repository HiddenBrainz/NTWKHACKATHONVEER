// Live end-to-end test: hit the running server's /api/evolve and verify the
// arena streams real events over SSE. Usage: PORT=3939 node test-live-arena.js
const BASE = `http://localhost:${process.env.PORT || 3939}`;
const seen = {};
let ledgerHead = null, verdict = null, jailbreaks = 0;

async function readStream() {
  const res = await fetch(`${BASE}/api/stream`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n'); buf = parts.pop();
    for (const part of parts) {
      const line = part.split('\n').find(l => l.startsWith('data: '));
      if (!line) continue;
      const ev = JSON.parse(line.slice(6));
      seen[ev.type] = (seen[ev.type] || 0) + 1;
      if (ev.type === 'ledger') ledgerHead = ev.head;
      if (ev.type === 'jailbreak_found') jailbreaks++;
      if (ev.type === 'arena_complete') verdict = ev.verdict;
    }
  }
}

(async () => {
  readStream().catch(() => {});
  await new Promise(r => setTimeout(r, 400));
  const r = await fetch(`${BASE}/api/evolve`, { method: 'POST' });
  console.log('POST /api/evolve ->', await r.json());
  await new Promise(r => setTimeout(r, 45000));
  console.log('\n--- arena SSE event counts ---');
  console.log(seen);
  console.log('jailbreaks:', jailbreaks, '· verdict:', verdict);
  console.log('ledger head:', ledgerHead?.slice(0, 24) + '...');
  const ok = seen.arena_started && seen.population_snapshot && seen.arms_race && seen.arena_complete;
  console.log(ok ? '\nLIVE TEST PASSED ✅' : '\nLIVE TEST FAILED ❌');
  process.exit(ok ? 0 : 1);
})();
