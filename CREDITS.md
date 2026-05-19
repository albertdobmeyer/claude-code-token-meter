# Credits

## Reference reading

The "reasoning quality degrades before recall does" framing in this project owes a substantial debt to **Gary Capps'** article *The Hidden Constraint in LLM Systems* (May 2026).

Gary distinguishes between **retrieval reach** (which scales with the advertised context window) and the **active reasoning workspace** (which is far smaller and degrades gradually as more material competes within it). His framing of context engineering as *memory architecture design* — and his pages-based table mapping active reasoning budget to expected competence — is the most articulate version of the underlying constraint this tool exists to surface.

The article is included with the package as [`the-hidden-constraint.md`](./the-hidden-constraint.md) with the author's permission. The canonical published version is at:

→ <https://glcapps.substack.com/p/the-hidden-constraint-in-llm-systems>
also check out all his other LLM related articles: 
https://thinkingwithminions.com/

Used in this project with attribution; all copyright reserved by the author.

## Background research cited in the README

- **Liu et al. (2023)**, *Lost in the Middle: How Language Models Use Long Contexts.* The canonical reference for U-shaped attention over long contexts.
  <https://arxiv.org/abs/2307.03172>
- **Hsieh et al. (2024), RULER** — *RULER: What's the Real Context Size of Your Long-Context Language Models?* Long-context benchmark (authors NVIDIA-affiliated) showing reasoning-quality cliffs well before the advertised window fills.
  <https://arxiv.org/abs/2404.06654>
- **Modarressi et al. (2025), NoLiMa** — *NoLiMa: Long-Context Evaluation Beyond Literal Matching.* Demonstrates that needle-in-haystack recall doesn't predict multi-step reasoning over the same context. ICML 2025.
  <https://arxiv.org/abs/2502.05167>

## Platform / prior art

- **Anthropic** — for Claude Code, the session JSONL log format this meter reads, the multi-event hook architecture (`PostToolUse`, `SessionStart`, `PostCompact`, etc.) the threshold and bootstrap nudges plug into, the `CLAUDE.md` auto-load + `@import` syntax the agent protocol relies on, and the prompt-caching mechanism whose hit rate the dashboard reports. This tool is a measurement layer; the underlying platform decisions it observes are Anthropic's.
  Hook architecture reference: <https://code.claude.com/docs/en/hooks>
  Memory / CLAUDE.md reference: <https://code.claude.com/docs/en/memory>

## Implementation

The parser, metrics engine, dashboard, hook script, and threshold logic are original work by Albert Dobmeyer. The intellectual debts above are to the framings that *informed* the tool's design and language, not to its implementation.

— Albert Dobmeyer
