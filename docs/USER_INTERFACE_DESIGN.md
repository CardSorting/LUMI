---
title: "User Interface Design"
sidebarTitle: "UI Design"
description: "MIRA emotional UX strategy — comfort-first developer tooling in the webview."
---

# User Interface Design

The DietCode sidebar presents itself to users as **MIRA**: a calm desk companion developers can keep open all day. The interface is not a productivity cockpit, an analytics dashboard, or enterprise AI infrastructure. It is **lamplight beside difficult creative work**.

This document is the canonical product and design reference for that experience. For file-level implementation details, see [MIRA UX Implementation](MIRA_UX_IMPLEMENTATION.md).

---

## North star

> Can someone keep this open all day without feeling managed by it?

Every UI decision should pass a second filter:

> Does this interface reduce tension?

MIRA succeeds when it feels like a **calm collaborative coworker** — not CI output, not a build pipeline, not audit software narrating itself.

---

## Scope boundary

The MIRA rebrand and emotional UX work applies to **user-facing surfaces in `webview-ui/` only**:

- Visible copy, labels, placeholders, and microcopy
- Visual tone: color, motion, typography, spacing
- Audit and reflection UI presentation

It does **not** require renaming internal identifiers unless explicitly requested:

- Proto keys, provider IDs, and extension message types may still use `dietcode` naming
- Source filenames like `DietCodeLogo*.tsx` remain unchanged
- Backend audit logic and gate enforcement are unchanged — only how results are *presented*

---

## Product philosophy

### Comfort-first developer tooling

MIRA is **not**:

- Analytics or optimization dashboards
- Engagement loops or hustle framing
- Command-center monitoring

MIRA **is**:

- Present without performing
- Quiet when work is flowing
- Warm when something goes wrong
- Archival when reflecting on a session

### Core design concepts

| Concept | Meaning |
| :--- | :--- |
| **Recoverable cognition** | Audit findings are margin notes and observations — possibilities to revisit, not verdicts. Amber whispers, not alarm-red gates. |
| **Archival artifacts** | Exports read like project notes (`Project notes`, `Detailed notes`), not infrastructure telemetry (`SARIF`, `Gate JSON`). |
| **Present without performing** | The orb breathes; completions often settle in silence (~50% have no header). Stable placeholders, no rotation tricks. |
| **Emotional operating model** | Quiet presence → soft invitation → held pause on failure → silent completion → notebook reflection → long-session cooling |

---

## Emotional posture: before and after

**Old style** (infrastructure narration):

- "Executed command."
- "Fetched resource."
- "Validation failed."
- "Completion Gate Blocked"

**MIRA style** (collaborative coworker):

- "I tried that in the terminal."
- "I looked through 3 files."
- "Something still looks off"
- "Worth a second look"

The shift is not cosmetic. It changes the **emotional posture** of the application from distant systems tooling to someone sitting beside you.

---

## Visual language

### Palette and tokens

MIRA brand colors live in `webview-ui/src/theme.css`:

| Token | Role |
| :--- | :--- |
| `--color-mira` | Primary brand (#6366a0) |
| `--color-mira-cyan` | Accent highlight |
| `--color-mira-lavender` | Soft glow and gradients |
| `--color-mira-warm` | Warm foreground on dark surfaces |

Legacy `--color-dietcode` aliases map to MIRA tokens so existing utilities keep working.

### Typography

Chat prose uses `.mira-chat-readable` (line-height **1.65**) for sustained reading comfort. Prefer sentence case; avoid bold alarm titles unless truly necessary.

### Motion

Motion should feel **breathing**, not reactive:

| Class / token | Use |
| :--- | :--- |
| `animate-mira-breathe` | Default idle orb rhythm |
| `animate-mira-breathe-rest` | Waiting state — slower |
| `animate-mira-breathe-slow` | Long-session pacing |
| `animate-mira-settle` | Success — one gentle exhale |
| `animate-mira-drift` | Ambient positional drift |
| `animate-mira-glow-pulse` | Soft luminance pulse |
| `animate-mira-reading-reveal` | Audit panels expanding like turning a notebook page (~1.1s) |

Respect `prefers-reduced-motion`: animations should degrade gracefully where configured.

### Ambient orb

`MiraAmbientOrb` wraps key presence surfaces with a slow glow. Moods:

| Mood | When | Behavior |
| :--- | :--- | :--- |
| `idle` | Default | Breathe + drift + gentle glow |
| `waiting` | Agent working | Slower breathe, calmer pulse |
| `success` | Task completed | Settle animation, brighter glow |
| `still` | User idle (2–3 min) | Dimmed, motion rests |
| `held` | Error / failure | Very dim, slow glow only — no breathe or drift |

**Calm tiers** (`normal` | `long` | `night`) further reduce visual energy during long or idle sessions.

---

## Voice and copy

All conversational microcopy flows through `webview-ui/src/copy/miraVoice.ts`.

### Design principles (encoded in source)

- Can someone keep this open all day without feeling managed by it?
- Does this interface reduce tension?
- Does this reduce cognitive tension right now? (tired-developer test)
- Sustainable pace — not velocity, hustle, or optimization pressure
- Recoverable cognition — observations and possibilities, not judgment
- Archival artifacts — project notes, not infrastructure telemetry

### Stable placeholders

Placeholders **do not rotate**. Quiet availability beats performative variety:

| Context | Text |
| :--- | :--- |
| Empty chat | "Take your time." |
| Active task | "Ask me anything…" |
| Session ≥ 90 min | "Still here." |
| Night desk (15 min idle) | "…" |

### Completion silence

`pickCompletionPresentation(seed)` returns `{ showHeader, header, closer }`:

- **~50%** of completions: no header, no closer — panel settles in silence
- Some completions: header only ("All done.")
- Fewest: header + optional warm closer ("That should help.")

### Approval prompts

Approvals are **invitations**, not permission gates. Pattern: "Want me to…?" via the `APPROVAL` constant map in `miraVoice.ts`.

### Recovery and uncertainty

- `pickRecoveryLine()` — gentle lines after failure
- `pickStuckLine()` — calm uncertainty ("This one's a little tricky.")

---

## Long-session serenity

`useMiraSessionComfort()` tracks session duration, idle time, and progressive visual cooling.

### Thresholds

| Signal | Threshold | Effect |
| :--- | :--- | :--- |
| Stillness | 2 min idle (3 min after 90 min session) | Orb mood → `still` |
| Long session | 90 min | Placeholder → "Still here."; calm tier → `long` |
| Night desk | 15 min idle | Placeholder → "…"; calm tier → `night`; layout `data-night-desk` |
| Deep session | 240 min | Serenity level increases |
| Serenity 3 | Night desk + 120 min | Deepest visual cooling |

### Serenity levels (0–3)

Applied via `data-serenity-level` on chat layout. Elements with `.mira-serenity-fade` progressively reduce opacity (97% → 90%) so older chrome exhale into the background.

`ChatLayout` sets `data-night-desk` and `data-serenity-level` for CSS-driven footer and audit fading.

---

## Audit as notebook, not command center

Audit UI uses shared tokens in `webview-ui/src/components/chat/audit/auditUiStyles.ts`.

### Presentation rules

- **Sentence case** everywhere — no `GATE BLOCKED` panic copy
- **Amber side accents** (`border-amber-500/25`) instead of alarm-red blocks
- **Whisper badges** — small, low-contrast, rounded
- **Vertical reading surface** — research notebook layout, not monitoring grid
- **Exhale opacity** — older history rows fade (95% → 62%) like memory settling

### Terminology map

| Old / internal framing | MIRA user-facing label |
| :--- | :--- |
| Gate block | Something still looks off / needs attention |
| Audit advisory | Worth a second look |
| Markdown export | Project notes |
| Gate JSON export | Detailed notes |
| SARIF export | Tool report |
| Report ID | Note ref · |
| Architecture audit section | Architecture notes |
| Violations list | Things to revisit |

Key components: `AuditReportPanel`, `AuditHistoryStrip`, `AuditGateBlockRow`, `AuditAdvisoryRow`, `PreCompletionGateStrip`, `OrchestratorGateStrip`, `SubagentHandoffStrip`, `ViolationSessionLedgerStrip`, `AuditHealthChip`.

---

## Project reflection (JoyZoning)

The JoyZoning view presents as **Project reflection** — a workshop atmosphere, not governance telemetry.

| Surface | Label |
| :--- | :--- |
| View title | Project reflection |
| Shape visualization | Project shape |
| Pattern section | Workspace patterns |
| Risk framing | Quiet / Mixed / Needs care |
| Metrics tone | Steady feel |

Background uses `.mira-workshop-haze` for a soft radial gradient. Governance and matrix jargon is removed from user-visible copy.

---

## Implementation passes (changelog)

The MIRA UX work landed in ten focused passes:

| Pass | Focus |
| :--- | :--- |
| **1–2** | MIRA palette, theme tokens, bulk user-facing rebrand, orb and progress indicators |
| **3** | Conversational tool narration — "I looked at" not "Executed" |
| **4** | Audit panic copy softened; `MiraAmbientOrb`; recovery warmth on errors |
| **5** | Emotional ergonomics — approval invitations, quieter activity, less machine talk |
| **6** | Welcome/onboarding simplification; companion mood wiring in `ChatView` |
| **7** | Deep comfort — stable placeholders, completion silence, `held` orb on errors, readable typography |
| **8** | Long-session serenity — `auditUiStyles.ts`, night desk, audit exhale CSS |
| **9** | Workshop atmosphere — vertical audit reading surface, JoyZoning reflection, serenity levels |
| **10** | Language de-infrastructuring — archival export labels, reading reveal animation, softened risk metrics |

---

## Contributor guidelines

When adding or changing webview UI:

### Do

- Route new user-facing strings through `miraVoice.ts` when they are conversational
- Use `auditUiStyles.ts` tokens for audit-adjacent surfaces
- Test copy with the tired-developer test: does this add tension?
- Prefer silence over narration when the user already has the information
- Use sentence case and collaborative first-person ("I looked at…", "Want me to…?")

### Avoid

- Uppercase alert labels and CI-style status verbs
- Rotating placeholders or engagement-style variety
- Infrastructure export names in user-visible UI (`SARIF`, `Gate JSON`, `Report ID`)
- Bold red alarm blocks for recoverable audit findings
- Constant intermediate status updates — speak when helpful, disappear when not

### Verify locally

```bash
cd webview-ui && npx tsc --noEmit
cd webview-ui && npm run storybook
```

Storybook contributors should read the [MIRA design principles](../webview-ui/.storybook/README.md#mira-design-principles) section.

---

## Architecture note

The webview (`webview-ui/`) is a React + Vanilla CSS frontend that communicates with the extension host over IPC. MIRA changes the **presentation layer** only. Gate enforcement, audit logic, and agent orchestration remain in `src/core/` and `src/shared/audit/`.

For directory-level mapping, see [Project Map](PROJECT_MAP.md).

---

*Design is not just how it looks, but how it works with you. MIRA is built to reduce tension — not to manage you.*
