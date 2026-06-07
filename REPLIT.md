# Running Live Breach on Replit

Live Breach runs on Replit out of the box. Here's the 60-second setup.

## 1. Import the repo
Create a new Repl → **Import from GitHub** →
`https://github.com/HiddenBrainz/NTWKHACKATHONVEER`

The included `.replit` and `replit.nix` pin **Node 22** (required — the real
SQL-injection target uses the built-in `node:sqlite` module).

## 2. Add your API key (Secrets panel 🔒)
Open the **Secrets** tab (lock icon) and add:

| Key | Value |
|-----|-------|
| `OPENAI_API_KEY` | your OpenAI key (`sk-...`) |

That's the only one you need. OpenAI is used because it's fast and not
rate-limited — the agents reason with `gpt-4o-mini`, and the victim chatbot runs
on it too (so prompt injection is genuinely testable).

> Optional: add `ANTHROPIC_API_KEY` if you'd rather use Claude — but note Claude
> Haiku's default rate limit (5 req/min) is too low for the swarm; OpenAI is
> recommended for the live demo.

The `.replit` file already sets `LLM_PROVIDER=openai`, `VICTIM_PROVIDER=openai`,
and `DEMO_FAST=false` so you see real agent reasoning.

## 3. Press ▶ Run
Replit runs `npm install && npm run dev`. When it's up, open the webview:

- **`/`** — the war room (run a breach, a ⚔ duel, or `inject` payloads yourself)
- **`/start.html`** — the hub (links to everything)
- **`/learn.html`** — Learn Mode (hands-on lessons + AI tutor)
- **`/pitch.html`** — the pitch deck

## 4. Prove it's real
In the Repl shell: `node test-real.js` → runs the genuine exploits and prints
`ALL DETERMINISTIC CHECKS PASSED`.

## Notes
- The server binds `0.0.0.0` and reads `PORT` from the environment, so Replit's
  proxy reaches it automatically (port 3000 → external 80).
- No database to provision — the SQL target is an in-memory SQLite, and the file
  target is a sandboxed virtual filesystem. Nothing touches real disk.
- With no API key set, the app still runs in a faithful offline simulation mode
  (the breach still lands), so the demo never hard-fails.
