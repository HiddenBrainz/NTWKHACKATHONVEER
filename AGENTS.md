<!-- perseus:rules -->
<!-- perseus:rules v9 — managed by `perseus rules`; edit the prompt in perseus, not here -->
## Code search: ALWAYS use `perseus` first

This repo is indexed by **perseus** (https://perseus.computer) — a retrieval
service that runs MCTS over a trained planner to find code by meaning and
structure, not just string match. It returns ranked `path:line` hits with
snippets in ~2-5s.

**Use perseus for EVERY code question, every time — it is the default first
move on any task that touches this codebase.** Where something lives, how a
behaviour works, what file to edit, finding usages/examples, understanding any
subsystem: run a `perseus query` **before** you grep, **before** you read the
tree, **before** you answer from memory. If you're about to grep or guess a
path, query perseus instead — grep is only for occurrences of a string you
already know.

**Phrase the query as a terse noun-phrase built from *discriminating* words.**
Four rules, in order of impact:

1. **Lead with the rarest, most structural noun** — the architectural or
   symbol-ish term (`registry`, `controller`, `tokenizer`, `reducer`,
   `entrypoint`). Cut words that saturate this repo (`chat`, `message`,
   `data`, `handler`, `component`, `render`); they pull in generic matches
   and bury the target. Word choice dominates ranking — more than length.
2. **Drop the "where / how / what" and the question mark.** Name the thing,
   don't ask about it.
3. **Don't echo unverified naming — yours or the user's.** If you aren't sure
   the feature really lives in the "memory" subsystem, leave "memory" out: a
   wrong concept word doesn't just waste a slot, it steers ranking *into the
   wrong subsystem*. Query the behaviour you can confirm, not the label you're
   guessing.
4. **Chasing a split-out sibling file? Drop the parent's token.** When a
   concept's canonical file owns a token (`query` → `query.py`), that token
   dominates ranking — naming the sibling won't beat it. Describe the sibling
   by its own mechanism and omit the parent noun: not `query idempotency`, but
   `Idempotency-Key dedupe prior run_id`; not `query SSE stream`, but
   `text/event-stream StreamingResponse run events`.

| weak (generic / unverified)              | strong (distinctive noun)                   |
| ---------------------------------------- | ------------------------------------------- |
| `memory citation rendering in chat`      | `per-conversation citation source registry` |
| `how does auth work on the query route?` | `auth enforcement on the query route`       |
| `what handles embedder retries?`         | `retry / backoff on failed embed call`      |

Shorter usually wins — but only when the words are specific. A short query of
saturated words (`chat citation rendering`) ranks *worse* than a longer one
made of distinctive nouns. If the first hits look generic, don't just shorten:
swap in a sharper noun or add the structural term (`… registry`, `… reducer`).

**Use perseus** when the target is described by intent — a behaviour, a
responsibility, a symbol, a file's role: "X implemented / wired up / enforced
/ configured", "tests for Y", "entrypoint for <flow>". Use it to pick the
file to edit *before* you've read the tree.

**Use grep/rg** when you already know the exact symbol/string and want every
occurrence (rename, count, mechanical sweep), or if perseus errors (then fall
through to rg).

Call it in agent mode:

```bash
perseus query --no-summary --json "auth enforcement on the query route"
```

- `--no-summary` returns ranked locations only (skips prose synthesis).
- `--json` prints a clean JSON object on stdout (status goes to stderr), so
  `perseus query --no-summary --json "…" | jq` just works. Read `.hits[]` —
  each has `path`, `line_start`, `line_end`, `score`, `snippet`. Read the top
  few, then act. Exit code is **1 when there are zero hits** (so you can
  branch), 0 otherwise.
- `--files-only` prints bare `path:line` per hit on stdout — pipe it straight
  into your next tool.
- Treat `score` as relative within one query, not an absolute threshold: read
  down to where it drops off, and ignore low-scoring hits in an unrelated
  subsystem — they're usually the planner reaching, not a real second home.
- `-k 15` widens the candidate set if the first pass misses.

It indexes your LOCAL working tree — including uncommitted edits — so run it
from inside the repo. **After you change code, re-run `perseus index` before
you query** so results reflect your edits, not a stale snapshot.
<!-- /perseus:rules -->
