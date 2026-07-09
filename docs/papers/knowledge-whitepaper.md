<!-- [LAYER: INFRASTRUCTURE] -->

# Technical Whitepaper: The Workspace Knowledge System Architecture

*How LUMI builds, serializes, queries, and protects project memory.*

> **Related:** [Knowledge Thesis](knowledge-thesis.md) · [Knowledge Philosophy](knowledge-philosophy.md) · [Knowledge Brief](knowledge-brief.md) · [README](README.md)

---

## 1. Architectural Blueprint

The Workspace Knowledge System is implemented in the `@core/workspace-intelligence` module. It is composed of three primary components:

```
                  ┌───────────────────────────────┐
                  │  WorkspaceIntelligenceEngine  │ (Computes facts, drift,
                  └───────────────┬───────────────┘  and manages merges)
                                  │
                                  ▼
                  ┌───────────────────────────────┐
                  │  WorkspaceIntelligenceStore   │ (Handles JSON/MD serialization
                  └───────────────┬───────────────┘  and logs events)
                                  │
                                  ▼
                  ┌───────────────────────────────┐
                  │  WorkspaceIntelligenceReader  │ (Exposes typed queries and
                  └───────────────────────────────┘  diagnostics to agents)
```

- **`WorkspaceIntelligenceEngine`:** Orchestrates context compilation at task finalization, detects repository drifts, manages fact lifecycle transitions, and executes deduplication.
- **`WorkspaceIntelligenceStore`:** Serializes models to `workspace-intelligence.json`/`workspace-intelligence.md` and appends logs to `diagnostics.jsonl`.
- **`WorkspaceIntelligenceReader`:** Serves read queries (`getStaleFacts()`, `getSubsystemHealth()`, `getKnowledgeHealth()`) to guide subsequent agent tasks.

---

## 2. Core Data Models

### A. The Workspace Fact
Every observation is represented as a structured `WorkspaceFact`:
```typescript
export interface WorkspaceFact {
  id: string;
  type: "subsystem_stability" | "architecture_decision" | "documentation_surface" | "risk_area" | "handoff_fact";
  value: WorkspaceFactValue;
  confidence: "confirmed" | "needs_verification";
  provenance: WorkspaceProvenance[];
  lifecycle: "active" | "stale" | "superseded" | "disputed" | "archived";
  lastUpdated: string;
}
```

### B. Workspace Provenance
Tracks the grounding trail of observations:
```typescript
export interface WorkspaceProvenance {
  type: "adr" | "manifest" | "finalization_evidence" | "git_commit" | "test_run" | "file_change";
  description: string;
  timestamp: string;
  runId?: string;
  path?: string;
  ref?: string;
}
```

### C. Knowledge Diagnostic Event
Represents a structured NDJSON event logged on status updates:
```typescript
export interface KnowledgeDiagnostic {
  severity: "info" | "warning" | "degraded";
  code: string;
  message: string;
  timestamp: string;
  source: string;
  recoveryHints: string[];
}
```

---

## 3. Resilience Hardening & The Observability Seatbelt

To prevent memory write issues or file locks from crashing task finalization, the system implements a series of advisory safety mechanisms:

### A. Non-Blocking finalization
In `AutonomousDocumentationFinalizer.ts`, the finalization runner is wrapped in a fail-safe block:
```typescript
try {
  const result = await engine.learnFromFinalization({...});
  workspaceIntelligenceUpdated = result.records.length > 0;
} catch (err) {
  Logger.warn(`[Workspace Knowledge System] Degraded state: ${err.message}`);
  // Log to diagnostics.jsonl best-effort and continue finalization
}
```

### B. Corrupt JSON Parser Recovery
In `WorkspaceIntelligenceStore.ts`, the model reader gracefully handles parsing exceptions:
```typescript
try {
  const raw = await readFile(jsonPath, "utf-8");
  return JSON.parse(raw);
} catch (error) {
  Logger.warn(`[Workspace Knowledge System] Failed to parse model. Recovering best-effort.`);
  // Logs [warning] event to diagnostics.jsonl and returns undefined
  return undefined;
}
```

### C. Write Fail-Safe
If write operations encounter I/O blocks (e.g. read-only filesystem or full disk), the engine captures the exception, appends a `[degraded]` NDJSON line, and returns the model memory in-memory to be registered in the extension's `KnowledgeGraphService`.

---

## 4. Query & Diagnostics API

The `WorkspaceIntelligenceReader` parses the append-only `diagnostics.jsonl` file to project the current health of the Workspace Knowledge System:
```typescript
const health = reader.getKnowledgeHealth();
```
It returns an interface mapping status, timestamps, and diagnostic history:
```typescript
export interface WorkspaceKnowledgeHealth {
  status: "healthy" | "degraded";
  lastSuccessfulWrite?: string;
  lastDegradedReason?: string;
  recoveryHints: string[];
  recentDiagnostics: KnowledgeDiagnostic[];
}
```
If the status is `degraded`, the reader automatically inspects the log messages and suggests actionable hints (e.g., verifying filesystem write permissions or freeing up disk space).
