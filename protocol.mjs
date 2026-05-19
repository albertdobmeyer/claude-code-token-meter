/**
 * agent-token-meter — Protocol module
 *
 * Implements the three CLI handlers for agent-protocol management:
 *   --emit-agent-protocol    → print bundled AGENT-PROTOCOL.md to stdout
 *   --install-protocol       → copy AGENT-PROTOCOL.md into cwd, optionally append CLAUDE.md
 *   --uninstall-protocol     → remove both atomically
 *
 * Atomic writes follow the same tmp+rename pattern as v1.2.4's writeSettingsAtomic.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PROTOCOL_FILENAME = "AGENT-PROTOCOL.md";
const CLAUDE_MD_FILENAME = "CLAUDE.md";
const MARKER_START = "<!-- agent-token-meter:protocol-start -->";
const MARKER_END = "<!-- agent-token-meter:protocol-end -->";

const CLAUDE_MD_SECTION = `${MARKER_START}
## Token meter protocol
This project uses agent-token-meter. Read @${PROTOCOL_FILENAME} and follow it when you see \`[Token Meter]\` system reminders.
${MARKER_END}`;

function writeFileAtomic(filePath, content) {
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}

export function readProtocolContent() {
  const protocolPath = path.join(__dirname, PROTOCOL_FILENAME);
  return fs.readFileSync(protocolPath, "utf8");
}

export function emitProtocol() {
  process.stdout.write(readProtocolContent());
}

export function installProtocol(opts = {}) {
  const cwd = process.cwd();
  const protocolDest = path.join(cwd, PROTOCOL_FILENAME);
  const claudeMdPath = path.join(cwd, CLAUDE_MD_FILENAME);
  const skipClaudeMd = opts.skipClaudeMd === true;

  // 1. Write AGENT-PROTOCOL.md to cwd (overwrite any existing — bundled is authoritative)
  const content = readProtocolContent();
  writeFileAtomic(protocolDest, content);

  if (skipClaudeMd) {
    return {
      protocolPath: protocolDest,
      claudeMdUpdated: false,
      claudeMdReason: "skipped via --no-claude-md",
    };
  }

  // 2. Append (or create) CLAUDE.md
  let existing = "";
  let claudeMdExisted = fs.existsSync(claudeMdPath);
  if (claudeMdExisted) {
    existing = fs.readFileSync(claudeMdPath, "utf8");
    if (existing.includes(MARKER_START)) {
      return {
        protocolPath: protocolDest,
        claudeMdUpdated: false,
        claudeMdReason: "section already present (idempotent skip)",
      };
    }
  }

  const trailing = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  const separator = existing.length > 0 ? "\n" : "";
  const newContent = existing + trailing + separator + CLAUDE_MD_SECTION + "\n";

  writeFileAtomic(claudeMdPath, newContent);

  return {
    protocolPath: protocolDest,
    claudeMdUpdated: true,
    claudeMdCreated: !claudeMdExisted,
  };
}

export function uninstallProtocol() {
  const cwd = process.cwd();
  const protocolDest = path.join(cwd, PROTOCOL_FILENAME);
  const claudeMdPath = path.join(cwd, CLAUDE_MD_FILENAME);

  let protocolRemoved = false;
  let claudeMdUpdated = false;
  let claudeMdRemoved = false;

  if (fs.existsSync(protocolDest)) {
    fs.unlinkSync(protocolDest);
    protocolRemoved = true;
  }

  if (fs.existsSync(claudeMdPath)) {
    const content = fs.readFileSync(claudeMdPath, "utf8");
    const startIdx = content.indexOf(MARKER_START);
    const endIdx = content.indexOf(MARKER_END);
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      let before = content.slice(0, startIdx).replace(/\n+$/, "\n");
      let after = content.slice(endIdx + MARKER_END.length).replace(/^\n+/, "");
      const newContent = before + after;
      if (newContent.trim().length === 0) {
        // CLAUDE.md was only our section — remove the file entirely
        fs.unlinkSync(claudeMdPath);
        claudeMdRemoved = true;
      } else {
        writeFileAtomic(claudeMdPath, newContent);
      }
      claudeMdUpdated = true;
    }
  }

  return { protocolRemoved, claudeMdUpdated, claudeMdRemoved };
}
