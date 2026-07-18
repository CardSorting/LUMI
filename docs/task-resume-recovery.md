---
title: "Task Resume and Recovery"
sidebarTitle: "Resume and Recovery"
description: "Generation-safe suspension, restoration, and explicit resume."
---
{/* [LAYER: INFRASTRUCTURE] */}

# Task resume and recovery

Resume is an explicit `TaskLifecycleFunnel` transition, never an assignment to task state.

- An explicitly `suspended` generation may resume with the same generation ID.
- A `terminal` generation can continue only with a fresh `newGenerationId`.
- A new generation is committed atomically and old callbacks, permits, and lifecycle intents fail as stale.
- Parent generation replacement waits for attached children of the old generation to terminalize.

On restore, the persistence adapter loads the exact committed record, revision, and referenced last event. Runtime guards validate the complete record schema and prove that the event matches the record's task, generation, revision, state, cancellation, timestamp, and monotonic sequence. Missing, malformed, contradictory, or mismatched data fails closed, and storage/UI do not infer whether the task should be active. Restoring a terminal or cancellation-fenced parent also reconciles any attached child whose typed propagation commit was interrupted. Child admission independently checks the exact durable parent generation, so the process-crash window cannot authorize execution. An interrupted active history is explicitly suspended before same-generation resume. Legacy history without a lifecycle record is migrated through typed registration/activation intents, and durable legacy completion is submitted as a completion fact rather than assigned directly.

If persistence fails or a newer revision already exists, restore/resume fails closed. It does not overwrite the record asynchronously or silently reactivate a terminal task.

See [Task lifecycle authority](task-lifecycle-authority.md) for the complete transaction and [Task history recovery](troubleshooting/task-history-recovery.mdx) for user-facing history reconstruction.
