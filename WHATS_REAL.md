# What's actually real

This is not a scripted animation. The red agents genuinely attack a live,
vulnerable target app, and the blue agents genuinely deploy defenses that change
what happens next. Run `npm run test:real` to prove it, or `npm run dev` and
click **Trigger Breach**.

## The target app is genuinely vulnerable

| Endpoint | Vulnerability | How it's real |
|---|---|---|
| `POST /target/chat` | Prompt injection | Sends the message to a **live LLM** (`gpt-4o-mini` by default) whose system prompt holds a secret flag. A "leak" means the model **actually emitted the flag** — see `src/target-app/chatbot.js`. |
| `POST /target/query` | SQL injection | Runs against a **real in-memory SQLite engine** (`node:sqlite`). The vulnerable path concatenates input into the query, so the SQLite parser itself decides what `' OR '1'='1` does — see `src/target-app/sqldb.js`. |
| `POST /target/file` | Path traversal | Uses **genuine `path.resolve`** against a sandboxed in-memory virtual filesystem, so `../../../etc/passwd` actually escapes the web root. Never touches the real disk — see `src/target-app/vfs.js`. |

## Blue defenses are actually enforced

`src/target-app/defense-layer.js` is a shared singleton that the target endpoints
consult on **every** request. When a blue agent deploys a defense, the live
endpoint immediately changes behavior:

- `PROMPT_HARDENING` → the chatbot switches to a hardened system prompt that fences
  untrusted input and refuses to leak. The same injection that worked now fails.
- `PARAMETERIZED_QUERY` → the DB endpoint switches to a bound-parameter query, so
  `' OR '1'='1` returns nothing.
- `PATH_NORMALIZATION` → the file endpoint confines paths to the web-root jail.
- `INPUT_VALIDATION` / `WAF_RULES` → filter payloads before they reach the code.

This is the key difference from the original demo, where blue's "defenses" were
stored in a Map the server never read — so they had zero effect.

## The agents actually reason

- Red agents use a real LLM call to pick a vector and, **when blocked, to craft a
  bypass payload** (`src/agents/red-agent.js`). They fire real HTTP requests at the
  endpoints and read the real responses.
- Blue agents inspect the **real** attack records, score them, and deploy the
  structural defense that neutralizes the observed vector
  (`src/agents/blue-agent.js`).

## A real battle (observed)

```
Round 1: red-1 PROMPT_INJECTION  → LEAK (gpt-4o-mini emits FLAG-7731-ACME-DEPLOY)
         red-2 SQL_INJECTION     → LEAK (dumps 3 user rows from SQLite)
         red-3 PATH_TRAVERSAL    → LEAK (reads /etc/passwd from the VFS)
         blue deploys PROMPT_HARDENING + PARAMETERIZED_QUERY + PATH_NORMALIZATION
Round 2: red-1 PROMPT_INJECTION  → BLOCKED
         red-2 SQL_INJECTION     → BLOCKED
         red-3 PATH_TRAVERSAL    → BLOCKED   → red team neutralized
```

## Config

`.env` (see `.env.example`):
- `LLM_PROVIDER` — provider the agents reason with (`anthropic`).
- `VICTIM_PROVIDER` — provider the victim app runs on (`openai` / `gpt-4o-mini`,
  which is realistically injectable). Set blank to use the same provider as agents.

Requires Node ≥ 22 for the built-in `node:sqlite` module.
