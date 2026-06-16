# Runtime Story

`ctx.runtime.story(sessionId)` returns a compressed causal narrative built entirely from `RuntimeStateGraph`.

## API

```typescript
const story = ctx.runtime.story(sessionId);
```

## Shape

```typescript
interface RuntimeStory {
  sessionId: string;
  narrative: string;
  whatHappened: string[];
  why: string[];
  whatChanged: string[];
  whatFailed: string[];
  whatRecovered: string[];
  whatRemainsBlocked: string[];
  generatedAt: number;
}
```

## Sections

| Field | Source |
| --- | --- |
| `whatHappened` | Session, Audit, Plan, Execution, Verification, Rollback nodes |
| `why` | Blockers and failure causes |
| `whatChanged` | Introduced/resolved findings from diff view |
| `whatFailed` | Failure runtime events in graph |
| `whatRecovered` | Rollback nodes with restored files |
| `whatRemainsBlocked` | Active blocker messages |

## Doctrine

- No ad hoc summarization outside graph truth
- No heuristic AI summaries — pure operational evidence
- Story is a projection of `RuntimeStateGraph`, like all operator views

## Operator Use

```typescript
const state = ctx.runtime.state(sessionId);
if (!state.success) {
  const story = ctx.runtime.story(sessionId);
  console.log(story.narrative);
}
```

Pair with `nextActions()` for blocked sessions.
