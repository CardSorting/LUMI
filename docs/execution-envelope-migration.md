# Subagent Execution Envelope — Complete Model

Evidence-backed reference for the durable subagent execution harness after transcript, compaction, resume, replay-unification, and diff closure.

## Architecture

```
SubagentRunner
  → SubagentTranscriptRecorder (append-only JSONL, incremental flush)
  → SubagentEnvelopeBuilder (tool steps, compaction events, evidence)
  → SubagentExecutionStore (swarm envelope JSON)
  → SwarmReportBuilder (additive summary overlay for parent LLM)
  → ResumeSwarmFromArtifact (explicit operator-visible resume)
  → executionReplayMappers (swarm | broccoli → execution.replay/v1)
  → statusDiff / executionDiff (operator diff surfaces)
```

## Execution envelope schema (`SwarmExecutionEnvelope`, schema v1)

| Field | Purpose |
|-------|---------|
| `swarmId` | Swarm artifact identifier |
| `executionId` | Unique execution instance id |
| `taskId` | Parent task |
| `parentExecutionId` | Lineage parent when resumed |
| `resumeAttemptId` | Resume attempt correlation id |
| `recoveryReceipt` | Operator-visible resume receipt |
| `continuity` | Resume token, completed/total agents, last persisted |
| `agents[]` | Per-agent envelopes |
| `summaryOverlay` | Excerpted markdown overlay (not raw truth) |
| `checksum` | SHA-256 digest of envelope body |
| `schemaVersion` | Must be `1` |
| `invariants` | Fail-closed validation report |

### Per-agent envelope (`SubagentExecutionEnvelope`)

| Field | Purpose |
|-------|---------|
| `executionId` | Agent execution instance |
| `verbatimOutput` | Raw completion text |
| `toolSteps[]` | Ordered tool call evidence |
| `compactionEvents[]` | Pre-drop compaction records (`contentKind: summary`) |
| `transcriptArtifactPath` | JSONL transcript location |
| `transcriptEventCount` | Event count in transcript |
| `evidenceRefs[]` | Linked evidence pointers |
| `blockers` / `warnings` / `retryHints` | Operator surfaces |

## Transcript schema (`SubagentTranscriptEvent`, JSONL)

Path: `{taskDir}/subagent_executions/{swarmId}/agents/{agentId}.transcript.jsonl`

| Field | Purpose |
|-------|---------|
| `kind` | `llm_request`, `assistant_turn`, `tool_call`, `tool_response`, `system_event`, `compaction`, `error`, `recovery`, `completion` |
| `contentKind` | `raw`, `summary`, or `inferred` |
| `sequence` | Monotonic append order |
| `checksum` | Per-line corruption detection |
| `payload` | Event-specific body |

Bounds: 500 events / 2MB per agent transcript. Flush is incremental during execution.

## Compaction event model

Recorded **before** in-memory context is dropped in `SubagentRunner.compactConversationForContextWindow`.

| Field | Purpose |
|-------|---------|
| `reason` | e.g. `proactive_threshold`, `context_window_exceeded` |
| `preTokenEstimate` / `postTokenEstimate` | Token pressure |
| `droppedRange` | Message index range removed |
| `preservedSummaryRef` | Pointer to summary overlay |
| `continuityRiskLevel` | `low` / `medium` / `high` |
| `artifactPointer` | Transcript artifact path |
| `contentKind` | Always `summary` (not raw truth) |
| `transcriptSequence` | Anchor in transcript before drop |

Validation: terminal agents require `transcriptArtifactPath`. Compaction events must be `contentKind: summary`.

## Replay artifact contract (`execution.replay/v1`)

Shared types in `src/shared/execution/replayContract.ts`:

- `ExecutionReplayArtifact`
- `ExecutionLineageNode`
- `ExecutionTimelineEvent`
- `ExecutionCheckpoint`
- `ExecutionArtifactPointer`
- `ExecutionReplayIntegrityReport`
- `ExecutionReplaySource`: `swarm` | `broccoli` | `external`

Mappers (no duplicate truth stores):

- `swarmEnvelopeToReplayArtifact()` — LUMI swarm envelopes
- `broccoliReplayToArtifact()` — BroccoliDB runtime replay exports
- `mergeReplayLineage()` — cross-source lineage graph
- `verifyReplayArtifact()` — fail-closed verifier

Source-specific detail preserved under `extension` fields.

## Resume-from-artifact behavior

Entry: `use_subagents` with `resume_swarm_id` parameter (explicit, never silent).

Flow:

1. `planResumeFromArtifact(taskId, sourceSwarmId)` loads artifact
2. `validateArtifactIntegrity()` — checksum, schema, transcript corruption
3. Rejects stale artifacts (`SWARM_ARTIFACT_MAX_AGE_MS`, default 7 days)
4. Rejects completed swarms
5. Classifies agents:
   - **reuse** — completed with verbatim output
   - **retry** — failed with error + retry hints
   - **restart** — pending / interrupted
6. Emits operator-visible `recoveryReceipt`
7. New swarm gets `parentExecutionId`, `resumeAttemptId`, child lineage

## UI inspection surfaces

| Surface | Location |
|---------|----------|
| Execution timeline | `SubagentExecutionTimeline` |
| Evidence drilldown | `SubagentEvidencePanel` |
| Compaction boundaries | `SubagentCompactionBoundary` |
| Execution diff | `SubagentExecutionDiffViewer` (latest two swarms in task) |
| Continuity / replay badges | `SubagentStatusRow` |

Diff compares tracked fields: status, tool steps, evidence count, transcript event count, touched files, blockers/warnings, invariant violations. Raw JSON diff available on demand.

## Invariant gates

`executionValidation.ts` fail-closed checks:

- Schema version
- Completed agents require verbatim output + transcript path
- Failed agents require error
- No orphaned pending agents on terminal swarms
- No empty success reports
- Artifact checksum match
- Transcript corruption detected on integrity validation

## Corruption handling

- Transcript lines: per-line checksum mismatch → load returns `corruption` string
- Swarm envelope: checksum mismatch in `validateArtifactIntegrity`
- Resume: corrupted/stale artifacts throw with explicit operator error (no silent resume)

## Migration from pre-v1 artifacts

Artifacts without `schemaVersion: 1`, `executionId`, or `transcriptArtifactPath` fail integrity validation and cannot be resumed. UI still renders legacy `SubagentStatusItem.result` when present. Re-run swarms to produce v1 artifacts.

## Remaining limitations (evidence-backed)

1. **Transcript redaction** — redactable structure exists (`contentKind`); no automatic secret scrubbing pipeline wired yet.
2. **Cross-task diff** — diff viewer compares swarms within the current task message history only.
3. **BroccoliDB live bridge** — unified replay contract exists; automatic cross-plane lineage linking during `dietcode_kernel` sessions requires explicit mapper invocation (not auto-merged session IDs).

## Operator checklist

1. Expand subagent cards for verbatim output, tool evidence chain, compaction warnings
2. Check continuity badge and replay artifact badge
3. Compare latest two swarm runs via execution diff panel
4. To resume: pass `resume_swarm_id` on `use_subagents` after reviewing recovery receipt
5. Forensic review: `{taskDir}/subagent_executions/{swarmId}.json` + per-agent `.transcript.jsonl`
