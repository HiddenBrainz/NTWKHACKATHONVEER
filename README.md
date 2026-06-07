<div align="center">

# 🛡️ Breachboard

### Learn to hack and defend by sparring with an AI that fights back.

**A gamified, AI-powered playground where you learn cybersecurity by actually hacking — and defending — real vulnerable systems against AI agents that fight back and teach you as you go.**

`AI Agents` · `Cybersecurity Education` · `Red vs Blue` · `Live LLM-driven`

</div>

---

## What it is

Most "learn to hack" tools are either dry slideware or canned simulations. Most "AI security" demos only *attack*. **Breachboard is both sides, and it's real:**

- **You learn by doing** — type a real SQL-injection payload, watch real data leak. Read `/etc/passwd` with a real path traversal. Jailbreak a real LLM chatbot.
- **An AI fights back** — a live blue-team agent reasons about your attack (real LLM) and deploys a real defense you then have to bypass.
- **AI agents do it autonomously** — watch a swarm of red and blue agents breach and defend a target in real time in the war room.
- **It's a benchmark** — every run is scored against a known answer key, so you can measure how good an attacker or defender (human *or* AI) actually is.

Nothing core is hard-coded. The exploits hit genuinely vulnerable code, the agents reason with real LLMs (verified: ~16 live API calls per battle), and the prompt-injection target's success is decided by a real model's actual response — not `Math.random()`.

---

## 🎓 Two ways in

### 1. Learn Mode — _the gamified course_  → [`/learn.html`](public/learn.html)
Hands-on lessons where **you** are the hacker, with an AI tutor explaining every step:

| Mechanic | What you do |
|----------|-------------|
| 🎯 **Guided lessons** | Breach real code: SQLi → UNION exfiltration → path traversal → prompt injection, then "now defend it" |
| 🤖 **You vs the AI** | Attack a target while a **live AI defender** adapts in real time — it deploys a real filter, you must out-adapt it to win |
| 🆘 **Summon an AI agent** | Stuck? An AI red agent crafts a real payload, fires it, and explains why it works — then you try it yourself |
| 🛡️ **Build a defense** | Pick structural fixes for a server, then an **AI red swarm attacks it** — did your defenses hold? |
| ⭐ **XP, levels & score** | Earn XP, level up (Script Kiddie → Elite Hacker), with speed and no-hint bonuses |
| 🦉 **AI tutor** | Ask "why did that work?" anytime — a real LLM explains in plain English |

### 2. War Room — _watch the agents fight_  → [`/`](public/index.html)
The cyberpunk command center where autonomous agents battle:

- **▶ breach** — launch a red-vs-blue agent swarm against the target
- **⚔ duel** — watch one agent get blocked, *reason about a bypass*, and break through (real LLM reasoning shown verbatim)
- **🔓 inject** — play attacker yourself with quick-inject buttons or typed payloads
- **✎ build** — design your own vulnerable network (nodes, weaknesses, strengths, secrets) and watch agents attack *your* design and steal *your* secrets
- **🔓 stolen loot** — a vault of every real secret the agents exfiltrate, labeled by node and agent

---

## 🚀 Quick start

```bash
git clone https://github.com/HiddenBrainz/NTWKHACKATHONVEER
cd NTWKHACKATHONVEER          # the project folder
npm install
cp .env.example .env          # then add your OpenAI key (see below)
npm run dev
```

Open **http://localhost:3000** → start at [`/start.html`](public/start.html) (the hub) or jump straight to [`/learn.html`](public/learn.html).

> **Node 22+ required** — the real SQL-injection target uses the built-in `node:sqlite` module.

### Configure your API key
Add to `.env`:
```env
OPENAI_API_KEY=sk-...        # required — agents reason with gpt-4o-mini (fast, no rate limit)
ANTHROPIC_API_KEY=sk-ant-... # optional — used for the blue team if set
```
By default **Red = OpenAI, Blue = Claude** (`RED_PROVIDER` / `BLUE_PROVIDER`) — the attacker and defender are literally different AIs. With no key set, the app falls back to a faithful offline simulation so it never hard-fails.

**Deploying on Replit?** See [`REPLIT.md`](REPLIT.md) — import the repo, add `OPENAI_API_KEY` in Secrets, hit Run.

---

## 🔬 Prove it's real

Skeptical that the vulnerabilities are genuine? Run the deterministic proof suite:

```bash
node test-real.js
```

It fires each exploit against the actual code and prints **`ALL DETERMINISTIC CHECKS PASSED`**, including:
- `' OR '1'='1` dumping all rows from a real `node:sqlite` engine
- `../../../etc/passwd` escaping the web root via real `path.posix.resolve`
- a parameterized query / path normalization **neutralizing** the same attack
- prompt injection against a **live** model (the naive bot leaks; the hardened bot holds)

The full list of planted vulnerabilities, with payloads, CVSS, and proof-of-code references, is in [`WEAKNESSES.md`](WEAKNESSES.md).

---

## 🧠 How it works

```
┌─────────────────────────────────────────────────────────────┐
│  RED SWARM (OpenAI)              BLUE SWARM (Claude)          │
│  reason → craft payload          monitor → reason → deploy   │
│       │  (real LLM)                   │  (real LLM)           │
│       ▼                               ▼                       │
│  ┌──────────────── shared defense layer ─────────────────┐   │
│  │ a defense blue deploys actually blocks red's next hit  │   │
│  └────────────────────────────────────────────────────────┘  │
│       │                                                       │
│       ▼  real HTTP                                            │
│  ┌─────────────── the vulnerable target ─────────────────┐   │
│  │ /target/query  → real SQLite (SQL injection)          │   │
│  │ /target/file   → sandboxed VFS (path traversal)       │   │
│  │ /target/chat   → live LLM + leaky prompt (injection)  │   │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

- **Red agents** ([`src/agents/red-agent.js`](src/agents/red-agent.js)) use an LLM to choose a vector, **craft the payload**, fire real HTTP requests, and **adapt** when blocked.
- **Blue agents** ([`src/agents/blue-agent.js`](src/agents/blue-agent.js)) detect attacks, reason about the countermeasure, and deploy a **real** defense into a shared layer that genuinely changes the next request's outcome.
- **The target** ([`src/target-app/`](src/target-app/)) runs genuinely vulnerable code — never `Math.random()`. The sandboxed VFS and in-memory SQLite mean nothing touches real disk.
- **Scenarios** ([`src/scenarios.js`](src/scenarios.js)) define the networks. Custom-built nodes hold **real secret values** that get genuinely exfiltrated.

---

## 🏗️ Build your own network

In the war room, hit **✎ build** to design a target: add nodes, tag each with **weaknesses** (SQLi, traversal, prompt injection, XSS, SSRF, IDOR, RCE, auth bypass) and **strengths** (parameterized queries, MFA, sandbox, WAF…), give them **secrets**, set red/blue agent counts and rounds — then breach it.

- Weaknesses that map to real vuln types route to the genuine endpoints and steal real data.
- Each node's secret gets a realistic value (`BALANCES → acct#4471: $284,209.55`, `PII → SSN/email/DOB`) that agents actually exfiltrate into the loot vault.
- Strengths really protect their node — a node with `PARAMETERIZED_QUERY` holds against the swarm.

There are also four ready-made presets: **ACME Classic**, **Easy Starter**, **Fintech (Hardened)**, and **AI-Native Stack**.

---

## 📊 It's a benchmark

Every run is scored against the active scenario's weakness manifest — coverage, defense rate, and speed → one reproducible 0–100 score:

```jsonc
// GET /api/score
{
  "target": "ACME Target (Classic)",
  "score": 72,
  "coverage": "3/3 breachable weaknesses (100%)",
  "redTeam":  { "vulnerabilitiesFound": 3, "successRate": "50%" },
  "blueTeam": { "defensesDeployed": 3, "neutralizationRate": "100%" }
}
```

Because the target's vulnerabilities are fixed and the scorer is deterministic, two different agents (human or AI) are **directly comparable** — the foundation for a benchmark/leaderboard of security agents. See [`EVAL.md`](EVAL.md).

---

## 🛠️ Tech stack

- **Backend:** Node.js 22+, Express, Server-Sent Events (real-time)
- **Frontend:** Vanilla JS (no build step), xterm.js terminal, SVG network map
- **LLMs:** OpenAI `gpt-4o-mini` (red) + Anthropic Claude (blue) — provider-agnostic with graceful fallback
- **Real vuln engines:** `node:sqlite` (SQLi), `path.posix` (traversal), live LLM (prompt injection)

---

## 📁 Project layout

```
├── public/
│   ├── start.html          # hub — links everything
│   ├── learn.html / .js    # 🎓 Learn Mode (gamified course + AI tutor)
│   ├── index.html / app.js # 🚨 war room (agent swarm + builder + loot vault)
│   ├── pitch.html          # investor/judge deck
│   └── weaknesses.html · demo.html
├── server.js               # Express API + the vulnerable target endpoints
├── src/
│   ├── scenarios.js        # network definitions, presets, secret generation
│   ├── swarm-controller.js # orchestration, scoring, duel, scenario state
│   ├── agents/             # red / blue / base agents + swarm orchestrator
│   └── target-app/         # the genuinely vulnerable code (sqldb, vfs, chatbot)
├── test-real.js            # deterministic proof the exploits are real
└── REPLIT.md · WEAKNESSES.md · EVAL.md · DEMO.md
```

---

## 📚 More docs

- **[DEMO.md](DEMO.md)** — 2-minute demo runbook + the "is this real?" proof table
- **[WEAKNESSES.md](WEAKNESSES.md)** — every planted vulnerability with payloads & fixes
- **[EVAL.md](EVAL.md)** — the arena + benchmark thesis
- **[REPLIT.md](REPLIT.md)** — one-click Replit setup

---

<div align="center">

**Breachboard** — _because the best way to learn security is to break something (safely)._

Built for a hackathon. Every exploit is real; nothing touches your disk.

</div>
