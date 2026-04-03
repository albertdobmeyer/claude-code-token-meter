#!/usr/bin/env node
/**
 * Agent Token Meter — zero-dependency burn-rate monitor for AI coding agents.
 *
 * Reads session logs and displays live token usage with burn-rate
 * acceleration, compaction prediction, and workflow advisor.
 *
 * Currently supports: Claude Code. More agents planned.
 *
 * Usage:
 *   npx agent-token-meter              # auto-detect agent and session
 *   npx agent-token-meter --all        # summary of all sessions
 *   npx agent-token-meter --help       # show help
 */

import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const VERSION = "1.0.0";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Agent Profiles ───────────────────────────────────────────────────
// Each profile defines everything agent-specific. To add a new agent,
// add an entry here with the same shape.

const AGENTS = {
  "claude-code": {
    id: "claude-code",
    name: "Claude Code",
    sessionDir: () => path.join(os.homedir(), ".claude", "projects"),
    configDir: () => path.join(os.homedir(), ".claude"),
    configFile: "token-meter.json",
    pricing: {
      "claude-opus-4-6":   { input: 15,   output: 75,  cacheWrite: 18.75, cacheRead: 1.5  },
      "claude-opus-4-5":   { input: 15,   output: 75,  cacheWrite: 18.75, cacheRead: 1.5  },
      "claude-sonnet-4-6": { input: 3,    output: 15,  cacheWrite: 3.75,  cacheRead: 0.3  },
      "claude-sonnet-4-5": { input: 3,    output: 15,  cacheWrite: 3.75,  cacheRead: 0.3  },
      "claude-haiku-4-5":  { input: 0.8,  output: 4,   cacheWrite: 1,     cacheRead: 0.08 },
    },
    defaultPricing: { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
    contextLimits: {
      "claude-opus-4-6":   1_000_000,
      "claude-opus-4-5":   1_000_000,
      "claude-sonnet-4-6": 1_000_000,
      "claude-sonnet-4-5":   200_000,
      "claude-haiku-4-5":    200_000,
    },
    defaultContextLimit: 200_000,
    commands: { clear: "/clear", compact: "/compact" },
    hook: {
      supported: true,
      settingsPath: () => path.join(os.homedir(), ".claude", "settings.json"),
      hookDir: () => path.join(os.homedir(), ".claude", "hooks"),
      hookEvent: "PostToolUse",
      hookFileName: "token-meter-hook.mjs",
      stateFile: "token-meter-hook-state.json",
    },
    detect: () => {
      try { return fs.existsSync(path.join(os.homedir(), ".claude", "projects")); }
      catch { return false; }
    },
  },
};

// ── External provider pricing (cross-agent comparisons) ──────────────
const EXTERNAL_PROVIDERS = {
  "kimi-k2.5":        { input: 0.6,  output: 3.0,  cacheWrite: 0.6,  cacheRead: 0.15 },
  "kimi-k2-thinking": { input: 0.6,  output: 2.5,  cacheWrite: 0.6,  cacheRead: 0.15 },
};
const EXTERNAL_CONTEXT_LIMITS = {
  "kimi-k2.5":        262_144,
  "kimi-k2-thinking": 262_144,
};

// ── Constants ────────────────────────────────────────────────────────
const COMPACT_BUFFER = 33_000;
const HANDOFF_SIZE = 2_000;
const CLEAR_LOOKAHEAD = 20;
const DEFAULT_COMPARE = ["claude-sonnet-4-6", "kimi-k2.5"];

// ── ANSI ──────────────────────────────────────────────────────────────
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const MAGENTA = "\x1b[35m";
const WHITE = "\x1b[37m";
const BG_RED = "\x1b[41m";
const CLR_SCR = "\x1b[2J\x1b[H";

// ── Workflow phases ───────────────────────────────────────────────────
const PHASES = [
  { maxPct: 10,  name: "EXPLORE",  color: GREEN,   advice: "Context is cheap. Explore, plan, read broadly." },
  { maxPct: 25,  name: "BUILD",    color: CYAN,    advice: "Productive zone. Context is earning its keep." },
  { maxPct: 45,  name: "HANDOFF",  color: YELLOW,  advice: "Write a plan file soon: \"save our plan to plan.md\"" },
  { maxPct: 100, name: "RESET",    color: RED,     advice: "Write handoff, then {{clear}}. Reload with the plan file." },
];

// ── Helpers ───────────────────────────────────────────────────────────
function fmtTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}

function fmtCost(n) {
  return n < 0.01 ? "$" + n.toFixed(4) : "$" + n.toFixed(2);
}

function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m " + (s % 60) + "s";
  const h = Math.floor(m / 60);
  return h + "h " + (m % 60) + "m";
}

function bar(pct, width = 30) {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  const color = pct > 80 ? RED : pct > 50 ? YELLOW : GREEN;
  return `${color}${"█".repeat(filled)}${DIM}${"░".repeat(empty)}${RESET}`;
}

// ── Agent resolution ─────────────────────────────────────────────────
function resolveAgent(args) {
  // 1. Explicit --agent flag
  const agentIdx = args.indexOf("--agent");
  if (agentIdx >= 0 && agentIdx + 1 < args.length) {
    const id = args[agentIdx + 1];
    if (!AGENTS[id]) {
      console.error(`${RED}Unknown agent: ${id}${RESET}`);
      console.error(`${DIM}Supported: ${Object.keys(AGENTS).join(", ")}${RESET}`);
      process.exit(1);
    }
    return AGENTS[id];
  }

  // 2. Infer from positional file path
  const positional = args.filter(a => !a.startsWith("--"));
  if (positional.length > 0) {
    const fp = positional[0].toLowerCase();
    for (const profile of Object.values(AGENTS)) {
      if (fp.includes(`.${profile.id.split("-")[0]}`)) return profile;
    }
  }

  // 3. Auto-detect
  for (const profile of Object.values(AGENTS)) {
    if (profile.detect()) return profile;
  }

  // 4. No agent found
  console.error(`${RED}No supported agent detected.${RESET}`);
  console.error(`${DIM}Supported agents: ${Object.values(AGENTS).map(a => a.name).join(", ")}${RESET}`);
  console.error(`${DIM}Use --agent <id> to specify manually.${RESET}`);
  process.exit(1);
}

function renderAgents() {
  console.log(`\n${BOLD}Supported Agents${RESET}\n`);
  console.log(`  ${"Agent".padEnd(20)} ${"Status".padEnd(12)} Data Directory`);
  console.log(`  ${DIM}${"─".repeat(60)}${RESET}`);
  for (const p of Object.values(AGENTS)) {
    const detected = p.detect();
    const status = detected ? `${GREEN}detected${RESET}` : `${DIM}not found${RESET}`;
    console.log(`  ${p.name.padEnd(20)} ${status}${" ".repeat(Math.max(0, 12 - (detected ? 8 : 9)))} ${DIM}${p.sessionDir()}${RESET}`);
  }
  console.log();
}

// ── Config & provider resolution ─────────────────────────────────────
function loadConfig(profile) {
  try {
    const configPath = path.join(profile.configDir(), profile.configFile);
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}

function resolveConfig(config, profile) {
  const allPricing = { ...profile.pricing, ...EXTERNAL_PROVIDERS };
  const allLimits = { ...profile.contextLimits, ...EXTERNAL_CONTEXT_LIMITS };
  if (config.providers) {
    for (const [k, v] of Object.entries(config.providers)) {
      if (v.input != null && v.output != null) allPricing[k] = v;
      if (v.context) allLimits[k] = v.context;
    }
  }
  return {
    allPricing,
    allLimits,
    defaultPricing: profile.defaultPricing,
    defaultContextLimit: profile.defaultContextLimit,
    compare: config.compare || DEFAULT_COMPARE,
    labels: Object.fromEntries(
      Object.entries(config.providers || {})
        .filter(([, v]) => v.label)
        .map(([k, v]) => [k, v.label])
    ),
  };
}

function findPricing(model, rc) {
  if (rc.allPricing[model]) return rc.allPricing[model];
  for (const key of Object.keys(rc.allPricing)) {
    if (model.startsWith(key)) return rc.allPricing[key];
  }
  return rc.defaultPricing;
}

function findContextLimit(model, rc) {
  if (rc.allLimits[model]) return rc.allLimits[model];
  for (const key of Object.keys(rc.allLimits)) {
    if (model.startsWith(key)) return rc.allLimits[key];
  }
  return rc.defaultContextLimit;
}

function providerLabel(key, labels) {
  if (labels && labels[key]) return labels[key];
  const m = key.match(/^claude-(\w+)-(\d+)-(\d+)/);
  if (m) return m[1].charAt(0).toUpperCase() + m[1].slice(1) + " " + m[2] + "." + m[3];
  return key.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// ── Session discovery ─────────────────────────────────────────────────
function findSessions(projectFilter, profile) {
  const projectsDir = profile.sessionDir();
  const results = [];

  if (!fs.existsSync(projectsDir)) return results;

  let projects;
  try {
    projects = fs.readdirSync(projectsDir);
  } catch {
    return results;
  }

  for (const proj of projects) {
    if (projectFilter && !proj.toLowerCase().includes(projectFilter.toLowerCase())) continue;
    const projPath = path.join(projectsDir, proj);
    let stat;
    try { stat = fs.statSync(projPath); } catch { continue; }
    if (!stat.isDirectory()) continue;

    let files;
    try { files = fs.readdirSync(projPath); } catch { continue; }

    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const fullPath = path.join(projPath, file);
      try {
        const fstat = fs.statSync(fullPath);
        results.push({ path: fullPath, project: proj, mtime: fstat.mtimeMs, size: fstat.size });
      } catch { /* skip unreadable */ }
    }
  }

  return results.sort((a, b) => b.mtime - a.mtime);
}

// ── JSONL parser ──────────────────────────────────────────────────────
function parseSession(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    return { turns: [], userTurns: [], compactions: [], model: "unknown", project: "", filePath };
  }

  const lines = content.split("\n");
  const apiCalls = [];
  const userTimestamps = [];
  let model = "unknown";
  let project = "";

  // Extract project name from path
  const sep = /[\\/]/;
  const parts = filePath.split(sep);
  const pidx = parts.indexOf("projects");
  if (pidx >= 0 && pidx + 1 < parts.length) project = parts[pidx + 1];

  for (const line of lines) {
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }

    // Track user messages for turn grouping
    if (obj.type === "user" && obj.message?.role === "user") {
      const isToolResult = Array.isArray(obj.message.content) &&
        obj.message.content.some(c => c.type === "tool_result");
      if (!isToolResult) {
        userTimestamps.push(obj.timestamp || "");
      }
    }

    // Track assistant API responses with usage
    if (obj.type === "assistant" && obj.message?.usage) {
      const u = obj.message.usage;
      const input = u.input_tokens || 0;
      const output = u.output_tokens || 0;
      const cacheCreate = u.cache_creation_input_tokens || 0;
      const cacheRead = u.cache_read_input_tokens || 0;
      const thinking = u.thinking_tokens || 0;
      if (input === 0 && output === 0 && cacheCreate === 0 && cacheRead === 0) continue;

      if (obj.message.model) model = obj.message.model;

      apiCalls.push({
        input, output, cacheCreate, cacheRead, thinking,
        contextSize: input + cacheCreate + cacheRead,
        model: obj.message.model || model,
        stopReason: obj.message.stop_reason || "?",
        timestamp: obj.timestamp || "",
      });
    }
  }

  // Detect compaction events: context drops > 20% between consecutive calls
  const compactions = [];
  for (let i = 1; i < apiCalls.length; i++) {
    const prev = apiCalls[i - 1].contextSize;
    const curr = apiCalls[i].contextSize;
    if (prev > 0 && curr < prev * 0.8 && (prev - curr) > 5000) {
      compactions.push({
        index: i,
        before: prev,
        after: curr,
        reduction: prev - curr,
        timestamp: apiCalls[i].timestamp,
      });
    }
  }

  return { turns: apiCalls, userTurns: userTimestamps.length, compactions, model, project, filePath };
}

// ── Metrics engine ────────────────────────────────────────────────────
function computeMetrics(session, rc) {
  const { turns, compactions, model } = session;
  if (turns.length === 0) return null;

  const contextLimit = findContextLimit(model, rc);
  const usableContext = contextLimit - COMPACT_BUFFER;
  const pricing = findPricing(model, rc);

  let totalInput = 0, totalOutput = 0, totalCacheCreate = 0, totalCacheRead = 0, totalCost = 0;
  const turnCosts = [];
  const contextSizes = [];

  for (const t of turns) {
    totalInput += t.input;
    totalOutput += t.output;
    totalCacheCreate += t.cacheCreate;
    totalCacheRead += t.cacheRead;

    const cost =
      (t.input / 1e6) * pricing.input +
      (t.output / 1e6) * pricing.output +
      (t.cacheCreate / 1e6) * pricing.cacheWrite +
      (t.cacheRead / 1e6) * pricing.cacheRead;

    totalCost += cost;
    turnCosts.push(cost);
    contextSizes.push(t.contextSize);
  }

  const currentContext = contextSizes[contextSizes.length - 1] || 0;
  const contextPct = (currentContext / usableContext) * 100;

  // ── Burn rate (last 10 API calls, after last compaction) ──
  const lastCompactIdx = compactions.length > 0 ? compactions[compactions.length - 1].index : 0;
  const postCompactSizes = contextSizes.slice(lastCompactIdx);
  const window = Math.min(10, postCompactSizes.length);
  let burnRate = 0;
  if (postCompactSizes.length >= 2) {
    const recent = postCompactSizes.slice(-window);
    burnRate = (recent[recent.length - 1] - recent[0]) / (recent.length - 1);
  }

  // ── Acceleration (burn rate change: last 5 vs previous 5) ──
  let acceleration = 0;
  if (postCompactSizes.length >= 10) {
    const older = postCompactSizes.slice(-10, -5);
    const newer = postCompactSizes.slice(-5);
    const olderRate = (older[older.length - 1] - older[0]) / (older.length - 1);
    const newerRate = (newer[newer.length - 1] - newer[0]) / (newer.length - 1);
    acceleration = newerRate - olderRate;
  }

  // ── Compaction ETA ──
  const remaining = usableContext - currentContext;
  const turnsToCompact = burnRate > 0 ? Math.floor(remaining / burnRate) : Infinity;

  // ── Cost rate ──
  const recentCosts = turnCosts.slice(-10);
  const avgCostPerTurn = recentCosts.reduce((a, b) => a + b, 0) / recentCosts.length;

  // ── Cache efficiency ──
  const totalBilledInput = totalInput + totalCacheCreate + totalCacheRead;
  const cacheHitRate = totalBilledInput > 0 ? (totalCacheRead / totalBilledInput) * 100 : 0;

  // ── Session duration ──
  const firstTs = turns[0].timestamp;
  const lastTs = turns[turns.length - 1].timestamp;
  let durationMs = 0;
  if (firstTs && lastTs) {
    durationMs = new Date(lastTs).getTime() - new Date(firstTs).getTime();
  }

  // ── Workflow advisor ──
  const baseline = contextSizes.length > 0 ? contextSizes[0] : 16_000;
  const overhead = Math.max(0, currentContext - baseline);
  const overheadPct = (overhead / usableContext) * 100;
  const contextTaxPerCall = (overhead / 1e6) * pricing.cacheRead;
  const postClearContext = baseline + HANDOFF_SIZE;
  const savedPerCall = ((currentContext - postClearContext) / 1e6) * pricing.cacheRead;
  const savingsOverLookahead = savedPerCall * CLEAR_LOOKAHEAD;

  let phase = PHASES[PHASES.length - 1];
  for (const p of PHASES) {
    if (overheadPct <= p.maxPct) { phase = p; break; }
  }

  // ── Cost per hour ──
  let costPerHour = 0;
  if (durationMs > 60_000 && turns.length >= 2) {
    costPerHour = (totalCost / durationMs) * 3_600_000;
  }

  // ── Session cost projection ──
  const projectedCostToCompact = burnRate > 0 && turnsToCompact !== Infinity
    ? totalCost + turnsToCompact * avgCostPerTurn
    : null;

  // ── Cache ROI ──
  const cacheWriteCost = (totalCacheCreate / 1e6) * pricing.cacheWrite;
  const cacheReadSavings = (totalCacheRead / 1e6) * (pricing.input - pricing.cacheRead);
  const cacheNetSavings = cacheReadSavings - cacheWriteCost;

  // ── Multi-provider comparison ──
  const comparisons = {};
  for (const name of rc.compare) {
    if (name === model) continue;
    const p = findPricing(name, rc);
    if (p === rc.defaultPricing && !rc.allPricing[name]) continue;
    comparisons[name] =
      (totalInput / 1e6) * p.input +
      (totalOutput / 1e6) * p.output +
      (totalCacheCreate / 1e6) * (p.cacheWrite || p.input) +
      (totalCacheRead / 1e6) * (p.cacheRead || p.input);
  }

  // ── Thinking tokens ──
  let totalThinking = 0;
  for (const t of turns) totalThinking += t.thinking;

  return {
    model, usableContext, contextLimit, pricing,
    turnCount: turns.length,
    userTurnCount: session.userTurns,
    totalInput, totalOutput, totalCacheCreate, totalCacheRead, totalBilledInput,
    totalCost, avgCostPerTurn, costPerHour,
    currentContext, contextPct,
    burnRate, acceleration, turnsToCompact,
    cacheHitRate,
    compactions,
    durationMs,
    lastTurn: turns[turns.length - 1],
    turnCosts, contextSizes,
    baseline, overhead, overheadPct,
    contextTaxPerCall, savedPerCall, savingsOverLookahead,
    phase,
    projectedCostToCompact,
    cacheWriteCost, cacheReadSavings, cacheNetSavings,
    comparisons, totalThinking,
  };
}

// ── Renderers ─────────────────────────────────────────────────────────

function renderDashboard(metrics, session, rc, profile) {
  if (!metrics) {
    process.stdout.write(CLR_SCR);
    process.stdout.write(`${DIM}Waiting for session data...${RESET}\n`);
    return;
  }
  const m = metrics;
  const cmds = profile.commands;

  // Burn rate label
  const burnSign = m.burnRate >= 0 ? "+" : "";
  const burnStr = `${burnSign}${fmtTokens(Math.round(m.burnRate))}/call`;

  // Acceleration indicator
  let accelStr = "";
  if (m.acceleration > 100) accelStr = `  ${RED}accelerating${RESET}`;
  else if (m.acceleration < -100) accelStr = `  ${GREEN}decelerating${RESET}`;
  else if (m.turnCount >= 10) accelStr = `  ${DIM}steady${RESET}`;

  // Compaction ETA
  let compactStr;
  if (m.turnsToCompact === Infinity) compactStr = `${GREEN}no pressure${RESET}`;
  else if (m.turnsToCompact < 10) compactStr = `${BG_RED}${WHITE}${BOLD} ~${m.turnsToCompact} calls ${RESET} ${RED}${cmds.compact} now${RESET}`;
  else if (m.turnsToCompact < 50) compactStr = `${RED}~${m.turnsToCompact} calls${RESET}`;
  else if (m.turnsToCompact < 200) compactStr = `${YELLOW}~${m.turnsToCompact} calls${RESET}`;
  else compactStr = `${GREEN}~${m.turnsToCompact} calls${RESET}`;

  // Compaction history
  let compactHistory = "";
  if (m.compactions.length > 0) {
    const c = m.compactions[m.compactions.length - 1];
    compactHistory = `  ${DIM}last compaction: ${fmtTokens(c.before)} -> ${fmtTokens(c.after)} (-${fmtTokens(c.reduction)})${RESET}`;
  }

  // Phase — resolve {{clear}} template
  const phaseName = m.phase.name.replace("RESET", cmds.clear.replace("/", "").toUpperCase());
  const phaseAdvice = m.phase.advice.replace("{{clear}}", cmds.clear);

  const W = 52;
  const sep = `${DIM}${"─".repeat(W)}${RESET}`;

  const lines = [
    "",
    `${BOLD}${CYAN} Agent Token Meter ${RESET}${DIM}v${VERSION}${RESET}  ${DIM}(${profile.name})${RESET}`,
    sep,
    "",
    ` ${DIM}model${RESET}      ${BOLD}${m.model}${RESET}`,
    ` ${DIM}session${RESET}    ${m.userTurnCount} user turns  ${DIM}(${m.turnCount} API calls)${RESET}${m.durationMs > 0 ? `  ${DIM}${fmtDuration(m.durationMs)}${RESET}` : ""}`,
    "",
    ` ${DIM}context${RESET}    ${bar(m.contextPct)} ${BOLD}${m.contextPct.toFixed(1)}%${RESET}`,
    `            ${DIM}${fmtTokens(m.currentContext)} / ${fmtTokens(m.usableContext)} usable  (${fmtTokens(m.contextLimit)} limit - ${fmtTokens(COMPACT_BUFFER)} buffer)${RESET}`,
    "",
    ` ${DIM}burn${RESET}       ${MAGENTA}${burnStr}${RESET}${accelStr}`,
    ` ${DIM}compact${RESET}    ${compactStr}`,
    compactHistory ? compactHistory : null,
    "",
    ` ${DIM}tokens${RESET}     in: ${fmtTokens(m.totalBilledInput)}   out: ${fmtTokens(m.totalOutput)}${m.totalThinking > 0 ? `   ${MAGENTA}thinking: ${fmtTokens(m.totalThinking)}${RESET}` : ""}`,
    `            ${DIM}cache hit: ${fmtTokens(m.totalCacheRead)} (${m.cacheHitRate.toFixed(0)}%)  write: ${fmtTokens(m.totalCacheCreate)}  uncached: ${fmtTokens(m.totalInput)}${RESET}`,
    m.cacheNetSavings > 0.01
      ? `            ${DIM}cache ROI: ${GREEN}+${fmtCost(m.cacheNetSavings)} net savings${RESET} ${DIM}(write: ${fmtCost(m.cacheWriteCost)}, saved: ${fmtCost(m.cacheReadSavings)})${RESET}`
      : null,
    "",
    ` ${DIM}cost${RESET}       ${BOLD}${GREEN}${fmtCost(m.totalCost)}${RESET} total   ${DIM}~${fmtCost(m.avgCostPerTurn)}/call${RESET}${m.costPerHour > 0 ? `   ${DIM}~${fmtCost(m.costPerHour)}/hr${RESET}` : ""}`,
    Object.keys(m.comparisons).length > 0
      ? `            ${DIM}${Object.entries(m.comparisons).slice(0, 3).map(([k, v]) => `${providerLabel(k, rc.labels)}: ${fmtCost(v)}`).join("  ")}${RESET}`
      : null,
    "",
    sep,
    "",
    ` ${DIM}workflow${RESET}   ${m.phase.color}${BOLD}${phaseName}${RESET}  ${DIM}${phaseAdvice}${RESET}`,
    "",
    ` ${DIM}overhead${RESET}   ${fmtTokens(m.overhead)} of history  ${DIM}(baseline: ${fmtTokens(m.baseline)})${RESET}`,
    ` ${DIM}ctx tax${RESET}    ${m.contextTaxPerCall > 0.01 ? YELLOW : DIM}${fmtCost(m.contextTaxPerCall)}/call${RESET} for carrying conversation history`,
    m.savedPerCall > 0.005
      ? ` ${DIM}${cmds.clear}${RESET}${" ".repeat(Math.max(1, 10 - cmds.clear.length))}${GREEN}saves ${fmtCost(m.savedPerCall)}/call${RESET}  ${DIM}(~${fmtCost(m.savingsOverLookahead)} over next ${CLEAR_LOOKAHEAD} calls with handoff)${RESET}`
      : ` ${DIM}${cmds.clear}${RESET}${" ".repeat(Math.max(1, 10 - cmds.clear.length))}${DIM}no significant savings yet${RESET}`,
    m.projectedCostToCompact != null
      ? ` ${DIM}projection${RESET} ${YELLOW}~${fmtCost(m.projectedCostToCompact)}${RESET} ${DIM}total by compaction (${m.turnsToCompact} more calls)${RESET}`
      : null,
    "",
    sep,
    ` ${DIM}last call${RESET}  ctx: ${fmtTokens(m.lastTurn.contextSize)}  out: ${fmtTokens(m.lastTurn.output)}  ${DIM}${m.lastTurn.stopReason}${RESET}`,
    sep,
    "",
    `${DIM} Watching for changes... (Ctrl+C to exit)${RESET}`,
  ].filter(l => l !== null);

  process.stdout.write(CLR_SCR);
  process.stdout.write(lines.join("\n") + "\n");
}

function renderAllSessions(projectFilter, limit, rc, profile) {
  const sessions = findSessions(projectFilter, profile);
  if (sessions.length === 0) {
    console.log(`\n${DIM}No sessions found.${RESET}\n`);
    return;
  }

  console.log(`\n${BOLD}${profile.name} Sessions${RESET}${projectFilter ? ` ${DIM}(filter: "${projectFilter}")${RESET}` : ""}\n`);
  console.log(
    `  ${DIM}${"Date".padEnd(12)}${"Context".padStart(9)}${"Turns".padStart(7)}${"Cost".padStart(9)}  ` +
    `${"Cache%".padStart(7)}  Project${RESET}`
  );
  console.log(`  ${DIM}${"─".repeat(70)}${RESET}`);

  let totalCost = 0;
  let shown = 0;

  for (const s of sessions) {
    if (shown >= limit) break;
    const parsed = parseSession(s.path);
    const m = computeMetrics(parsed, rc);
    if (!m) continue;
    shown++;
    totalCost += m.totalCost;
    const date = new Date(s.mtime).toLocaleDateString();
    const compact = m.compactions.length > 0 ? ` ${DIM}(${m.compactions.length}x compacted)${RESET}` : "";
    console.log(
      `  ${DIM}${date.padEnd(12)}${RESET}` +
      `${fmtTokens(m.currentContext).padStart(9)}  ` +
      `${String(m.userTurnCount || m.turnCount).padStart(5)}  ` +
      `${fmtCost(m.totalCost).padStart(9)}  ` +
      `${m.cacheHitRate.toFixed(0).padStart(5)}%  ` +
      `${parsed.project}${compact}`
    );
  }

  console.log(`  ${DIM}${"─".repeat(70)}${RESET}`);
  console.log(`  ${BOLD}Total: ${fmtCost(totalCost)}${RESET} across ${shown} sessions\n`);
}

function renderHelp(profile) {
  const cmd = "npx agent-token-meter";
  const cmds = profile ? profile.commands : { clear: "/clear", compact: "/compact" };
  const configDir = profile ? profile.configDir() : "~/.claude";
  console.log(`
${BOLD}${CYAN}Agent Token Meter${RESET} v${VERSION}
Zero-dependency burn-rate monitor for AI coding agents.

${BOLD}Usage:${RESET}
  ${cmd}                    Auto-detect agent and watch active session
  ${cmd} --all              List all sessions with cost summary
  ${cmd} --project X        Filter sessions by project name
  ${cmd} <file>             Watch a specific .jsonl session file

${BOLD}Options:${RESET}
  --agent <id>         Select agent (default: auto-detect)
  --agents             List supported agents and detection status
  --all                Show all sessions summary
  --project <name>     Filter by project name (substring match)
  --limit <n>          Max sessions to show in --all (default: 20)
  --install-hooks      Install threshold hooks (agent-specific)
  --uninstall-hooks    Remove threshold hooks
  --help, -h           Show this help
  --version, -v        Show version

${BOLD}Hooks (threshold nudges):${RESET}
  Threshold hooks inject a one-line nudge into the agent's context
  when your session crosses 50%, 75%, or 90% context fill.
  Each fires once. Compaction re-arms them. Zero tokens wasted
  when below thresholds. Currently supported: Claude Code.

  Install:    ${cmd} --install-hooks
  Uninstall:  ${cmd} --uninstall-hooks

${BOLD}What it shows:${RESET}
  Context fill bar with percentage
  Burn rate (tokens/call) with acceleration detection
  Compaction ETA (estimated calls until auto-compact triggers)
  Cost tracking with cache efficiency breakdown
  Multi-provider comparison (same workload on Sonnet, Kimi, etc.)
  Cost per hour and session cost projection
  Cache ROI (net savings from prompt caching)
  Compaction history (detects when context was compacted)
  Workflow advisor: phase, context tax, ${cmds.clear} savings projection

${BOLD}Config:${RESET}
  Optional: ${configDir}/token-meter.json
  Add custom providers or change the comparison list:
  { "compare": ["claude-sonnet-4-6", "kimi-k2.5"],
    "providers": { "my-llm": { "input": 1, "output": 5 } } }

${BOLD}Setup:${RESET}
  Run in a split terminal pane alongside your coding agent.
  It reads session JSONL logs (read-only).
`);
}

// ── Hook installer ───────────────────────────────────────────────────

function installHooks(profile) {
  if (!profile.hook?.supported) {
    console.error(`\n${RED}Hooks are not supported for ${profile.name}.${RESET}`);
    console.error(`${DIM}Currently only Claude Code supports threshold hooks.${RESET}\n`);
    process.exit(1);
  }

  const hk = profile.hook;
  const hooksDir = hk.hookDir();
  const hookDest = path.join(hooksDir, hk.hookFileName);
  const hookSrc = path.join(__dirname, "hook.mjs");
  const settingsPath = hk.settingsPath();

  if (!fs.existsSync(hookSrc)) {
    console.error(`${RED}hook.mjs not found at ${hookSrc}${RESET}`);
    console.error(`${DIM}Try reinstalling: npm install -g agent-token-meter${RESET}`);
    process.exit(1);
  }

  // 1. Copy hook script to stable location
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.copyFileSync(hookSrc, hookDest);

  // 2. Merge into settings
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch {}

  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks[hk.hookEvent]) settings.hooks[hk.hookEvent] = [];

  // Remove any existing token-meter hook entry
  settings.hooks[hk.hookEvent] = settings.hooks[hk.hookEvent].filter(
    h => !JSON.stringify(h).includes("token-meter")
  );

  // Add hook — use forward slashes for bash compatibility
  const hookCmd = `node "${hookDest.replace(/\\/g, "/")}"`;
  settings.hooks[hk.hookEvent].push({
    matcher: "",
    hooks: [{ type: "command", command: hookCmd }],
  });

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  console.log(`\n${GREEN}✓${RESET} Token Meter hooks installed for ${BOLD}${profile.name}${RESET}\n`);
  console.log(`  ${DIM}Hook:${RESET}     ${hookDest}`);
  console.log(`  ${DIM}Config:${RESET}   ${settingsPath}`);
  console.log(`\n  ${profile.name} receives a one-line nudge when context crosses:`);
  console.log(`    ${YELLOW}50%${RESET}  — plan a handoff point`);
  console.log(`    ${YELLOW}75%${RESET}  — write findings to file, prepare to ${profile.commands.clear}`);
  console.log(`    ${RED}90%${RESET}  — ${profile.commands.clear} now (shows context tax $/call)`);
  console.log(`\n  Each fires ${BOLD}once${RESET} per session. Compaction re-arms them.`);
  console.log(`  To remove: ${CYAN}npx agent-token-meter --uninstall-hooks${RESET}\n`);
}

function uninstallHooks(profile) {
  if (!profile.hook?.supported) {
    console.error(`\n${RED}Hooks are not supported for ${profile.name}.${RESET}\n`);
    process.exit(1);
  }

  const hk = profile.hook;
  const hookDest = path.join(hk.hookDir(), hk.hookFileName);
  const statePath = path.join(profile.configDir(), hk.stateFile);
  const settingsPath = hk.settingsPath();

  // Remove hook file and state
  try { fs.unlinkSync(hookDest); } catch {}
  try { fs.unlinkSync(statePath); } catch {}

  // Remove from settings
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    if (settings.hooks?.[hk.hookEvent]) {
      settings.hooks[hk.hookEvent] = settings.hooks[hk.hookEvent].filter(
        h => !JSON.stringify(h).includes("token-meter")
      );
      if (settings.hooks[hk.hookEvent].length === 0) delete settings.hooks[hk.hookEvent];
      if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    }
  } catch {}

  console.log(`\n${GREEN}✓${RESET} Token Meter hooks uninstalled\n`);
}

// ── CLI ───────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    // Help can run without a detected agent
    const profile = Object.values(AGENTS).find(a => a.detect()) || Object.values(AGENTS)[0];
    renderHelp(profile);
    return;
  }

  if (args.includes("--version") || args.includes("-v")) {
    console.log(VERSION);
    return;
  }

  if (args.includes("--agents")) {
    renderAgents();
    return;
  }

  // Resolve which agent we're monitoring
  const profile = resolveAgent(args);

  if (args.includes("--install-hooks")) {
    installHooks(profile);
    return;
  }

  if (args.includes("--uninstall-hooks")) {
    uninstallHooks(profile);
    return;
  }

  // Parse --project filter
  let projectFilter = null;
  const projIdx = args.indexOf("--project");
  if (projIdx >= 0 && projIdx + 1 < args.length) {
    projectFilter = args[projIdx + 1];
  }

  // Parse --limit
  let limit = 20;
  const limIdx = args.indexOf("--limit");
  if (limIdx >= 0 && limIdx + 1 < args.length) {
    limit = parseInt(args[limIdx + 1], 10) || 20;
  }

  // Load config and resolve providers
  const rc = resolveConfig(loadConfig(profile), profile);

  if (args.includes("--all")) {
    renderAllSessions(projectFilter, limit, rc, profile);
    return;
  }

  // Determine target file
  let targetFile;
  const skipArgs = ["--agent", "--project", "--limit"];
  const positional = args.filter((a, i) => !a.startsWith("--") && !skipArgs.includes(args[i - 1]));
  if (positional.length > 0) {
    targetFile = path.resolve(positional[0]);
  } else {
    const sessions = findSessions(projectFilter, profile);
    if (sessions.length === 0) {
      console.error(`${RED}No ${profile.name} session files found.${RESET}`);
      console.error(`${DIM}Expected logs in: ${profile.sessionDir()}${RESET}`);
      process.exit(1);
    }
    targetFile = sessions[0].path;
  }

  if (!fs.existsSync(targetFile)) {
    console.error(`${RED}File not found:${RESET} ${targetFile}`);
    process.exit(1);
  }

  // Initial render
  let session = parseSession(targetFile);
  let metrics = computeMetrics(session, rc);
  renderDashboard(metrics, session, rc, profile);

  // Watch with debounce
  let timer = null;
  try {
    fs.watch(targetFile, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          session = parseSession(targetFile);
          metrics = computeMetrics(session, rc);
          renderDashboard(metrics, session, rc, profile);
        } catch { /* mid-write, skip */ }
      }, 250);
    });
  } catch {
    // fs.watch not available — fall back to polling
    setInterval(() => {
      try {
        const newSession = parseSession(targetFile);
        if (newSession.turns.length !== session.turns.length) {
          session = newSession;
          metrics = computeMetrics(session, rc);
          renderDashboard(metrics, session, rc, profile);
        }
      } catch { /* skip */ }
    }, 2000);
  }

  // Graceful exit
  process.on("SIGINT", () => {
    process.stdout.write(`\n${DIM}Token meter stopped.${RESET}\n`);
    process.exit(0);
  });
}

main();
