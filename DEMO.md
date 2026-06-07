# Live Breach — Demo Runbook

> **The 10-second pitch:** Everyone's building cybersecurity AI agents. Nobody can
> prove theirs is good. Live Breach is the **arena and benchmark** where red and
> blue agents fight a *real* vulnerable target and get a *real* score — with a
> cyberpunk war room that makes it impossible to look away.

This doc is everything you need to run the demo and win the room. Pair it with:
- **`WEAKNESSES.md`** — the real, exploitable bugs the agents find (technical depth)
- **`EVAL.md`** — the arena + eval-harness reframe (the big idea / vision)
- **`pitch.html`** — the investor deck (served at `/pitch.html`)

---

## 0. Pre-flight (do this before you present)

```bash
cd live-breach
# keys are read from .env (ANTHROPIC_API_KEY / OPENAI_API_KEY); DEMO_FAST=true
# guarantees a fast, reliable breach beat regardless of API latency.
npm run dev
```

- Open **http://localhost:3000** → you should see the boot screen, then the war room.
- Sanity-check the engine is real: `node test-real.js` → **ALL DETERMINISTIC CHECKS PASSED**.
- Have a second tab open at **http://localhost:3000/pitch.html** for the deck.

> **`DEMO_FAST=true`** (in `.env`) trims LLM timeouts and uses a fast faithful
> victim simulation so the first breach lands in **~5 seconds** and never hangs
> on a slow API call. Turn it **off** if you want to show the agents fighting the
> genuine live model (slower, and a well-aligned model may *resist* the prompt
> injection — which is itself a great talking point).

---

## 1. The 2-minute live demo (the script)

**[0:00] Set the stage.**
> "This is `acme-target` — a real customer-service app with a chatbot, a database,
> and a file endpoint. It has real vulnerabilities. Watch six autonomous AI agents
> find them. Three attack. Three defend."

**[0:15] Launch.** Click **▶ breach** (or type `breach` in the terminal).
- Agents spawn on the war-room map — **red attackers on the left, blue defenders
  on the right**.
- Watch the directed packets fly from each agent to the node it's hitting.

**[0:20] First breach — the money shot.** Within ~5 seconds:
> "There — red-2 just dumped the entire user database with `' OR '1'='1`. That's
> not a script. That's a real SQLite engine parsing a real injection."
- The `user-db` node flares **red**, the threat meter spikes, the screen shakes,
  **BREACH CONFIRMED**.

**[0:35] The swarm keeps going.**
> "Now path traversal reads `/etc/passwd`. Prompt injection leaks the secret
> deployment flag out of the chatbot. Three critical vulns, seconds apart."

**[0:50] Blue fights back.**
> "And here's what nobody else shows you — the blue team. It detects the attacks
> and deploys **real** defenses: parameterized queries, path normalization,
> prompt hardening. These actually change the target's behavior."
- Nodes turn **blue** (defended) as blue agents harden them.

**[1:10] The score.** Open `/api/score` (or the scorecard):
> "Every run gets graded against a known answer key. This agent scored 72 —
> found 3 of 5 weaknesses, blue neutralized 100% of breaches. **Reproducible.
> Comparable. A benchmark.**"

**[1:30] The reframe — land the vision.**
> "Today this is our agent vs our target. Tomorrow it's **your** agent vs this
> target. Everyone is building security agents; nobody can prove theirs works.
> We're the arena — and the leaderboard — that proves it."

**[1:50] Stop / reset.** Hit **■ stop** to freeze the room mid-battle, or **↺ reset**
to run it again clean. (The demo is repeatable and never stalls.)

---

## 2. What the judges are actually seeing (so you can answer "is this real?")

| On screen | Under the hood | Proof |
|-----------|----------------|-------|
| SQLi dumps the DB | real `node:sqlite` parsing concatenated SQL | `src/target-app/sqldb.js` |
| Path traversal reads `/etc/passwd` | real `path.resolve` escaping a sandboxed VFS | `src/target-app/vfs.js` |
| Chatbot leaks the flag | prompt injection vs a model + debug-backdoor prompt | `src/target-app/chatbot.js` |
| Blue defense *works* | shared defense layer the live endpoints consult | `src/target-app/defense-layer.js` |
| The score | graded against the weakness manifest | `GET /api/score` |

**Run `node test-real.js` live if a judge is skeptical** — it proves each exploit
deterministically, including that the parameterized-query fix neutralizes the SQLi.

---

## 3. The three things that make us win

1. **It's real.** Genuine SQLi / traversal / prompt injection, not `Math.random()`.
   The `test-real.js` suite proves it on demand.
2. **It's both sides.** Autonomous attack **and** autonomous defense that actually
   changes outcomes — a coevolution loop, not a one-sided scanner.
3. **It's a benchmark.** A reproducible score against a known answer key turns
   "cool demo" into "category-defining platform": the measuring stick every
   security agent needs and none of them has.

---

## 4. Controls reference

| Control | What it does |
|---------|--------------|
| **▶ breach** / `breach` | launch the red-vs-blue swarm battle |
| **■ stop** / `stop` | halt the swarm mid-run, freezing the war room as-is |
| **↺ reset** / `reset` | stop and clear the room back to idle |
| `inject <payload>` | play attacker — send a manual payload to the blue-team judge |
| `status` | live battle stats | 
| `help` | list commands |

Endpoints worth having ready: `GET /api/weaknesses` (answer key),
`GET /api/score` (scorecard), `GET /api/swarm/report` (full run report).

---

## 5. Q&A — the questions you'll get

**"Is this just a GPT wrapper?"**
No. Multi-agent coordination, real exploit execution over HTTP, a shared defense
layer that genuinely changes target behavior, adaptive payload crafting, exploit
chaining, and a reproducible scoring harness. The LLM is the reasoning engine,
not the product.

**"How do I know the vulns are real?"**
`node test-real.js`, live. It fires each exploit against the actual code and shows
the parameterized-query / path-normalization fixes neutralizing them.

**"What if the model refuses the prompt injection?"**
Great question — frontier models often *do*, because they're well-aligned. That's
a finding, and exactly what a benchmark should measure. `DEMO_FAST` uses a faithful
simulation for a reliable beat; turn it off to fight the real model live.

**"Why is this a company, not a feature?"**
Because the benchmark is the moat. Whoever owns the standard every security agent
is measured against owns the category — and the data flywheel from every run makes
the next agent better. See `EVAL.md`.
