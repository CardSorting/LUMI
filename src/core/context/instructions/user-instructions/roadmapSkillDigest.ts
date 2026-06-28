/** Lean execution digest — full SKILL.md is reference-only when roadmap steering is active. */
export const ROADMAP_SKILL_EXECUTION_DIGEST = `# Auto-Rolling Roadmap (execution digest)

Roadmap governance is **already active** via the ROADMAP_STEERING section in your system prompt.

## Execution authority (speed-first)

- **Continue the user's task.** Your I/O execution authority is the primary loop — implement, edit, ship.
- **Do not** mid-task validate/doctor/cockpit loops unless \`attempt_completion\` is blocked.
- Governance clears automatically at \`attempt_completion\` (bootstrap fill → validate → checkpoint stamp).

## When to touch ROADMAP.md

| Trigger | Action |
|---------|--------|
| First steering surface | \`roadmap(action='template')\` → edit ROADMAP.md |
| Material direction change | \`roadmap(action='checkpoint')\` before major edits |
| Blocked at completion | Follow the inline gate message — edit ROADMAP.md, then retry completion |

## Prime directive

Did the latest work strengthen or weaken the project's center of gravity?

## Reference

Full checkpoint algorithm and code-soup audit live in the bundled SKILL.md — read only when you need section-level detail not covered by \`roadmap(action='checkpoint')\`.`
