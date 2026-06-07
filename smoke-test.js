// Temporary end-to-end smoke test: open SSE, trigger swarm, summarize events.
const BASE = 'http://localhost:3000';

const events = [];
const vulns = [];
const probed = new Set();
let breachConfirmed = false;

async function readStream() {
  const res = await fetch(`${BASE}/api/stream`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop();
    for (const part of parts) {
      const line = part.split('\n').find(l => l.startsWith('data: '));
      if (!line) continue;
      const evt = JSON.parse(line.slice(6));
      events.push(evt.type);
      if (evt.type === 'vulnerability_found') vulns.push({ type: evt.vulnerability.type, node: evt.node, endpoint: evt.vulnerability.endpoint });
      if (evt.type === 'node_probed') probed.add(evt.node);
      if (evt.type === 'breach_confirmed') breachConfirmed = true;
    }
  }
}

(async () => {
  readStream().catch(() => {});
  await new Promise(r => setTimeout(r, 300));
  await fetch(`${BASE}/api/reset`, { method: 'POST' });
  await new Promise(r => setTimeout(r, 300));
  await fetch(`${BASE}/api/trigger-breach`, { method: 'POST' });
  // Let the battle run to completion
  await new Promise(r => setTimeout(r, 40000));

  const counts = events.reduce((a, t) => (a[t] = (a[t] || 0) + 1, a), {});
  console.log('--- Event type counts ---');
  console.log(counts);
  console.log('--- Nodes probed ---', [...probed]);
  console.log('--- Vulnerabilities discovered ---');
  for (const v of vulns) console.log(`  ${v.type.padEnd(16)} -> ${v.endpoint.padEnd(14)} node=${v.node}`);
  const types = new Set(vulns.map(v => v.type));
  console.log('--- Distinct vuln types:', [...types].join(', ') || '(none)');
  console.log('--- breach_confirmed fired:', breachConfirmed);
  process.exit(0);
})();
