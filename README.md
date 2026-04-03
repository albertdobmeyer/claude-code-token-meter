# Agent Token Meter

**A speedometer for your context window.** Zero dependencies. Single file. Answers one question: *should I reset my context right now?*

AI coding agents bill by tokens, and conversations accumulate cost **quadratically** — each message resends the entire history. A 100-turn conversation doesn't cost 10x more than a 10-turn conversation. It costs **50x** more. Most developers have no real-time visibility into this.

Agent Token Meter watches your coding agent's session and shows you the burn rate, acceleration, and estimated calls until auto-compaction — so you know *when* to act, not just how much you've spent after the fact.

```
 Agent Token Meter v1.0.0  (Claude Code)
────────────────────────────────────────────────────

 model      claude-opus-4-6
 session    12 user turns  (37 API calls)  1h 24m

 context    ██████░░░░░░░░░░░░░░░░░░░░░░░░ 18.2%
            176.3k / 967.0k usable  (1.0M limit - 33.0k buffer)

 burn       +2.1k/call  accelerating
 compact    ~376 calls

 tokens     in: 3.8M   out: 42.1k
            cache hit: 3.6M (96%)  write: 142.3k  uncached: 42
            cache ROI: +$48.07 net savings (write: $5.50, saved: $53.57)

 cost       $7.83 total   ~$0.21/call   ~$5.58/hr
            Sonnet 4.6: $1.57  Kimi K2.5: $0.49

────────────────────────────────────────────────────

 workflow   BUILD  Productive zone. Context is earning its keep.

 overhead   159.5k of history  (baseline: 16.8k)
 ctx tax    $0.24/call for carrying conversation history
 /clear     saves $0.24/call  (~$4.72 over next 20 calls with handoff)
 projection ~$86.72 total by compaction (376 more calls)

────────────────────────────────────────────────────
 last call  ctx: 176.3k  out: 1.2k  end_turn
────────────────────────────────────────────────────
```

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
# Auto-detect agent and watch the most recent session
npx agent-token-meter

# Specify agent explicitly
npx agent-token-meter --agent claude-code

# List supported agents and detection status
npx agent-token-meter --agents

# List all sessions with cost summary
npx agent-token-meter --all

# Filter by project
npx agent-token-meter --project augustus-trading

# Watch a specific session file
npx agent-token-meter ~/.claude/projects/my-project/SESSION_ID.jsonl
```

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

### Burn rate + acceleration

```
 burn       +3.4k/call  accelerating
```

- **Burn rate** — average context growth per API call over the last 10 calls (resets after compaction).
- **Acceleration** — compares the rate from the last 5 calls vs. the previous 5. `accelerating` means you're reading larger files or getting longer responses. `decelerating` means the conversation is stabilizing. `steady` means consistent growth.

### Compaction ETA

```
 compact    ~142 calls
```

Estimated API calls until auto-compaction triggers, based on current burn rate. Color-coded:
- Green (200+): no pressure
- Yellow (50-200): getting there
- Red (<50): consider resetting context
- Inverted red (<10): reset now

### Workflow advisor

```
 workflow   HANDOFF  Write a plan file soon: "save our plan to plan.md"

 overhead   283.1k of history  (baseline: 16.8k)
 ctx tax    $0.42/call for carrying conversation history
 /clear     saves $0.42/call  (~$8.41 over next 20 calls with handoff)
```

- **workflow** — current phase (EXPLORE > BUILD > HANDOFF > RESET) based on how much of your context is conversation overhead vs. the fixed baseline (system prompt + tools).
- **overhead** — tokens of conversation history you're carrying.
- **ctx tax** — the dollar cost per API call of that overhead, at cache-read rates.
- **reset savings** — if you write a ~2k token handoff file and reset, this is how much you save per call and cumulatively over the next 20 calls.
- **projection** — estimated total session cost by the time auto-compaction triggers.

The optimal strategy: plan in one context, write a handoff, reset, then implement from the lean handoff.

### Cost comparison

```
 cost       $7.83 total   ~$0.21/call   ~$5.58/hr
            Sonnet 4.6: $1.57  Kimi K2.5: $0.49
```

Shows what the same workload would cost on alternative providers. Customize via config file.

### Cache efficiency + ROI

```
 tokens     in: 3.8M   out: 42.1k
            cache hit: 3.6M (96%)  write: 142.3k  uncached: 42
            cache ROI: +$48.07 net savings (write: $5.50, saved: $53.57)
```

The **cache ROI** line shows the net value of caching: how much the cache writes cost vs. how much you saved by reading from cache instead of paying full input price.

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
