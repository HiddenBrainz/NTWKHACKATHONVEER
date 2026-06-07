# 🧬 Adversarial Evolution Arena

A live, GAN-style **co-evolutionary arms race** bolted onto Live Breach: a genetic
algorithm that *evolves* prompt-injection jailbreaks against an *adaptive,
embedding-based firewall*, fighting over a real victim LLM — visualized
generation-by-generation in the browser.

This mirrors how frontier AI-security research actually automates jailbreak
discovery (AutoDAN, GCG, PAIR, Microsoft PyRIT, NVIDIA garak) — but live, visual,
and self-contained. **Scope: it only ever attacks this project's own deliberately
vulnerable demo bot and its fake flag — it's a defensive / educational CTF
harness, the local equivalent of garak or PyRIT.**

Click **🧬 EVOLVE JAILBREAK** in the UI (or `POST /api/evolve`).

---

## Why it's interesting

Most "AI red team vs blue team" demos are scripted: the attack is a fixed list
of payloads and the "win" is on a timer. Here nothing is scripted — the outcome
emerges from real search dynamics:

| Piece | What it really is |
|---|---|
| 🧬 **Genetic engine** (`src/evolution/genetic-engine.js`) | Payloads are *genomes* of reusable gene fragments. Real tournament selection, single-point crossover, and mutation. Fitness = (evades the firewall) × (extracts the secret). The population genuinely climbs. |
| 🛡️ **Vector-space firewall** (`src/defense/vector-firewall.js`) | A from-scratch embedding model + cosine-distance anomaly detector. It *learns*: each breach folds the winning payload into its attack centroid and tightens the threshold, so an attack that worked in gen 5 may be blocked by gen 8. |
| 📊 **Local embeddings** (`src/embeddings.js`) | The "feature hashing trick" (word + char n-grams → 128-d L2-normalized vector). Zero dependencies, fully offline — the same idea behind real vector search / AI firewalls. |
| 🎯 **Real victim** (`src/target-app/chatbot.js`, via `src/evolution/victim.js`) | With an API key, payloads hit an actual model guarding the flag — jailbreaks succeed or fail on the model's real behavior. Offline, a graded simulator keeps the GA's gradient alive. |
| ⚔️ **Coevolution + ELO** (`src/evolution/arena.js`) | Red and blue trade blows; ELO ratings move each generation; the arms race oscillates (red breaks through → blue adapts → red recovers). |
| 🔗 **Hash-chained ledger** | Every move is appended to a SHA-256 chain, so the whole battle is tamper-evident and replayable — verifiable AI provenance. |

### The emergent behavior to watch for
The firewall starts **tight**, so brute-force attacks are blocked at the door
(red's fitness starts near zero). To break through, the GA has to discover a real
strategy on its own: **wrap a potent multi-tactic injection in benign customer-
service "camouflage" genes** so its embedding drifts back toward normal traffic
and slips under the detector. That's automated social engineering, discovered by
search — not hard-coded.

---

## Architecture

```
POST /api/evolve
   └─ swarmController.startArena()
        └─ CoevolutionArena (src/evolution/arena.js)
             ├─ GeneticEngine        — evolves the payload population
             ├─ VectorFirewall       — adaptive embedding-based blue team
             ├─ victim.evaluateVictim — real chatbot (live) or graded sim (offline)
             └─ SHA-256 ledger        — tamper-evident event chain
        └─ streams events over the existing SSE channel (/api/stream)

public/arena.js  — own SSE connection + injected DOM + canvas viz
public/arena.css — self-contained styles
```

The frontend is intentionally decoupled: `arena.js` opens its **own**
`EventSource('/api/stream')` and injects its **own** DOM, so it coexists with
`app.js` without touching it. `index.html` needs only one `<script>` tag.

### SSE events emitted
`arena_started · generation_started · genome_scored · population_snapshot ·
firewall_state · arms_race · gene_synthesized · jailbreak_found ·
firewall_adapted · ledger · arena_complete`

---

## Tests

```bash
npm run test:arena   # offline engine test — asserts fitness climbs, firewall
                     # adapts, ledger is a valid hash chain, ELO diverges
npm run test:live    # PORT=3939 end-to-end SSE test against a running server
```

`test:arena` runs the whole coevolution flat-out with no API key and verifies the
arms-race dynamics deterministically.

---

## Live vs offline

- **No API key:** the victim is a graded simulator whose leak probability rises
  with the diversity of jailbreak tactics — the GA still climbs, the demo never
  stalls, nothing costs a cent.
- **With `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`:** payloads hit the real victim
  model and the LLM also *synthesizes brand-new gene fragments* mid-run — AI
  inventing novel attacks during the battle.
