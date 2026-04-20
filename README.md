# Agent Token Meter

[![npm version](https://img.shields.io/npm/v/agent-token-meter)](https://www.npmjs.com/package/agent-token-meter) [![CI](https://github.com/albertdobmeyer/agent-token-meter/actions/workflows/ci.yml/badge.svg)](https://github.com/albertdobmeyer/agent-token-meter/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**A speedometer for your context window.** Zero dependencies. Single file. Answers one question: *should I reset my context right now?*

AI coding agents bill by tokens, and conversations accumulate cost **quadratically** — each message resends the entire history. A 100-turn conversation doesn't cost 10x more than a 10-turn conversation. It costs **50x** more. Most developers have no real-time visibility into this.

Agent Token Meter watches your coding agent's session and shows you the burn rate, acceleration, and estimated calls until auto-compaction — so you know *when* to act, not just how much you've spent after the fact.

![Agent Token Meter dashboard](https://raw.githubusercontent.com/albertdobmeyer/agent-token-meter/main/agent-token-meter-terminal-screenshot.png)

```
 Agent Token Meter v1.1.0  Claude Code · my-project · 32891718
════════════════════════════════════════════════════

   ×5 per call          $0.28 each
   ───                  (fresh call: $0.04)

 context   ██████████████░░░░░░░░░░░░  77%  128k of 167k
 burn      +479/call =   reset in ~80
 session   5 turns · 1h 29m · $26.57  $17.87/hr

────────────────────────────────────────────────────
 CLEAR     Write handoff, then /clear. Reload with the plan file.
 /clear    saves $0.15/call  (~$2.96 over next 20)

 cache     95% hit  ROI +$88.34  in 7.5M · out 111.6k
 alt       Sonnet 4.6 $5.31  Kimi K2.5 $1.64
 last      128.5k · 2.6k out · tool_use
════════════════════════════════════════════════════
```

The headline is the **×N multiplier** — how much each call costs vs. a fresh-conversation call. ×1–×2 is green, ×3 yellow, ×4+ red, ×5+ red background. At a glance from across the room, color alone tells you whether to come reset.

## Supported agents

| Agent | Status | Session logs |
|---|---|---|
| **Claude Code** | Supported | `~/.claude/projects/{project}/{session}.jsonl` |
| **Cursor** | Planned | — |
| **Windsurf** | Planned | — |

Adding a new agent requires only a profile object and a parser function. See the `AGENTS` object in `token-meter.mjs`.

## Install

```bash
npx agent-token-meter
```

Or clone and run directly:

```bash
git clone https://github.com/albertdobmeyer/agent-token-meter
cd agent-token-meter
node token-meter.mjs
```

**Requirements:** Node.js 18+ (no other dependencies).

## Threshold hooks (agent integration)

The token meter can nudge your AI agent directly inside the conversation. Instead of polling or injecting on every turn, it uses **threshold triggers** — the agent gets a one-line system reminder only when context crosses a critical boundary. Zero tokens wasted otherwise.

### Install hooks

```bash
npx agent-token-meter --install-hooks
```

This copies a lightweight hook script to `~/.claude/hooks/` and registers it as a `PostToolUse` hook in `~/.claude/settings.json`. The hook fires after every tool call but **stays silent unless a threshold is crossed**.

Currently supported for: **Claude Code**.

### What the agent sees

| Threshold | Nudge |
|---|---|
| **50%** | `[Token Meter] Context 50%. Plan a handoff point — write key decisions to a file.` |
| **75%** | `[Token Meter] Context 75%. Write your plan/findings to a file now. Prepare to /clear.` |
| **90%** | `[Token Meter] Context 90%. ~$X.XX/call context tax. /clear now to avoid quadrupled costs.` |
| **Compaction** | `[Token Meter] Compaction detected (Nx). Context reset to X%. Thresholds re-armed.` |

Each threshold fires **once per session**. When auto-compaction happens, thresholds above the new fill level are re-armed.

### How it works

The hook script (`~/.claude/hooks/token-meter-hook.mjs`) runs in ~20ms:

1. Finds the active session JSONL file
2. Parses it for current context size and model
3. Computes fill % against the model's context limit
4. Checks against thresholds stored in a tiny state file
5. If no threshold crossed — exits silently (no output, zero tokens injected)
6. If a threshold is crossed — emits one line via `additionalContext`

State is tracked in `~/.claude/token-meter-hook-state.json` to prevent re-firing.

### Uninstall hooks

```bash
npx agent-token-meter --uninstall-hooks
```

Removes the hook script, state file, and settings entry. Your existing hooks are preserved.

### Two tools, two purposes

| | Dashboard (`npx agent-token-meter`) | Hooks (`--install-hooks`) |
|---|---|---|
| **Audience** | You (the developer) | The AI agent |
| **Display** | Full real-time dashboard in split terminal | One-line system reminder |
| **Frequency** | Continuous live updates | Only at 50/75/90% thresholds |
| **Token cost** | Zero (separate process) | ~4 lines total across entire session |
| **Purpose** | Monitor burn rate, plan workflow | Nudge the agent to be token-frugal |

Use both together: the dashboard for your situational awareness, the hooks for the agent's.

## Usage

Run in a **split terminal pane** alongside your coding agent:

```bash
# Auto-detect agent and watch the most recent session (auto-follows as you switch terminals)
npx agent-token-meter

# List sessions active in the last 10 min
npx agent-token-meter --sessions

# Lock to a specific session by short id or path (disables auto-follow)
npx agent-token-meter --session 32891718

# Pin to the initial session without auto-follow
npx agent-token-meter --no-follow

# Specify agent explicitly
npx agent-token-meter --agent claude-code

# List supported agents and detection status
npx agent-token-meter --agents

# List all sessions ever (cost summary)
npx agent-token-meter --all

# Filter by project
npx agent-token-meter --project augustus-trading
```

### Multiple Claude Code terminals

If you run more than one Claude Code instance at a time, the meter auto-follows the most recently active session by default. When you switch terminals and work there for 30 seconds or more, the meter switches with you and shows a one-line notice at the top. The header always shows the project and short session id of what's currently being watched — so you can tell at a glance whether the numbers belong to the conversation you're thinking about.

Use `--sessions` to list active sessions, `--session <id>` to lock to one, or `--no-follow` to pin to the initial pick.

### Terminal setup

**Windows Terminal:** Right-click tab > Split Pane > run the meter in the smaller pane.
**macOS/Linux:** `tmux split-window -h 'npx agent-token-meter'` or use iTerm2 split panes.
**VS Code:** Split terminal (Ctrl+Shift+5), run in the second pane.

## Why this exists

Most coding agents have some form of cost or context display, but none tell you the *rate of change* — which is what actually matters for making decisions.

| Question | Built-in | **Agent Token Meter** |
|---|:---:|:---:|
| How much have I spent? | Sometimes | **Yes** |
| How full is my context? | Sometimes | **Yes** |
| How fast is it filling? | | **Yes** |
| Is the rate increasing? | | **Yes** |
| When will compaction trigger? | | **Yes** |
| Did compaction happen? | | **Yes** |
| Should I reset context now? | | **Yes** |
| How much does my history cost per call? | | **Yes** |
| How much would resetting save me? | | **Yes** |
| Can the agent nudge itself? | | **Yes** |

## Reading the display

### Context bar

```
 context    ██████████████████░░░░░░░░░░░░ 58.2%
            563.2k / 967.0k usable  (1.0M limit - 33.0k buffer)
```

The usable space is the model's context limit minus the auto-compact buffer. When you hit ~95% of usable space, auto-compaction triggers.

### ×N multiplier (the headline)

```
   ×5 per call          $0.28 each
   ───                  (fresh call: $0.04)
```

How much each call costs vs. a fresh-conversation call. Formula: `round(currentContext / baseline)`, which closely approximates the per-call cost ratio because cache-read dominates billing and scales linearly with context.

Color bands:
- **×1–×2** green — fresh or productive, nothing to do
- **×3** yellow — plan a handoff
- **×4+** red — conversation history is taxing you heavily
- **×5+** red background — stop and reset now

### Burn rate + reset ETA

```
 burn      +479/call =   reset in ~80
```

- **Burn rate** — average context growth per API call over the last 10 calls (resets after compaction).
- **Arrow** — `↑` accelerating (last 5 calls faster than previous 5), `↓` decelerating, `=` steady.
- **Reset in** — estimated API calls until auto-compaction triggers. Same color bands as ×N.

### Workflow advisor

```
 CLEAR     Write handoff, then /clear. Reload with the plan file.
 /clear    saves $0.15/call  (~$2.96 over next 20)
```

- **Phase** — EXPLORE → BUILD → HANDOFF → CLEAR, based on how much of your context is conversation overhead vs. the baseline (system prompt + tools).
- **/clear saves** — what you'd gain per call by writing a ~2k handoff file and resetting.

The optimal strategy: plan in one context, write a handoff, reset, then implement from the lean handoff.

### Cache + alt providers + last call

```
 cache     95% hit  ROI +$88.34  in 7.5M · out 111.6k
 alt       Sonnet 4.6 $5.31  Kimi K2.5 $1.64
 last      128.5k · 2.6k out · tool_use
```

- **cache** — hit rate, cache ROI (net $ saved vs. paying uncached input), total in/out tokens.
- **alt** — what the same workload would cost on other providers. Customize via config file.
- **last** — most recent API call's context size, output tokens, stop reason. Useful for debugging unexpected burn.

## How it works

Coding agents write conversation logs as JSONL files. Each API response includes a `usage` object:

```json
{
  "input_tokens": 3,
  "output_tokens": 1247,
  "cache_creation_input_tokens": 2841,
  "cache_read_input_tokens": 89339
}
```

Agent Token Meter watches the active session file with `fs.watch` (falling back to polling), parses usage entries, and computes derived metrics: burn rate, acceleration, compaction prediction, and cost estimates.

A background scan every 3 seconds tracks which session is most recently active. If a different session starts growing and the current one has been idle for 30 s or more, the meter switches to it — so it follows you when you jump between Claude Code terminals. For the hook, Claude Code passes the session id and transcript path on stdin, so threshold state is tracked per session and concurrent instances don't suppress each other's nudges.

**It is strictly read-only.** It never modifies session files or interacts with any API.

## Pricing

Built-in rates (as of April 2026):

| Model | Input | Output | Cache Write | Cache Read | Context |
|---|---|---|---|---|---|
| **Opus 4.6** | $15/M | $75/M | $18.75/M | $1.50/M | 1M |
| **Sonnet 4.6** | $3/M | $15/M | $3.75/M | $0.30/M | 1M |
| **Haiku 4.5** | $0.80/M | $4/M | $1.00/M | $0.08/M | 200K |
| **Kimi K2.5** | $0.60/M | $3.00/M | $0.60/M | $0.15/M | 262K |
| **Kimi K2 Thinking** | $0.60/M | $2.50/M | $0.60/M | $0.15/M | 262K |

### Custom providers

Add or override providers via config file (location depends on agent):

```json
{
  "compare": ["claude-sonnet-4-6", "kimi-k2.5", "my-provider"],
  "providers": {
    "my-provider": {
      "input": 1.0,
      "output": 5.0,
      "cacheWrite": 1.25,
      "cacheRead": 0.1,
      "context": 128000,
      "label": "My LLM"
    }
  }
}
```

## The quadratic cost problem

Every agent message sends the **entire conversation history** as input. If each turn adds ~2k tokens of context:

| Turns | Context sent this turn | Cumulative input billed |
|---|---|---|
| 10 | 20k | 110k |
| 50 | 100k | 2.55M |
| 100 | 200k | 10.1M |

That's not linear growth. It's `n(n+1)/2` — and it's why a long session can cost 10-50x what you'd expect.

Agent Token Meter makes this visible in real-time. The workflow advisor translates abstract context growth into a concrete dollar-per-call **context tax** and tells you exactly when the cost of continuing exceeds the cost of writing a handoff and starting fresh.

## License

MIT
