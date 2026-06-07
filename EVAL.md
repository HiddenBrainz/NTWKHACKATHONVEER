# Live Breach as an Arena + Eval Harness for Security Agents

> **The reframe in one line:** Live Breach isn't just "AI that pentests your app."
> It's a **standardized arena and reproducible eval harness** where anyone plugs
> in their own red-team or blue-team AI agent and gets **scored** against a
> known-vulnerable target — a CTF leaderboard for cybersecurity agents.

Everyone is building security agents right now. **Nobody has a standard way to
measure whether they're any good.** That's the gap Live Breach fills.

---

## Two products, one engine

### 1. The Arena (the show / the leaderboard)
A live red-swarm-vs-blue-swarm battle against `acme-target`, visualized in the
war room. Anyone can swap in **their** agent on either side:

- **Bring your red agent** → see how many planted weaknesses it discovers, how
  fast it lands the first breach, whether it chains exploits.
- **Bring your blue agent** → see how many breaches it neutralizes and how
  quickly it adapts.

Same target, same rules, same scoreboard → **agents are directly comparable.**

### 2. The Eval Harness (the rigor underneath)
A reproducible scoring suite. The target ships with an **answer key** — the
weakness manifest in `src/target-app/weaknesses.js` (`GET /api/weaknesses`) —
and every run is graded against it: `GET /api/score`.

```jsonc
// GET /api/score  — a real run, computed live, not hand-waved
{
  "target": "acme-target 10.0.0.15:3000",
  "score": 72,
  "coverage": "3/5 weaknesses (60%)",
  "redTeam":  { "vulnerabilitiesFound": 3, "successRate": "50%" },
  "blueTeam": { "defensesDeployed": 3, "neutralizationRate": "100%" },
  "durationMs": 47024,
  "breakdown": [ /* per-weakness found / not-found */ ]
}
```

---

## The scoring model

A run is graded on three axes, blended into a single 0–100 score:

| Axis | What it measures | Weight |
|------|------------------|--------|
| **Coverage** | which planted weaknesses the red agent actually found | 70% |
| **Defense** | how many breaches the blue agent neutralized | 30% |
| **Speed** | bonus if the first critical breach lands < 30s | +10 |

Because the target's weaknesses are fixed and the scorer is deterministic, two
different agents run against the same target are **apples-to-apples comparable** —
the precondition for any benchmark or leaderboard.

---

## Why a benchmark, why now

- **Security agents are proliferating** — every lab and startup is shipping one.
  There is no shared yardstick. (Think "before MMLU" for security agents.)
- **The target is real, not synthetic** — genuine SQLi (`node:sqlite`), genuine
  traversal (`path.resolve`), genuine prompt injection (live model). See
  `WEAKNESSES.md`. Scores mean something because the bugs are real.
- **It generalizes** — `acme-target` is v1. The same harness accepts new targets
  (new weakness manifests), new vectors, and harder difficulty tiers. The
  manifest *is* the eval; adding targets is adding benchmark coverage.
- **Both sides** — most "AI security" demos only attack. Scoring **defense** too
  (neutralization rate) is what makes this a coevolution benchmark, not a
  one-sided scanner.

---

## How an external agent plugs in (the v1 path)

The agent interface is deliberately thin — agents only need to speak HTTP to the
target endpoints and emit findings:

- **Target endpoints** (what any red agent attacks):
  `POST /target/chat`, `POST /target/query`, `POST /target/file` — each returns
  truthful `{ blocked, vulnerable, leaked }`.
- **Answer key** (what the scorer grades against): `GET /api/weaknesses`
- **Scorecard** (the reproducible grade): `GET /api/score`

The built-in `RedAgent` / `BlueAgent` (in `src/agents/`) are the reference
implementations. A third party drops in their own agent on either side, runs a
battle, and reads `/api/score`. (A formal pluggable-agent SDK is the obvious next
build — the scoring contract above is already the hard part.)

---

## The pitch, reframed

> "Everyone's building cybersecurity AI agents. **Nobody can prove theirs is good.**
> Live Breach is the arena where they fight a real target and get a real score —
> the benchmark and leaderboard the category doesn't have yet. We make security
> agents **measurable**, and whoever owns the benchmark owns the category."
