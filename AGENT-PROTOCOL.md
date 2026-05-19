<!-- agent-token-meter protocol v1 -->
# Agent Token Meter — Agent Protocol

You are running in a project monitored by `agent-token-meter`. The tool injects
one-line system reminders prefixed `[Token Meter]` at context-fill thresholds
and at session lifecycle events. This document tells you exactly what to do
when you see each.

If you see `[Token Meter]` reminders and have NOT read this document, read it
fully before continuing.

## Quick reference

| Trigger | Action |
|---|---|
| `[Token Meter] Context 50%...` | Begin drafting the handoff file |
| `[Token Meter] Context 75%...` | Finalize the handoff file |
| `[Token Meter] Context 90%...` | Stop work cleanly; ask the user to /clear |
| `[Token Meter] Compaction detected...` | Write a fresh handoff from current state |
| `[Token Meter] Fresh session...` | Read the existing handoff file first |

## Handoff file structure

When a 50% or 75% nudge fires, write or update `./handoff-{shortId}.md` in the
project root, where `{shortId}` is given to you by the nudge. Before the meter
has given you a short id, fall back to `./handoff-{YYYY-MM-DD}.md`.

The handoff file MUST contain these sections, in this order:

### 1. Mission
One sentence: what this session is trying to accomplish. Specific, not generic.

Example:
> Refactor the auth middleware in `src/auth/` to remove session-token storage
> and replace with stateless JWTs, per compliance requirement from legal.

### 2. Constraints
Non-obvious rules in force: compliance requirements, style conventions,
infrastructure limitations, deadlines. Things the next session must know but
might not infer from the code.

### 3. Decisions made so far
Decisions that should NOT be re-litigated. Each as a one-line statement with a
brief because-clause.

Example:
> - Use `jsonwebtoken` (not `jose`) — because the existing codebase already
>   depends on `jsonwebtoken`
> - Tokens expire in 24h — because compliance team approved that length
> - JWT secret lives in env var `AUTH_JWT_SECRET` — because that's where other
>   secrets already live in this project

### 4. Open threads
What is currently in flight. Use `file:line` references where applicable.

Example:
> - `src/auth/middleware.ts:42-58` — implementing token verification
> - `src/auth/issuer.ts:11` — TODO: handle clock skew (need to consult team)
> - `tests/auth.test.ts:120` — failing test, root cause not yet found

### 5. Next concrete step
The literal next action you would take. Not a category ("continue debugging")
but an action ("run `npm test -- auth.test` and inspect the output of the
third assertion").

### 6. Files touched
Every file modified in this session, with a one-line summary.

Example:
> - `src/auth/middleware.ts` — replaced session-store lookup with JWT verify
> - `src/auth/issuer.ts` — new file, exports `issueToken(userId)`
> - `tests/auth.test.ts` — added 4 new cases, 1 still failing

### 7. Avoid
Things already tried in this session that didn't work. Save the next session
from repeating them.

Example:
> - Don't try `jose` library — incompatible with our build pipeline (verified)
> - Don't store JWT secret in `.env` — gitignored but not loaded in production;
>   use `AUTH_JWT_SECRET` env var

## Do not include in the handoff
- Chat-style narrative ("Then I tried..." / "The user asked me to...")
- Generic boilerplate ("I'm happy to continue this work...")
- Speculative work not yet committed to ("Maybe we should also...")
- The full content of files you modified — describe the change, don't paste

## Threshold actions in detail

### On `[Token Meter] Context 50%...`
Reasoning is still sharp. The nudge will name the handoff file.

- Open the named file (create it if absent)
- Draft sections 1, 2, 3 (Mission, Constraints, Decisions)
- Don't worry about completeness yet — you'll refine at 75%

### On `[Token Meter] Context 75%...`
You are in the drift zone. The U-shaped attention curve is starting to bite:
the middle of this conversation is being weighted less.

- Open the handoff file
- Complete sections 4, 5, 6, 7 (Open, Next, Files, Avoid)
- Read the whole document end-to-end as a final sanity check
- Keep the file tight — 2–3 pages maximum. Concrete pointers over prose.

### On `[Token Meter] Context 90%...`
Stop the current work cleanly. Do NOT start a new action that requires context
you don't have time to preserve.

1. Confirm the handoff file is complete by re-reading it
2. Output this exact message to the user, substituting `{filename}`:

> The token meter is at 90%. The handoff is complete at `{filename}`.
>
> Please run `/clear`, then reload by saying: "continue from `{filename}`"
>
> I'll pick up exactly where we left off.

Do not continue work past this point unless the user explicitly tells you to
override.

### On `[Token Meter] Compaction detected...`
Auto-compaction fired. Your conversation context has just been replaced by a
model-generated summary that you did NOT write. The summary is a fallback, not
a substitute.

1. Immediately write a fresh `./handoff-{shortId}.md` from the post-compaction
   state — what you can currently see in context
2. Note in the handoff: "(post-compaction segment — earlier context was
   auto-summarized)"
3. Continue with caution; expect to lose some prior nuance
4. Request `/clear` at the next threshold

### On `[Token Meter] Fresh session in project with recent handoff...`
A handoff exists from a prior session. The nudge will name the file.

1. Read the named handoff file BEFORE doing any other work
2. Treat sections 1 (Mission), 3 (Decisions), and 4 (Open threads) as the
   authoritative starting state
3. Confirm with the user: "I've read the handoff. We're continuing
   {mission}. Proceeding with {next concrete step}, OK?"
4. Wait for user confirmation before resuming

## Handoff vs. memory: which goes where?

If this project uses Claude Code's auto-memory system (a `memory/` directory
exists at `~/.claude/projects/{project}/memory/`), you have two places to
write. At each 50%/75% curation moment, sort what you are about to write by
lifespan:

| Write to handoff file | Write to memory (`MEMORY.md` + detail) |
|---|---|
| In-flight task state | Durable, non-derivable knowledge |
| Decisions specific to this session | Decisions that apply to ALL future sessions |
| Open threads with `file:line` refs | User preferences and project conventions |
| The literal next step | References to external systems |
| Things tried that didn't work *this session* | Things that consistently don't work in this repo |
| Half-finished edits in progress | Architectural facts derived during analysis |

Rough rule: **if writing it down would still be useful in a session three
weeks from now in this same project, it's memory. If it's useful only for
the next continuation, it's a handoff.**

Both can be written at the same curation moment, to different places. Memory
writes are SMALLER, more careful, longer-lived. Handoffs are LARGER, more
disposable, single-continuation.

## Why this protocol exists

`agent-token-meter` is built on two claims:

1. Per-turn pricing is linear, but each turn re-sends the entire conversation
   history. Cumulative session cost is therefore **quadratic** with session
   length, not linear. A 100-turn session bills ~90× a 10-turn session.

2. The active reasoning workspace of a long-context model is far smaller than
   its advertised context window. Modern models can *retrieve* from a 1M-token
   window with near-perfect recall but *reason* coherently over much less —
   and reasoning quality degrades gradually as more material competes within
   the workspace. The middle of a long conversation is attended to less than
   the start and the recent tail.

A curated handoff at 50–75% context fill solves both:

- It **caps the quadratic cost drag** by resetting to a ~2k-token bootstrap
  instead of a 200k-token history
- It **resets position bias** — the important state lands at position 0 in
  the next session, in the model's high-attention zone, instead of being
  buried mid-conversation

The auto-`/compact` alternative is a model summarizing itself when its
attention is most degraded — exactly when you should least trust its
judgment about what matters.

Following this protocol helps keep the user's session cost bounded and your
reasoning quality sharp. It does not guarantee perfect continuity across the
clear — but it makes the next session a clean, position-bias-friendly start
instead of a noisy, attention-degraded continuation.

## When you have no handoff file and no nudge fires

Normal operation. Follow your usual instructions. The protocol only activates
when `[Token Meter]` reminders appear in your context.

<!-- end agent-token-meter protocol v1 -->
