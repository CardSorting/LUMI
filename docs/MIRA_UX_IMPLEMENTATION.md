---
title: "MIRA UX Implementation"
sidebarTitle: "MIRA Implementation"
description: "Engineer-facing guide to MIRA voice, session comfort, audit styling, and file map."
---

# MIRA UX Implementation

This guide documents **where and how** the MIRA emotional UX system is implemented in `webview-ui/`. Read [User Interface Design](USER_INTERFACE_DESIGN.md) first for product philosophy and contributor guidelines.

---

## Quick file map

| Area | Path |
| :--- | :--- |
| Voice / copy hub | `webview-ui/src/copy/miraVoice.ts` |
| Session comfort hook | `webview-ui/src/hooks/useMiraSessionComfort.ts` |
| Ambient orb | `webview-ui/src/components/common/MiraAmbientOrb.tsx` |
| Progress indicator | `webview-ui/src/components/common/MiraProgressIndicator.tsx` |
| Chat mood wiring | `webview-ui/src/components/chat/ChatView.tsx` |
| Chat layout + serenity attrs | `webview-ui/src/components/chat/chat-view/components/layout/ChatLayout.tsx` |
| Silent completions | `webview-ui/src/components/chat/CompletionOutputRow.tsx` |
| Tool narration | `webview-ui/src/components/chat/ChatRow.tsx` |
| Error recovery copy | `webview-ui/src/components/chat/ErrorRow.tsx` |
| Audit UI tokens | `webview-ui/src/components/chat/audit/auditUiStyles.ts` |
| Audit report panel | `webview-ui/src/components/chat/AuditReportPanel.tsx` |
| Audit history strip | `webview-ui/src/components/chat/task-header/AuditHistoryStrip.tsx` |
| Project reflection | `webview-ui/src/components/joyzoning/JoyZoningView.tsx` |
| Theme tokens | `webview-ui/src/theme.css` |
| Session CSS | `webview-ui/src/index.css` |

Audit header strips and badges live under `webview-ui/src/components/chat/task-header/`.

---

## Voice system (`miraVoice.ts`)

### Exports

```typescript
// Completion presentation — prefer over pickCompletionCloser
pickCompletionPresentation(seed: number): CompletionPresentation

// Placeholders
pickEmptyStateLine(seed: number): string
pickChatPlaceholder(hasTask, seed, sessionMinutes?, isNightDesk?): string

// Failure / uncertainty
pickRecoveryLine(seed: number): string
pickStuckLine(seed: number): string

// Approval copy map
APPROVAL.editFile | deleteFile | newFile | readFile | ...
```

### `CompletionPresentation`

```typescript
type CompletionPresentation = {
  showHeader: boolean   // false → omit header row entirely
  header: string | null // e.g. "All done."
  closer: string | null // e.g. "That should help."
}
```

Distribution (via `Math.abs(seed) % 4`):

- Buckets 0–1: silent (`showHeader: false`)
- Bucket 2: header row, no text
- Bucket 3: optional header + optional closer

**Usage:** Pass a stable seed (typically message timestamp) from `CompletionOutputRow`.

### Placeholder logic

```typescript
pickChatPlaceholder(hasTask, seed, sessionMinutes = 0, isNightDesk = false)
```

Priority order:

1. `isNightDesk` → `"…"`
2. `sessionMinutes >= 90` → `"Still here."`
3. `!hasTask` → `"Take your time."`
4. default → `"Ask me anything…"`

Wire `sessionMinutes` and `isNightDesk` from `useMiraSessionComfort()` in `ChatView` / `ChatTextArea`.

### Adding new approval copy

Extend `APPROVAL` in `miraVoice.ts`, then reference from `ChatRow` ask panels:

```typescript
import { APPROVAL } from "@/copy/miraVoice"

// Pattern: "Want me to…?" — invitation, not gate
<span>{APPROVAL.command}</span>
```

---

## Session comfort (`useMiraSessionComfort.ts`)

### Return value

```typescript
{
  sessionMinutes: number
  isLongSession: boolean      // >= 90 min
  isNightDesk: boolean        // >= 15 min idle
  isStill: boolean            // >= 2 min idle (3 min if long session)
  serenityLevel: 0 | 1 | 2 | 3
  markActivity: () => void
  calmTier: "normal" | "long" | "night"
}
```

Session start is stored in `sessionStorage` under `mira-session-start`. Activity is tracked via `keydown` and `mousedown` on `window`.

### Serenity level computation

| Level | Condition |
| :--- | :--- |
| 0 | Default |
| 1 | Long session (≥ 90 min) |
| 2 | Night desk **or** deep session (≥ 240 min) |
| 3 | Night desk **and** session ≥ 120 min |

### Orb mood resolution

```typescript
resolveOrbMood(companionMood: MiraOrbMood, isStill: boolean): MiraOrbMood
```

Priority: `held` | `waiting` | `success` override stillness; otherwise idle + still → `still`.

**Usage in `ChatView`:**

```typescript
const { isStill, serenityLevel, calmTier, isNightDesk, sessionMinutes, markActivity } =
  useMiraSessionComfort()

const orbMood = resolveOrbMood(companionMood, isStill)

<MiraAmbientOrb mood={orbMood} calmTier={calmTier}>
```

Pass `data-serenity-level` and `data-night-desk` from `ChatLayout`.

---

## Ambient orb (`MiraAmbientOrb.tsx`)

### Props

```typescript
interface MiraAmbientOrbProps {
  children: ReactNode
  className?: string
  mood?: MiraOrbMood      // default "idle"
  calmTier?: MiraCalmTier // default "normal"
}
```

### Mood → motion matrix

| Mood | Glow | Drift | Breathe | Wrapper opacity |
| :--- | :--- | :--- | :--- | :--- |
| idle | pulse | yes | yes | 100% |
| waiting | slow pulse | slow | breathe-rest | 100% |
| success | settle | no | no | 100% |
| still | minimal | no | no | 55% |
| held | very slow pulse | no | no | 50% |

Calm tier modifiers:

- `long` + `waiting`: slightly reduced opacity, slower animations
- `night`: wrapper 45% opacity; `still` + `night` → 35%

Data attributes for debugging: `data-mood`, `data-calm-tier`.

---

## Audit UI tokens (`auditUiStyles.ts`)

Import shared classes instead of ad-hoc alert styling:

```typescript
import {
  auditLabel,
  auditBadge,
  auditStrip,
  auditInset,
  auditReadingSurface,
  auditReadingRow,
  auditReadingGroup,
  auditSoftDivider,
  auditSideAccent,
  auditExhaleOpacity,
} from "@/components/chat/audit/auditUiStyles"
```

### `auditExhaleOpacity(indexFromLatest, isSelected?)`

Returns Tailwind opacity class for history rows:

| Index from latest | Opacity |
| :--- | :--- |
| 0 (selected: always) | 100% |
| 0 | 95% |
| 1 | 82% |
| 2 | 72% |
| 3+ | 62% |

Apply with `.mira-audit-exhale` for night-desk CSS overrides.

### Reading surface

`auditReadingSurface` includes `animate-mira-reading-reveal` — a 1.1s contemplative expand defined in `theme.css`.

---

## CSS hooks (`index.css`)

### Chat readability

```css
.mira-chat-readable { line-height: 1.65; }
```

Apply to chat message containers for sustained reading.

### Layout data attributes

Set on chat layout root:

```html
<div data-night-desk="true" data-serenity-level="2">
```

| Selector | Effect |
| :--- | :--- |
| `[data-night-desk="true"]` | 2s opacity transition on layout |
| `[data-night-desk="true"] footer` | Footer at 90% opacity |
| `[data-night-desk="true"] .mira-audit-exhale` | Audit rows at 88% |
| `[data-serenity-level="N"] .mira-serenity-fade` | Progressive fade (97/94/90%) |

### Workshop atmosphere

```css
.mira-workshop-haze /* radial gradient for JoyZoning */
```

---

## Theme tokens (`theme.css`)

MIRA brand colors under `@theme`:

```css
--color-mira: #6366a0;
--color-mira-cyan: #6bb5c9;
--color-mira-lavender: #b8b5d6;
--gradient-mira: linear-gradient(135deg, #7a7eb8 0%, #8ec4d4 100%);
--glow-mira-soft: 0 0 12px rgba(99, 102, 160, 0.07);
```

Animation keyframes: `miraBreathe`, `miraBreatheSlow`, `miraSettle`, `miraDrift`, `miraGlowPulse`, `miraReadingReveal`, `miraDotPulse`.

Registered utility classes: `animate-mira-*`, `bg-premium-mira-glow`.

Legacy `--color-dietcode` aliases point at MIRA tokens — do not remove without a migration plan.

---

## Wiring checklist for new features

When adding a webview feature that surfaces status or asks for approval:

1. **Copy** — Add strings to `miraVoice.ts`; use first-person collaborative tone
2. **Completion** — If showing task completion, use `pickCompletionPresentation` — default to silence
3. **Errors** — Use `pickRecoveryLine`; set orb companion mood to `held` in `ChatView`
4. **Audit-adjacent UI** — Import `auditUiStyles`; sentence case; amber accent, not red alarm
5. **Long sessions** — Respect `data-serenity-level` / `data-night-desk` if adding persistent chrome
6. **Motion** — Use existing `animate-mira-*` tokens; avoid snappy or attention-grabbing animations

---

## Testing

```bash
# Type check
cd webview-ui && npx tsc --noEmit

# Visual development
cd webview-ui && npm run storybook
```

For Storybook stories involving chat or audit components, wrap with realistic `ExtensionStateContext` and test both VS Code dark/light themes.

---

## Related documentation

- [User Interface Design](USER_INTERFACE_DESIGN.md) — product philosophy and terminology
- [Project Map](PROJECT_MAP.md) — full codebase layout
- [webview-ui/docs/MIRA_UX.md](../webview-ui/docs/MIRA_UX.md) — repo-local quick reference
